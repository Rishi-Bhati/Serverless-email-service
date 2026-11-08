import email.utils
import re
import threading
import time

import pytest

from helpers import API_SECRET, accepted, api_error, hang, raw, resp, verify_signed
from unsent import (
    CancelToken,
    UnsentAuthenticationError,
    UnsentConflictError,
    UnsentConnectionError,
    UnsentError,
    UnsentNotFoundError,
    UnsentPermissionError,
    UnsentRateLimitError,
    UnsentRequestError,
    UnsentServerError,
    UnsentTimeoutError,
)

MSG = dict(to="a@b.co", subject="s", html="h")


def setup(flavor, handler, **opts):
    return flavor.make(handler, **opts)


def send(flavor, c, **kw):
    return flavor.run(c.send(**{**MSG, **kw}))


class TestRetries:
    def test_retries_5xx_with_same_key_but_fresh_nonce_and_signature(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: api_error(500, "internal_error", "Internal server error") if n < 3 else accepted(5))
        res = send(flavor, c)
        assert res.id == 5 and len(m.calls) == 3
        assert len({r.json["idempotency_key"] for r in m.calls}) == 1
        assert len({r.header("X-Nonce") for r in m.calls}) == 3
        used = set()
        for r in m.calls:
            assert verify_signed(r, used_nonces=used, now=fake_time.now) is True

    @pytest.mark.parametrize("status", [408, 425, 429, 502, 503, 504, 500])
    def test_retries_these_statuses_honoring_retry_after(self, flavor, fake_time, status):
        m, c = setup(flavor, lambda r, n: api_error(status, "x", "e", headers={"Retry-After": "2"}) if n == 1 else accepted())
        send(flavor, c)
        assert len(m.calls) == 2
        assert fake_time.sleeps == [2.0]

    def test_retry_after_is_capped_at_60_seconds_and_garbage_is_ignored(self, flavor, fake_time):
        for header, expected_min, expected_max in [("99999999999", 60, 60), ("nonsense", 0.25, 0.5), ("-5", 0.25, 0.5), ("1e3", 0.25, 0.5), ("9" * 400, 0.25, 0.5)]:
            fake_time.sleeps.clear()
            m, c = setup(flavor, lambda r, n: api_error(503, "x", "e", headers={"Retry-After": header}) if n == 1 else accepted())
            send(flavor, c)
            assert expected_min <= fake_time.sleeps[0] <= expected_max, header

    def test_retry_after_http_date(self, flavor, fake_time):
        date = email.utils.formatdate(fake_time.now + 5, usegmt=True)
        m, c = setup(flavor, lambda r, n: api_error(429, "rate_limited", "slow", headers={"Retry-After": date}) if n == 1 else accepted())
        send(flavor, c)
        assert 4.0 <= fake_time.sleeps[0] <= 6.0

    def test_backoff_is_exponential_with_jitter_and_capped(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: api_error(503, "x", "e"), max_retries=10)
        flavor.raises(lambda: c.send(**MSG))
        assert len(fake_time.sleeps) == 10
        for i, s in enumerate(fake_time.sleeps):
            exp = min(8.0, 0.5 * 2**i)
            assert exp / 2 - 1e-9 <= s <= exp + 1e-9, (i, s)

    def test_retries_network_errors(self, flavor, fake_time):
        def h(r, n):
            if n < 3:
                raise ConnectionResetError("ECONNRESET")
            return accepted()

        m, c = setup(flavor, h)
        send(flavor, c)
        assert len(m.calls) == 3

    def test_gives_up_after_max_retries_and_surfaces_the_last_error(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: api_error(503, "x", "Unavailable"), max_retries=2)
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentServerError) and err.status == 503 and len(m.calls) == 3

    def test_max_retries_zero_client_or_per_call_disables_retries(self, flavor):
        a_m, a = setup(flavor, lambda r, n: api_error(500, "internal_error"), max_retries=0)
        assert isinstance(flavor.raises(lambda: a.send(**MSG)), UnsentServerError) and len(a_m.calls) == 1
        b_m, b = setup(flavor, lambda r, n: api_error(500, "internal_error"))
        assert isinstance(flavor.raises(lambda: b.send(**MSG, max_retries=0)), UnsentServerError) and len(b_m.calls) == 1

    @pytest.mark.parametrize(
        "status,code,cls",
        [
            (400, "validation_error", UnsentRequestError),
            (400, "unauthorized_sender", UnsentRequestError),
            (401, "invalid_api_key", UnsentAuthenticationError),
            (401, "invalid_signature", UnsentAuthenticationError),
            (401, "nonce_reused", UnsentAuthenticationError),
            (403, "forbidden", UnsentPermissionError),
            (404, "not_found", UnsentNotFoundError),
            (409, "idempotency_key_conflict", UnsentConflictError),
            (413, "payload_too_large", UnsentRequestError),
            (500, "server_misconfigured", UnsentServerError),
            (501, "x", UnsentServerError),
            (505, "x", UnsentServerError),
            (418, "teapot", UnsentError),
        ],
    )
    def test_does_not_retry(self, flavor, status, code, cls):
        m, c = setup(flavor, lambda r, n: api_error(status, code, "nope"))
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, cls) and len(m.calls) == 1

    def test_never_retries_a_send_without_an_idempotency_key(self, flavor):
        def boom(r, n):
            raise ConnectionError("fetch failed")

        net_m, net = setup(flavor, boom)
        assert isinstance(flavor.raises(lambda: net.send(**MSG, idempotency_key=False)), UnsentConnectionError)
        assert len(net_m.calls) == 1
        srv_m, srv = setup(flavor, lambda r, n: api_error(500, "internal_error"))
        assert isinstance(flavor.raises(lambda: srv.send(**MSG, idempotency_key=False)), UnsentServerError)
        assert len(srv_m.calls) == 1

    def test_a_retried_send_whose_first_attempt_landed_resolves_as_a_replay(self, flavor, fake_time):
        def h(r, n):
            if n == 1:
                return api_error(502, "x", "Bad gateway")
            return resp({"success": True, "id": 4, "status": "queued", "idempotent_replay": True, "message": "m", "targetProvider": "p"}, 200, {"Idempotent-Replayed": "true"})

        m, c = setup(flavor, h)
        res = send(flavor, c)
        assert (res.id, res.idempotent_replay) == (4, True) and len(m.calls) == 2

    def test_get_requests_are_retried_too(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: api_error(503, "x") if n < 3 else resp({"queued": 1, "sending": 0, "sent": 2, "failed": 0}))
        assert flavor.run(c.status()).sent == 2 and len(m.calls) == 3

    def test_caller_supplied_key_is_reused_across_retries(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: api_error(503, "x") if n < 3 else accepted())
        send(flavor, c, idempotency_key="order-1")
        assert {r.json["idempotency_key"] for r in m.calls} == {"order-1"}


class TestClockSkew:
    def skewed(self, ft, offset_s=600, with_date=True, health=True):
        def server_now():
            return ft.now + offset_s

        def handler(rec, n):
            if rec.path == "/api/health":
                if not health:
                    raise ConnectionError("down")
                return resp({"status": "ok", "timestamp": server_now() * 1000})
            ts = int(rec.header("X-Timestamp"))
            if abs(server_now() - ts) > 180:
                headers = {"Date": email.utils.formatdate(server_now(), usegmt=True)} if with_date else {}
                return api_error(401, "timestamp_skew", "Unauthorized", "Timestamp out of range", headers)
            return accepted(8)

        return handler

    def test_learns_the_server_clock_from_the_date_header_and_retries_once(self, flavor, fake_time):
        m, c = setup(flavor, self.skewed(fake_time))
        assert send(flavor, c).id == 8 and len(m.calls) == 2
        assert [r.path for r in m.calls] == ["/api/send", "/api/send"]
        send(flavor, c)  # offset remembered: first try succeeds
        assert len(m.calls) == 3
        assert fake_time.sleeps == []  # the corrected retry consumed no backoff

    def test_falls_back_to_the_health_probe_without_a_date_header(self, flavor, fake_time):
        m, c = setup(flavor, self.skewed(fake_time, with_date=False))
        assert send(flavor, c).id == 8
        assert [r.path for r in m.calls] == ["/api/send", "/api/health", "/api/send"]
        assert not m.calls[1].has("X-API-Key")
        assert m.calls[1].timeout <= 5

    def test_works_when_the_local_clock_is_ahead_too(self, flavor, fake_time):
        m, c = setup(flavor, self.skewed(fake_time, offset_s=-900))
        assert send(flavor, c).id == 8

    def test_drops_a_stale_offset_when_the_host_clock_was_fixed(self, flavor, fake_time):
        state = {"skew": 600}

        def handler(rec, n):
            server_now = fake_time.now + state["skew"]
            if rec.path == "/api/health":
                return resp({"status": "ok", "timestamp": server_now * 1000})
            ts = int(rec.header("X-Timestamp"))
            return api_error(401, "timestamp_skew", "Unauthorized", "x") if abs(server_now - ts) > 180 else accepted()

        m, c = setup(flavor, handler)
        send(flavor, c)  # learns +10 min
        state["skew"] = 0  # operator fixes the clock
        send(flavor, c)  # stale offset now wrong; must self-heal
        assert len([r for r in m.calls if r.path == "/api/send"]) == 4
        send(flavor, c)
        assert len([r for r in m.calls if r.path == "/api/send"]) == 5

    def test_gives_up_cleanly_when_the_health_probe_is_unreachable(self, flavor, fake_time):
        m, c = setup(flavor, self.skewed(fake_time, with_date=False, health=False))
        err = flavor.raises(lambda: c.send(**MSG))
        assert err.code == "timestamp_skew" and len([r for r in m.calls if r.path == "/api/send"]) == 1

    def test_does_not_loop_when_the_skew_persists(self, flavor, fake_time):
        date = email.utils.formatdate(fake_time.now + 3600, usegmt=True)
        m, c = setup(flavor, lambda r, n: api_error(401, "timestamp_skew", "Unauthorized", "bad", {"Date": date}))
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentAuthenticationError) and err.code == "timestamp_skew" and len(m.calls) == 2

    def test_ignores_small_skews_it_cannot_be_the_cause_of(self, flavor, fake_time):
        date = email.utils.formatdate(fake_time.now, usegmt=True)
        m, c = setup(flavor, lambda r, n: api_error(401, "timestamp_skew", "Unauthorized", "bad", {"Date": date}))
        assert flavor.raises(lambda: c.send(**MSG)).code == "timestamp_skew" and len(m.calls) == 1

    def test_no_clock_correction_without_an_api_secret(self, flavor, fake_time):
        date = email.utils.formatdate(fake_time.now + 3600, usegmt=True)
        m, c = setup(flavor, lambda r, n: api_error(401, "timestamp_skew", "Unauthorized", "bad", {"Date": date}), api_secret=None)
        err = flavor.raises(lambda: c.send(**MSG))
        assert len(m.calls) == 1 and "requires signed requests" in err.hint


class TestTimeoutsAndAborts:
    def test_times_out_a_hung_request_and_retries_it(self, flavor, fake_time):
        m, c = setup(flavor, lambda r, n: hang(r) if n == 1 else accepted(), timeout=0.05)
        assert send(flavor, c).id == 1 and len(m.calls) == 2

    def test_surfaces_timeout_error_when_every_attempt_hangs(self, flavor, fake_time):
        m, c = setup(flavor, hang, timeout=0.05, max_retries=1)
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentTimeoutError) and isinstance(err, UnsentConnectionError) and err.code == "timeout"
        assert len(m.calls) == 2

    def test_per_call_timeout(self, flavor):
        m, c = setup(flavor, hang, max_retries=0)
        t0 = time.monotonic()
        err = flavor.raises(lambda: c.send(**MSG, timeout=0.05))
        assert isinstance(err, UnsentTimeoutError) and time.monotonic() - t0 < 2

    def test_socket_timeout_exceptions_map_to_timeout_errors(self, flavor):
        import socket

        def h(r, n):
            raise socket.timeout("timed out")

        m, c = setup(flavor, h, max_retries=0)
        assert isinstance(flavor.raises(lambda: c.send(**MSG)), UnsentTimeoutError)

    def test_abort_via_token_stops_immediately_without_retrying(self, flavor):
        token = CancelToken()
        m, c = setup(flavor, hang)
        threading.Timer(0.05, token.cancel).start()
        t0 = time.monotonic()
        err = flavor.raises(lambda: c.send(**MSG, cancel=token))
        assert isinstance(err, UnsentError) and err.code == "aborted" and isinstance(err, UnsentConnectionError)
        assert len(m.calls) == 1 and time.monotonic() - t0 < 2

    def test_abort_during_backoff_stops_waiting(self, flavor):
        token = CancelToken()
        m, c = setup(flavor, lambda r, n: api_error(500, "internal_error"))
        threading.Timer(0.05, token.cancel).start()
        t0 = time.monotonic()
        err = flavor.raises(lambda: c.send(**MSG, cancel=token))
        assert err.code == "aborted" and len(m.calls) == 1
        assert time.monotonic() - t0 < 0.24  # first backoff is at least 0.25 s

    def test_an_already_cancelled_token_never_touches_the_network(self, flavor):
        token = CancelToken()
        token.cancel()
        m, c = setup(flavor, lambda r, n: accepted())
        assert flavor.raises(lambda: c.send(**MSG, cancel=token)).code == "aborted"
        assert m.calls == []

    def test_aborted_is_not_retried_even_if_transport_reports_it_as_oserror(self, flavor):
        token = CancelToken()

        def h(r, n):
            token.cancel()
            raise OSError("whatever")

        m, c = setup(flavor, h)
        assert flavor.raises(lambda: c.send(**MSG, cancel=token)).code == "aborted" and len(m.calls) == 1


class TestErrorMapping:
    def test_exposes_status_code_reason_body_and_a_helpful_hint(self, flavor):
        reason = "Invalid signature (request headers or body may have been tampered with)"
        m, c = setup(flavor, lambda r, n: api_error(401, "invalid_signature", "Unauthorized", reason))
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentAuthenticationError) and type(err).__name__ == "UnsentAuthenticationError"
        assert err.status == 401 and err.code == "invalid_signature"
        assert "tampered" in err.reason and "api_secret" in err.hint
        assert re.search(r"Unauthorized.*tampered.*api_secret", str(err), re.S)
        assert err.body == {"error": "Unauthorized", "code": "invalid_signature", "reason": reason}

    @pytest.mark.parametrize(
        "code,with_secret,fragment",
        [
            ("invalid_api_key", True, "api_key matches the API_KEY"),
            ("unauthorized", True, "api_key matches the API_KEY"),
            ("invalid_signature", True, "api_secret matches the API_SECRET"),
            ("missing_signature", True, "requires signed requests"),
            ("timestamp_skew", True, "more than 3 minutes"),
            ("timestamp_skew", False, "requires signed requests"),
            ("invalid_nonce", False, "requires signed requests"),
            ("unauthorized_sender", True, "not an active provider"),
            ("forbidden", True, "admin dashboard session"),
        ],
    )
    def test_hint_table(self, flavor, code, with_secret, fragment):
        status = 403 if code == "forbidden" else 400 if code == "unauthorized_sender" else 401
        opts = {} if with_secret else {"api_secret": None}
        m, c = setup(flavor, lambda r, n: api_error(status, code, "Err"), **opts, max_retries=0)
        err = flavor.raises(lambda: c.status())
        assert fragment in err.hint and err.message.endswith(f"({err.hint})")

    def test_invalid_nonce_with_secret_has_no_hint(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(401, "invalid_nonce", "Unauthorized"))
        assert flavor.raises(lambda: c.status()).hint is None

    def test_reason_already_in_message_is_not_repeated(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(400, "validation_error", "Bad thing happened", "thing"))
        assert str(flavor.raises(lambda: c.status())) == "Bad thing happened"

    def test_conflict_surfaces_the_existing_email_id(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"error": "Idempotency key was already used for a different email", "code": "idempotency_key_conflict", "id": 77}, 409))
        err = flavor.raises(lambda: c.send(**MSG, idempotency_key="k"))
        assert isinstance(err, UnsentConflictError) and err.existing_email_id == 77

    def test_parses_retry_after_on_429(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(429, "rate_limited", "slow down", headers={"Retry-After": "7"}), max_retries=0)
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentRateLimitError) and err.retry_after == 7.0

    def test_exposes_the_server_date_header(self, flavor):
        m, c = setup(flavor, lambda r, n: api_error(500, "internal_error", headers={"Date": "Mon, 01 Jun 2026 12:00:00 GMT"}), max_retries=0)
        assert flavor.raises(lambda: c.send(**MSG)).server_time == 1780315200.0

    def test_non_json_error_bodies_from_proxies_and_cdns(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b"<html>Bad gateway</html>", 502, reason="Bad Gateway"), max_retries=0)
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentServerError) and err.status == 502 and err.code == "internal_error"
        assert "Bad gateway" in str(err) and err.body == "<html>Bad gateway</html>"

    def test_empty_error_body(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b"", 404, reason="Not Found"))
        err = flavor.raises(lambda: c.status())
        assert err.status == 404 and err.code == "http_404" and str(err) == "Not Found"

    def test_error_bodies_with_wrong_types_do_not_confuse_the_mapping(self, flavor):
        m, c = setup(flavor, lambda r, n: resp({"error": 5, "code": ["x"], "reason": {"a": 1}, "id": "7"}, 409), max_retries=0)
        err = flavor.raises(lambda: c.status())
        assert isinstance(err, UnsentConflictError) and err.code == "http_409" and err.existing_email_id is None
        m, c = setup(flavor, lambda r, n: resp(["list"], 400))
        assert flavor.raises(lambda: c.status()).status == 400

    def test_200_with_a_non_json_body_means_wrong_base_url(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b"<!doctype html>hi", 200))
        err = flavor.raises(lambda: c.status())
        assert type(err) is UnsentError and err.code == "invalid_response" and "base_url" in str(err)
        assert len(m.calls) == 1

    def test_empty_2xx_body_is_invalid_response(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b"", 204))
        assert flavor.raises(lambda: c.status()).code == "invalid_response"

    def test_describes_connection_failures_with_host_and_root_cause(self, flavor):
        def h(r, n):
            raise OSError("getaddrinfo ENOTFOUND unsent.test")

        m, c = setup(flavor, h, max_retries=0)
        err = flavor.raises(lambda: c.send(**MSG))
        assert isinstance(err, UnsentConnectionError) and re.search(r"unsent\.test.*ENOTFOUND", str(err))
        assert isinstance(err.__cause__, OSError)

    @pytest.mark.parametrize("status", [301, 302, 307, 308])
    def test_never_follows_redirects_and_does_not_retry_them(self, flavor, status):
        m, c = setup(flavor, lambda r, n: raw(b"", status, {"Location": "https://elsewhere.test/api/status"}))
        err = flavor.raises(lambda: c.status())
        assert type(err) is UnsentError and err.code == "unexpected_redirect"
        assert "redirected to https://elsewhere.test" in str(err) and len(m.calls) == 1
        assert len(m.calls) == 1

    def test_redirect_on_send_is_not_retried_and_never_resends_credentials(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b"", 307, {"Location": "https://elsewhere.test/"}))
        assert flavor.raises(lambda: c.send(**MSG)).code == "unexpected_redirect"
        assert len(m.calls) == 1

    def test_garbage_transport_results_are_sdk_errors(self, flavor):
        for bad in (None, "str", 5, object()):
            m, c = setup(flavor, lambda r, n, bad=bad: bad)
            assert isinstance(flavor.raises(lambda: c.status()), UnsentError)

    def test_json_edge_cases_are_non_json_not_crashes(self, flavor):
        for body in (b"NaN", b"Infinity", b'{"a": NaN}', b"[" * 100000, b"\xff\xfe\x00", b'{"a":1e999999}' + b"x", b"\xef\xbb\xbf"):
            m, c = setup(flavor, lambda r, n, body=body: raw(body, 200))
            err = flavor.raises(lambda: c.status())
            assert isinstance(err, UnsentError), body[:20]

    def test_bom_prefixed_json_is_accepted(self, flavor):
        m, c = setup(flavor, lambda r, n: raw(b'\xef\xbb\xbf{"queued":1,"sending":0,"sent":0,"failed":0}', 200))
        assert flavor.run(c.status()).queued == 1


def test_secret_never_appears_in_any_error_field(flavor):
    secret, key = "TOP-SECRET-VALUE-1", "TOP-KEY-VALUE-2"
    for handler in (
        lambda r, n: api_error(401, "invalid_signature", "Unauthorized", "bad"),
        lambda r, n: (_ for _ in ()).throw(OSError("connect failed")),
        lambda r, n: raw(b"<html>", 502),
        lambda r, n: raw(b"", 307, {"Location": "https://e.test"}),
    ):
        m, c = setup(flavor, handler, api_key=key, api_secret=secret, max_retries=0)
        err = flavor.raises(lambda: c.send(**MSG))
        blob = " ".join([str(err), repr(err), repr(vars(err)), repr(err.__cause__), repr(getattr(err, "body", ""))])
        assert secret not in blob and key not in blob
        assert API_SECRET not in blob
