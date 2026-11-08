"""The real stdlib transport against local servers."""

import json
import socket
import threading
import time

import pytest

from servers import RawServer, close_without_reply, drip_body, drip_headers, endless_body, hang_forever, http_response, respond
from unsent import AsyncUnsent, CancelToken, TransportRequest, Unsent, UnsentConnectionError, UnsentError, UnsentTimeoutError
from unsent._transport import MAX_RESPONSE_BYTES, StdlibTransport

OK = json.dumps({"queued": 1, "sending": 0, "sent": 2, "failed": 0}).encode()


def client(srv, **kw):
    kw.setdefault("max_retries", 0)
    return Unsent(base_url=srv.url, api_key="key-123", api_secret="secret-456", **kw)


def test_basic_request_headers_and_body_reach_the_server():
    with RawServer(respond(202, json.dumps({"id": 7, "status": "queued"}).encode())) as srv:
        res = client(srv).send(to="a@b.co", subject="Hi", text="there")
    assert res.id == 7
    head, _, body = srv.requests[0].partition(b"\r\n\r\n")
    lines = head.decode().split("\r\n")
    assert lines[0] == "POST /api/send HTTP/1.1"
    headers = {k.lower(): v for k, v in (line.split(": ", 1) for line in lines[1:])}
    assert headers["host"] == f"127.0.0.1:{srv.port}"
    assert headers["x-api-key"] == "key-123" and headers["content-type"] == "application/json"
    assert headers["connection"] == "close" and headers["accept-encoding"] == "identity"
    assert headers["content-length"] == str(len(body)) and json.loads(body)["subject"] == "Hi"


def test_query_string_and_path_prefix_are_sent_as_is():
    with RawServer(respond(200, json.dumps({"emails": [], "total": 0}).encode())) as srv:
        Unsent(base_url=srv.url + "/mail/", api_key="k", max_retries=0).emails.list(search="a b&c", limit=3)
    assert srv.requests[0].split(b"\r\n")[0] == b"GET /mail/api/emails?limit=3&q=a%20b%26c HTTP/1.1"


def test_chunked_and_eof_delimited_bodies_are_read():
    chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" + b"".join(
        b"%x\r\n%s\r\n" % (len(p), p) for p in (OK[:10], OK[10:])
    ) + b"0\r\n\r\n"
    with RawServer(lambda conn, req: conn.sendall(chunked)) as srv:
        assert client(srv).status().sent == 2
    with RawServer(lambda conn, req: conn.sendall(b"HTTP/1.0 200 OK\r\n\r\n" + OK)) as srv:
        assert client(srv).status().sent == 2


def test_redirects_are_never_followed_and_the_api_key_is_not_forwarded():
    with RawServer(respond(200, OK)) as target:
        with RawServer(respond(307, b"", [("Location", target.url + "/api/status")], "Temporary Redirect")) as srv:
            err = pytest.raises(UnsentError, lambda: client(srv, max_retries=3).status()).value
    assert err.code == "unexpected_redirect" and "redirected to" in str(err)
    assert target.connections == 0 and srv.connections == 1


def test_connection_refused_is_a_connection_error_with_the_host():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    err = pytest.raises(UnsentConnectionError, lambda: Unsent(base_url=f"http://127.0.0.1:{port}", api_key="k", max_retries=0).status()).value
    assert f"127.0.0.1:{port}" in str(err) and err.code == "connection_error"


def test_connection_closed_without_a_reply_is_retried_for_keyed_sends():
    seen = []

    def behavior(conn, req):
        seen.append(req)
        if len(seen) == 1:
            conn.close()
        else:
            conn.sendall(http_response(200, json.dumps({"id": 4, "status": "queued", "idempotent_replay": True}).encode(), [("Idempotent-Replayed", "true")]))

    import unsent.client as uc

    with RawServer(behavior) as srv:
        orig = uc._sleep
        uc._sleep = lambda cancel, s: False
        try:
            res = client(srv, max_retries=2).send(to="a@b.co", subject="s", text="t")
        finally:
            uc._sleep = orig
    assert res.idempotent_replay and len(seen) == 2
    k = [json.loads(r.partition(b"\r\n\r\n")[2])["idempotency_key"] for r in seen]
    assert k[0] == k[1]


def test_garbage_http_is_a_connection_error():
    with RawServer(lambda conn, req: conn.sendall(b"\x00\xffNOT HTTP AT ALL\r\n\r\n")) as srv:
        assert isinstance(pytest.raises(UnsentConnectionError, lambda: client(srv).status()).value, UnsentConnectionError)


def test_per_attempt_timeout_covers_a_server_that_never_answers():
    with RawServer(hang_forever) as srv:
        t0 = time.monotonic()
        err = pytest.raises(UnsentTimeoutError, lambda: client(srv, timeout=0.3).status()).value
    assert err.code == "timeout" and 0.25 < time.monotonic() - t0 < 2


def test_timeout_is_an_overall_deadline_not_per_read_slow_headers():
    with RawServer(drip_headers) as srv:
        t0 = time.monotonic()
        pytest.raises(UnsentTimeoutError, lambda: client(srv, timeout=0.5).status())
    assert time.monotonic() - t0 < 2


def test_timeout_is_an_overall_deadline_for_never_ending_and_slow_bodies():
    for behavior in (endless_body, drip_body):
        with RawServer(behavior) as srv:
            t0 = time.monotonic()
            pytest.raises(UnsentTimeoutError, lambda: client(srv, timeout=0.5).status())
            assert time.monotonic() - t0 < 2


def test_timeout_when_nothing_listens_on_the_other_end_of_a_blackhole_accept_queue():
    # a listening socket that never accept()s: the TCP handshake completes via the backlog, then nothing is answered
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    try:
        t0 = time.monotonic()
        pytest.raises(UnsentTimeoutError, lambda: Unsent(base_url=f"http://127.0.0.1:{s.getsockname()[1]}", api_key="k", timeout=0.3, max_retries=0).status())
        assert time.monotonic() - t0 < 2
    finally:
        s.close()


def test_response_announcing_a_huge_body_is_refused_without_reading_it():
    with RawServer(lambda conn, req: conn.sendall(f"HTTP/1.1 200 OK\r\nContent-Length: {MAX_RESPONSE_BYTES + 1}\r\n\r\n".encode() + b"x" * 1000)) as srv:
        err = pytest.raises(UnsentError, lambda: client(srv).status()).value
    assert err.code == "response_too_large" and type(err) is UnsentError


def test_response_without_content_length_is_capped():
    def flood(conn, req):
        conn.sendall(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
        chunk = b"x" * (1024 * 1024)
        for _ in range(MAX_RESPONSE_BYTES // len(chunk) + 4):
            conn.sendall(chunk)

    with RawServer(flood) as srv:
        t0 = time.monotonic()
        err = pytest.raises(UnsentError, lambda: client(srv, timeout=20).status()).value
    assert err.code == "response_too_large" and time.monotonic() - t0 < 15


def test_cancel_token_closes_the_socket_promptly():
    with RawServer(hang_forever) as srv:
        token = CancelToken()
        threading.Timer(0.2, token.cancel).start()
        t0 = time.monotonic()
        err = pytest.raises(UnsentConnectionError, lambda: client(srv, timeout=20).status(cancel=token)).value
    assert err.code == "aborted" and time.monotonic() - t0 < 2


def test_async_client_over_the_real_transport_and_real_cancellation():
    import asyncio

    async def main():
        with RawServer(respond(200, OK)) as srv:
            c = AsyncUnsent(base_url=srv.url, api_key="k", max_retries=0)
            assert (await c.status()).sent == 2
        with RawServer(hang_forever) as srv:
            c = AsyncUnsent(base_url=srv.url, api_key="k", max_retries=0, timeout=20)
            task = asyncio.create_task(c.status())
            await asyncio.sleep(0.2)
            t0 = time.monotonic()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            # the worker thread's socket was closed: the server sees the connection drop soon
            await asyncio.sleep(0.2)
            assert time.monotonic() - t0 < 2

    asyncio.run(main())


def test_transport_can_be_used_directly():
    with RawServer(respond(200, b"{}", [("X-Dup", "a"), ("X-Dup", "b")])) as srv:
        r = StdlibTransport().send(TransportRequest("GET", srv.url + "/x", {}, None, 5, CancelToken()))
    assert r.status == 200 and r.headers["x-dup"] == "a, b" and r.body == b"{}"
