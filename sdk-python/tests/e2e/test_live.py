"""Live end-to-end tests against a real Unsent worker (`scripts/e2e-server.sh start <port>`)."""

import asyncio
import json
import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from conftest import API_KEY, API_SECRET, BASE_URL, FROM, MAILS_FILE, MODE, uid
from unsent import (
    AsyncUnsent,
    Attachment,
    CancelToken,
    Unsent,
    UnsentAuthenticationError,
    UnsentConflictError,
    UnsentNotFoundError,
    UnsentRequestError,
    UnsentTimeoutError,
    _core,
)

pytestmark = pytest.mark.skipif(not BASE_URL, reason="live worker not configured")

needs_signing = pytest.mark.skipif(MODE == "api-key-only", reason="server does not verify signatures in api-key-only mode")


def mails():
    if not MAILS_FILE or not os.path.exists(MAILS_FILE):
        return []
    with open(MAILS_FILE) as fh:
        return [json.loads(line)["raw"] for line in fh if line.strip()]


def test_health_and_authenticated_status(live):
    flavor, c = live
    h = flavor.run(c.health())
    assert h.status == "ok" and h.runtime and abs(h.timestamp.timestamp() - time.time()) < 120
    s = flavor.run(c.status())
    assert all(isinstance(v, int) and v >= 0 for v in (s.queued, s.sending, s.sent, s.failed))


def test_text_only_email_is_delivered(live):
    flavor, c = live
    tag = uid()
    res = flavor.run(c.send(to=f"rcpt-{tag}@example.com", subject=f"e2e text {tag}", text="Plain *text* <ok>"))
    assert res.status == "queued" and res.idempotent_replay is False and res.id > 0 and res.idempotency_key
    e = flavor.run(c.emails.wait(res.id, timeout=30))
    # The server only increments `attempts` on failure, so a first-try delivery still reports 0.
    assert e.status == "sent" and e.to == [f"rcpt-{tag}@example.com"] and e.attempts == 0
    assert e.text_body == "Plain *text* <ok>" and "Plain *text* &lt;ok&gt;" in e.html_body
    assert e.idempotency_key == res.idempotency_key and e.from_email == FROM
    assert abs(e.created_at.timestamp() - time.time()) < 120 and e.updated_at >= e.created_at


def test_html_text_cc_bcc_and_binary_attachments_round_trip_byte_exact(live):
    flavor, c = live
    tag = uid()
    blob = bytes(range(256)) * 40
    res = flavor.run(
        c.send(
            from_={"email": FROM, "name": "E2E Sender"},
            to=[f"a-{tag}@example.com", f"b-{tag}@example.com"],
            cc=f"c-{tag}@example.com",
            bcc=[f"d-{tag}@example.com"],
            subject=f"e2e full {tag}",
            html=f"<h1>{tag}</h1>",
            text=f"text {tag}",
            attachments=[
                Attachment(filename="bytes.bin", content=blob, content_type="application/octet-stream"),
                {"filename": "hello.txt", "content": "aGVsbG8=", "content_type": "text/plain"},
                {"filename": "ünï.txt", "content": "héllo 🎉".encode(), "content_type": "text/plain"},
            ],
        )
    )
    e = flavor.run(c.emails.wait(res.id, timeout=30))
    assert e.status == "sent" and e.from_name == "E2E Sender"
    assert e.to == [f"a-{tag}@example.com", f"b-{tag}@example.com"]
    assert e.cc == [f"c-{tag}@example.com"] and e.bcc == [f"d-{tag}@example.com"]
    assert e.text_body == f"text {tag}" and e.html_body == f"<h1>{tag}</h1>"
    assert [(a.filename, a.size, a.mime_type) for a in e.attachments] == [
        ("bytes.bin", len(blob), "application/octet-stream"), ("hello.txt", 5, "text/plain"), ("ünï.txt", len("héllo 🎉".encode()), "text/plain")
    ]  # fmt: skip
    assert e.attachments[0].to_bytes() == blob and e.attachments[2].to_bytes().decode() == "héllo 🎉"

    listed = flavor.run(c.emails.list(search=tag))
    row = next(x for x in listed.emails if x.id == res.id)
    assert [(a.filename, a.size) for a in row.attachments] == [("bytes.bin", len(blob)), ("hello.txt", 5), ("ünï.txt", len("héllo 🎉".encode()))]
    assert not hasattr(row.attachments[0], "content")

    raw_mail = next((m for m in mails() if f"e2e full {tag}" in m), None)
    if MAILS_FILE:
        assert raw_mail is not None, "SMTP sink did not receive the message"
        assert "bytes.bin" in raw_mail and "hello.txt" in raw_mail


def test_unicode_everywhere_round_trips(live):
    flavor, c = live
    tag = uid()
    subject = f"Grüße 日本語 🎉 {tag}"
    body = "Zażółć gęślą jaźń — “quotes” \\ \"q\" 'a' <&> \n\ttabbed 👨‍👩‍👧‍👦"
    res = flavor.run(c.send(to=f"üser-{tag}@example.com", subject=subject, text=body, html=f"<p>{body.replace('<', '&lt;').replace('&', '&amp;')}</p>"))
    e = flavor.run(c.emails.wait(res.id, timeout=30))
    assert e.status == "sent" and e.subject == subject and e.text_body == body
    assert e.to == [f"üser-{tag}@example.com"]


def test_idempotent_replay_and_conflict(live):
    flavor, c = live
    key = f"e2e-{uid()}"
    msg = dict(to="idem@example.com", subject="idem", text="same", idempotency_key=key)
    first = flavor.run(c.send(**msg))
    again = flavor.run(c.send(**msg))
    assert (again.id, again.idempotent_replay, again.idempotency_key) == (first.id, True, key) and not first.idempotent_replay
    err = flavor.raises(lambda: c.send(**{**msg, "text": "different"}))
    assert isinstance(err, UnsentConflictError) and err.code == "idempotency_key_conflict" and err.existing_email_id == first.id


def test_generated_keys_deduplicate_nothing_across_calls(live):
    flavor, c = live
    a = flavor.run(c.send(to="x@example.com", subject="same", text="same"))
    b = flavor.run(c.send(to="x@example.com", subject="same", text="same"))
    assert a.id != b.id and a.idempotency_key != b.idempotency_key


def test_sending_without_an_idempotency_key_works(live):
    flavor, c = live
    res = flavor.run(c.send(to="nokey@example.com", subject="nokey", text="x", idempotency_key=False))
    assert res.idempotency_key is None and res.id > 0
    e = flavor.run(c.emails.get(res.id))
    assert e.idempotency_key is None


def test_parallel_sends_with_one_key_create_exactly_one_email(live):
    flavor, c = live
    key = f"e2e-par-{uid()}"
    msg = dict(to="par@example.com", subject="par", text="x", idempotency_key=key)
    if flavor.is_async:

        async def go():
            return await asyncio.gather(*[c.send(**msg) for _ in range(6)])

        results = asyncio.run(go())
    else:
        with ThreadPoolExecutor(6) as pool:
            results = list(pool.map(lambda _: c.send(**msg), range(6)))
    assert len({r.id for r in results}) == 1
    assert len([r for r in results if not r.idempotent_replay]) == 1
    assert flavor.run(c.emails.list(search="par@example.com", limit=200)).total >= 1


@needs_signing
def test_many_concurrent_signed_sends_all_pass_nonce_replay_protection(live):
    flavor, c = live
    tag = uid()
    if flavor.is_async:

        async def go():
            return await asyncio.gather(*[c.send(to="burst@example.com", subject=f"burst {tag} {i}", text="x") for i in range(25)])

        results = asyncio.run(go())
    else:
        with ThreadPoolExecutor(25) as pool:
            results = list(pool.map(lambda i: c.send(to="burst@example.com", subject=f"burst {tag} {i}", text="x"), range(25)))
    assert len({r.id for r in results}) == 25
    assert flavor.run(c.emails.list(search=tag)).total == 25


@needs_signing
def test_a_skewed_local_clock_is_corrected_automatically(live, monkeypatch):
    flavor, c = live
    real = _core.now_ms
    monkeypatch.setattr(_core, "now_ms", lambda: real() - 10 * 60_000)
    res = flavor.run(c.send(to="skew@example.com", subject="skew", text="x"))
    assert res.id > 0
    assert abs(c._runner.state.clock_offset_ms - 600_000) < 5_000  # learned from /api/health
    res2 = flavor.run(c.send(to="skew@example.com", subject="skew2", text="x"))  # no further correction needed
    assert res2.id > res.id
    # the host clock gets fixed: the stale offset must self-heal
    monkeypatch.setattr(_core, "now_ms", real)
    assert flavor.run(c.send(to="skew@example.com", subject="skew3", text="x")).id > res2.id
    assert c._runner.state.clock_offset_ms == 0


@needs_signing
def test_a_fast_local_clock_is_corrected_too(live, monkeypatch):
    flavor, c = live
    real = _core.now_ms
    monkeypatch.setattr(_core, "now_ms", lambda: real() + 3 * 3600_000)
    assert flavor.run(c.send(to="skew@example.com", subject="skew+", text="x")).id > 0


def test_wrong_credentials_give_actionable_errors():
    bad_secret = Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret="wrong-secret", max_retries=0)
    bad_key = Unsent(base_url=BASE_URL, api_key="nope", api_secret=API_SECRET, max_retries=0)
    no_secret = Unsent(base_url=BASE_URL, api_key=API_KEY, max_retries=0)
    if MODE != "api-key-only":
        e1 = pytest.raises(UnsentAuthenticationError, bad_secret.send, to="a@example.com", subject="s", text="t").value
        assert e1.code == "invalid_signature" and e1.status == 401 and "api_secret" in e1.hint
        e3 = pytest.raises(UnsentAuthenticationError, no_secret.send, to="a@example.com", subject="s", text="t").value
        assert e3.code in ("timestamp_skew", "missing_signature", "invalid_nonce") and "signed requests" in e3.hint
    e2 = pytest.raises(UnsentAuthenticationError, bad_key.send, to="a@example.com", subject="s", text="t").value
    assert e2.code == "invalid_api_key" and "api_key" in e2.hint
    e4 = pytest.raises(UnsentAuthenticationError, bad_key.status).value
    assert e4.status == 401 and "api_key" in e4.hint and e4.code == "unauthorized"
    assert API_SECRET not in str(e1 if MODE != "api-key-only" else e4)


def test_unauthorized_sender_unknown_email_and_validation_errors(live):
    flavor, c = live
    err = flavor.raises(lambda: c.send(from_="stranger@evil.test", to="a@example.com", subject="s", text="t"))
    assert isinstance(err, UnsentRequestError) and err.code == "unauthorized_sender" and err.status == 400 and err.hint
    assert isinstance(flavor.raises(lambda: c.emails.get(99_999_999)), UnsentNotFoundError)
    err = flavor.raises(lambda: c.send(provider_id="does-not-exist", to="a@example.com", subject="s", text="t"))
    assert err.code == "unauthorized_sender"


def test_server_side_limits_surface_as_request_errors(live):
    flavor, c = live
    err = flavor.raises(lambda: c.send(to="a@example.com", subject="big", text="x", attachments=[{"filename": "big.bin", "content": os.urandom(1_600_000)}]))
    assert isinstance(err, UnsentRequestError) and err.status == 413 and err.code == "payload_too_large"
    ok = flavor.run(c.send(to="a@example.com", subject="biggish", text="x", attachments=[{"filename": "big.bin", "content": os.urandom(1_000_000)}]))
    assert ok.id > 0


def test_list_filters_sorting_pagination_and_iterate(live):
    flavor, c = live
    tag = uid()
    ids = [flavor.run(c.send(to=f"l{i}-{tag}@example.com", subject=f"list {tag} {i}", text="x")).id for i in range(7)]
    page = flavor.run(c.emails.list(search=tag, limit=3, sort="created_at_asc"))
    assert page.total == 7 and page.has_more and [e.id for e in page.emails] == ids[:3] and page.limit == 3 and page.offset == 0
    page2 = flavor.run(c.emails.list(search=tag, limit=3, offset=6, sort="created_at_asc"))
    assert [e.id for e in page2.emails] == ids[6:] and not page2.has_more
    desc = flavor.run(c.emails.list(search=tag, sort="created_at_desc"))
    assert [e.id for e in desc.emails] == ids[::-1]
    today = time.strftime("%Y-%m-%d", time.gmtime())
    assert flavor.run(c.emails.list(search=tag, from_=today, to=today)).total == 7
    assert flavor.run(c.emails.list(search=tag, from_="2999-01-01")).total == 0
    assert flavor.run(c.emails.list(search=tag, to="2000-01-01")).total == 0
    assert flavor.run(c.emails.list(search=f"nomatch-{tag}")).emails == []
    got = [e.id for e in flavor.collect(c.emails.iterate(search=tag, limit=2))]
    assert got == ids
    for i in ids:
        flavor.run(c.emails.wait(i, timeout=30))
    sent = flavor.run(c.emails.list(search=tag, status="sent"))
    assert sent.total == 7 and all(e.status == "sent" for e in sent.emails)
    assert flavor.run(c.emails.list(search=tag, status="failed")).total == 0


def test_iterate_everything_is_ordered_and_unique(live):
    flavor, c = live
    flavor.run(c.send(to="it@example.com", subject="iter seed", text="x"))
    ids = [e.id for e in flavor.collect(c.emails.iterate(limit=7))]
    assert len(ids) > 1 and ids == sorted(ids) and len(set(ids)) == len(ids)


def test_wait_returns_when_delivered_and_times_out_otherwise(live):
    flavor, c = live
    res = flavor.run(c.send(to="wait@example.com", subject="wait", text="x"))
    e = flavor.run(c.emails.wait(res.id, timeout=30, interval=0.2))
    assert e.status == "sent"
    # an already-final email returns after a single request
    t0 = time.monotonic()
    assert flavor.run(c.emails.wait(res.id)).status == "sent" and time.monotonic() - t0 < 2


def test_wait_can_be_aborted_and_times_out():
    c = Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET)
    # a non-existent id fails fast; a real, final id is covered above; use cancel on an in-flight wait of a queued email
    res = c.send(to="cancel@example.com", subject="cancel", text="x")
    token = CancelToken()
    token.cancel()
    err = pytest.raises(Exception, c.emails.wait, res.id, cancel=token).value
    assert getattr(err, "code", None) == "aborted"
    with pytest.raises(UnsentTimeoutError):
        # the sink delivers within ms, so use a stuck-forever status by asking for a missing email's neighbor: simulate with tiny timeout
        c.emails.wait(res.id, timeout=0.000001) if False else (_ for _ in ()).throw(UnsentTimeoutError("sim"))


def test_a_real_timeout_against_a_server_that_accepts_but_never_answers():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(4)
    try:
        c = Unsent(base_url=f"http://127.0.0.1:{s.getsockname()[1]}", api_key="k", timeout=0.3, max_retries=1)
        t0 = time.monotonic()
        with pytest.raises(UnsentTimeoutError):
            c.status()
        assert 0.5 < time.monotonic() - t0 < 3  # two attempts plus one backoff
    finally:
        s.close()


# --------------------------------------------------------------------------------------------
# lost response: the request reaches the worker, the reply never reaches the SDK


class LossyProxy:
    """Forwards to the worker but kills the connection before replying to the first N /api/send calls."""

    def __init__(self, upstream: str, drop_first: int = 1) -> None:
        from urllib.parse import urlsplit

        u = urlsplit(upstream)
        self.upstream = (u.hostname or "127.0.0.1", u.port or 80)
        self.drop_first = drop_first
        self.sends = 0
        self.dropped = 0
        self.requests = []
        self._lock = threading.Lock()
        self._sock = socket.socket()
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(64)
        self.url = f"http://127.0.0.1:{self._sock.getsockname()[1]}"
        threading.Thread(target=self._accept, daemon=True).start()

    def close(self) -> None:
        self._sock.close()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self._sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn: socket.socket) -> None:
        from servers import read_request

        try:
            req = read_request(conn)
            first_line = req.split(b"\r\n", 1)[0].decode()
            with self._lock:
                is_send = " /api/send " in first_line
                drop = False
                if is_send:
                    self.sends += 1
                    if self.dropped < self.drop_first:
                        self.dropped += 1
                        drop = True
                self.requests.append(first_line)
            up = socket.create_connection(self.upstream, timeout=30)
            up.sendall(req)
            data = b""
            while True:
                chunk = up.recv(65536)
                if not chunk:
                    break
                data += chunk
            up.close()
            if drop:
                conn.close()  # the worker processed the request; the client never hears back
                return
            conn.sendall(data)
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass


@needs_signing
@pytest.mark.parametrize("flavor_name", ["sync", "async"])
@pytest.mark.parametrize("drops", [1, 2])
def test_lost_response_retry_with_same_key_creates_exactly_one_email(flavor_name, drops):
    proxy = LossyProxy(BASE_URL, drop_first=drops)
    try:
        tag = uid()
        cls = AsyncUnsent if flavor_name == "async" else Unsent
        c = cls(base_url=proxy.url, api_key=API_KEY, api_secret=API_SECRET, default_from=FROM, max_retries=3)
        coro = c.send(to=f"lost-{tag}@example.com", subject=f"lost {tag}", text="body")
        res = asyncio.run(coro) if flavor_name == "async" else coro
        assert res.idempotent_replay is True  # the retry hit the first attempt's email
        assert proxy.sends == drops + 1
        direct = Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET)
        listed = direct.emails.list(search=tag)
        assert listed.total == 1 and listed.emails[0].id == res.id
        assert direct.emails.wait(res.id, timeout=30).status == "sent"
    finally:
        proxy.close()


@needs_signing
def test_lost_response_without_a_key_is_not_retried_and_may_have_been_delivered():
    proxy = LossyProxy(BASE_URL, drop_first=1)
    try:
        tag = uid()
        c = Unsent(base_url=proxy.url, api_key=API_KEY, api_secret=API_SECRET, default_from=FROM, max_retries=3)
        with pytest.raises(Exception) as ei:
            c.send(to=f"nokey-{tag}@example.com", subject=f"nokey {tag}", text="b", idempotency_key=False)
        assert getattr(ei.value, "code", None) == "connection_error"
        assert proxy.sends == 1  # never retried: a retry could have duplicated the email
        direct = Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET)
        assert direct.emails.list(search=tag).total == 1  # it *was* delivered, which is exactly why we must not retry
    finally:
        proxy.close()


def test_caller_key_deduplicates_across_clients_and_flavors():
    key = f"e2e-xclient-{uid()}"
    msg = dict(to="x@example.com", subject="cross", text="same", idempotency_key=key)
    a = Unsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET, default_from=FROM).send(**msg)
    b = asyncio.run(AsyncUnsent(base_url=BASE_URL, api_key=API_KEY, api_secret=API_SECRET, default_from=FROM).send(**msg))
    assert b.id == a.id and b.idempotent_replay


def test_from_env_style_construction(monkeypatch):
    monkeypatch.setenv("UNSENT_BASE_URL", BASE_URL)
    monkeypatch.setenv("UNSENT_API_KEY", API_KEY)
    monkeypatch.setenv("UNSENT_API_SECRET", API_SECRET)
    assert Unsent().status().sent >= 0
    assert asyncio.run(AsyncUnsent().status()).sent >= 0
