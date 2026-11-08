import copy
import gc
import http.client
import io
import json
import logging
import os
import pickle
import re
import shutil
import socket
import ssl
import subprocess
import sys
import textwrap
import threading
import time
import traceback

import pytest

from helpers import API_KEY, API_SECRET, BASE, MockTransport, accepted, api_error, raw, resp
from servers import RawServer, respond
from unsent import AsyncUnsent, Unsent, UnsentConfigError, UnsentError, UnsentValidationError
from unsent._crypto import random_nonce, random_uuid

SECRET = "ZZ-secret-9f8e7d6c5b4a"
KEY = "ZZ-key-1a2b3c4d5e6f"
MSG = dict(to="a@b.co", subject="s", html="h")


def blob_of_error(err):
    """Everything an error could expose: messages, repr, fields, chain, and a locals-capturing traceback."""
    parts = []
    seen = set()
    e = err
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        parts += [str(e), repr(e), repr(vars(e)), repr(e.args)]
        e = e.__cause__ or e.__context__
    parts += traceback.format_exception(err, capture_locals=True) if sys.version_info >= (3, 13) else ["".join(traceback.TracebackException.from_exception(err, capture_locals=True).format())]
    return "\n".join(parts)


class TestCredentialValidation:
    @pytest.mark.parametrize("value", ["k\r\nX-Evil: 1", "k\nx", "k\rx", "k\0x", "k\x01x", "k\x7fx", "k\tx", "kéy", "k🎉", "k x", "k x", "k\x1bx"])
    def test_api_key_must_be_printable_ascii(self, value):
        with pytest.raises(UnsentConfigError) as ei:
            Unsent(base_url=BASE, api_key=value)
        assert value not in str(ei.value) and "ASCII" in str(ei.value)

    @pytest.mark.parametrize("value", ["s\r\nX: y", "s\0", "s\x01", "sécret", "s\x7f", "s\n"[:1] + "\n" + "x"])
    def test_api_secret_must_be_printable_ascii(self, value):
        with pytest.raises(UnsentConfigError) as ei:
            Unsent(base_url=BASE, api_key="k", api_secret=value)
        assert "api_secret" in str(ei.value) and value not in str(ei.value)

    def test_environment_credentials_are_validated_too(self, monkeypatch):
        monkeypatch.setenv("UNSENT_BASE_URL", BASE)
        monkeypatch.setenv("UNSENT_API_KEY", "ok\r\nEvil: 1")
        with pytest.raises(UnsentConfigError):
            Unsent()
        monkeypatch.setenv("UNSENT_API_KEY", "ok")
        monkeypatch.setenv("UNSENT_API_SECRET", "bad\x01")
        with pytest.raises(UnsentConfigError):
            Unsent()

    def test_surrounding_whitespace_is_trimmed_but_inner_spaces_are_allowed(self):
        m = MockTransport(lambda r, n: accepted())
        Unsent(base_url=BASE, api_key="  my key  \n", transport=m).send(**MSG)
        assert m.calls[0].header("X-API-Key") == "my key"

    def test_a_credential_with_inner_newline_is_rejected_not_trimmed(self):
        with pytest.raises(UnsentConfigError):
            Unsent(base_url=BASE, api_key="abc\ndef")


class TestNoSecretLeakage:
    def make(self, handler, **kw):
        m = MockTransport(handler)
        return m, Unsent(base_url=BASE, api_key=KEY, api_secret=SECRET, transport=m, max_retries=0, **kw)

    def test_object_representations(self):
        m, c = self.make(lambda r, n: accepted())
        a = AsyncUnsent(base_url=BASE, api_key=KEY, api_secret=SECRET)
        dumps = [repr(c), str(c), f"{c!r}", repr(vars(c)), repr(c.emails), repr(vars(c.emails)), repr(c._runner), repr(vars(c._runner)),
                 repr(c._runner.state), repr(a), repr(vars(a)), repr(vars(a._runner)), repr(a._runner.state),
                 repr(c._runner.state._api_key), repr(c._runner.state._api_secret), str(c._runner.state._api_key)]  # fmt: skip
        for d in dumps:
            assert SECRET not in d and KEY not in d

    def test_pickling_and_copying_never_exposes_secrets(self):
        m, c = self.make(lambda r, n: accepted())
        with pytest.raises(TypeError):
            pickle.dumps(c)
        with pytest.raises(TypeError):
            pickle.dumps(c._runner.state)
        with pytest.raises(TypeError):
            copy.copy(c)
        assert SECRET not in repr(copy.deepcopy(c._runner.state._api_secret))

    @pytest.mark.parametrize(
        "handler",
        [
            lambda r, n: api_error(401, "invalid_signature", "Unauthorized", "bad sig"),
            lambda r, n: api_error(500, "internal_error"),
            lambda r, n: raw(b"<html>", 502),
            lambda r, n: raw(b"", 307, {"Location": "https://e.test"}),
            lambda r, n: raw(b"not json", 200),
            lambda r, n: (_ for _ in ()).throw(ConnectionResetError("reset by peer")),
            lambda r, n: (_ for _ in ()).throw(TimeoutError()),
        ],
    )
    def test_errors_and_tracebacks_with_captured_locals_do_not_contain_credentials(self, handler):
        m, c = self.make(handler)
        with pytest.raises(UnsentError) as ei:
            c.send(**MSG)
        blob = blob_of_error(ei.value)
        assert SECRET not in blob and KEY not in blob
        # the signature header is not the secret itself, but it must not be echoed in locals either
        assert m.calls[0].header("X-Signature") not in blob

    def test_real_transport_failures_with_captured_locals_do_not_leak(self):
        # server closes immediately; client is still writing a multi-megabyte body -> failure deep inside http.client
        with RawServer(lambda conn, req: conn.close(), read_first=False) as srv:
            c = Unsent(base_url=srv.url, api_key=KEY, api_secret=SECRET, max_retries=0)
            with pytest.raises(UnsentError) as ei:
                c.send(to="a@b.co", subject="s", html="x" * (2_800_000))
        blob = blob_of_error(ei.value)
        assert SECRET not in blob and KEY not in blob
        # and a refused connection
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with pytest.raises(UnsentError) as ei:
            Unsent(base_url=f"http://127.0.0.1:{port}", api_key=KEY, api_secret=SECRET, max_retries=0).status()
        blob = blob_of_error(ei.value)
        assert SECRET not in blob and KEY not in blob

    def test_transport_request_repr_hides_headers(self):
        seen = []
        m = MockTransport(lambda r, n: accepted())
        orig = m.send

        def spy(req):
            seen.append(req)
            return orig(req)

        m.send = spy
        Unsent(base_url=BASE, api_key=KEY, api_secret=SECRET, transport=m).send(**MSG)
        req = seen[0]
        assert KEY not in repr(req) and KEY not in repr(req.headers) and KEY not in str(req.headers)
        assert "X-Timestamp" in repr(req.headers)

    def test_nothing_is_logged(self, caplog):
        caplog.set_level(logging.DEBUG)
        m, c = self.make(lambda r, n: api_error(401, "invalid_api_key", "x"))
        with pytest.raises(UnsentError):
            c.send(**MSG)
        assert caplog.records == []

    def test_http_client_global_debug_output_cannot_print_credentials(self, capsys):
        old = http.client.HTTPConnection.debuglevel
        http.client.HTTPConnection.debuglevel = 1
        try:
            with RawServer(respond(200, b'{"queued":0,"sending":0,"sent":0,"failed":0}')) as srv:
                Unsent(base_url=srv.url, api_key=KEY, api_secret=SECRET, max_retries=0).status()
        finally:
            http.client.HTTPConnection.debuglevel = old
        out = capsys.readouterr()
        assert KEY not in out.out + out.err

    def test_credentials_are_only_ever_sent_to_the_configured_host_and_never_in_the_body_or_url(self):
        m, c = self.make(lambda r, n: accepted())
        c.send(**MSG)
        r = m.calls[0]
        assert SECRET not in r.body and KEY not in r.body and SECRET not in r.url and KEY not in r.url
        assert SECRET not in json.dumps(r.headers)
        assert r.headers["x-api-key"] == KEY

    def test_garbage_collector_referrers_do_not_expose_plain_secret_attributes(self):
        m, c = self.make(lambda r, n: accepted())
        for holder in (c, c.emails, c._runner, c._runner.state):
            assert not any(isinstance(v, str) and (SECRET in v or KEY in v) for v in vars(holder).values())
        gc.collect()


class TestHeaderInjection:
    EVIL = ["x\r\nX-Injected: 1", "x\nBcc: evil@x.co", "x\0y", "\r\n\r\nHTTP/1.1 200 OK"]

    def run_all(self, **extra):
        m = MockTransport(lambda r, n: accepted())
        c = Unsent(base_url=BASE, api_key=API_KEY, api_secret=API_SECRET, transport=m)
        errors = 0
        for field in ("to", "cc", "bcc", "from_", "provider_id", "idempotency_key", "subject", "html", "text"):
            for evil in self.EVIL:
                kwargs = dict(MSG)
                kwargs[field] = evil if field != "to" else evil + "@x.co"
                if field in ("to", "cc", "bcc"):
                    kwargs[field] = evil + "@x.co"
                if field == "from_":
                    kwargs[field] = evil + "@x.co"
                try:
                    c.send(**{**kwargs, **extra})
                except UnsentValidationError:
                    errors += 1
        return m, errors

    def test_user_controlled_strings_never_reach_http_headers(self):
        m, errors = self.run_all()
        allowed = {"accept", "user-agent", "x-api-key", "content-type", "x-timestamp", "x-nonce", "x-signature"}
        assert errors > 0
        for r in m.calls:
            assert set(r.headers) <= allowed
            for v in r.headers.values():
                assert "\r" not in v and "\n" not in v and "\0" not in v

    def test_crlf_in_addresses_is_rejected_and_in_free_text_is_json_escaped(self):
        m, _ = self.run_all()
        for r in m.calls:
            assert "\r" not in r.body and "\n" not in r.body  # JSON-escaped, never raw
        # every recipient/sender/key with CR, LF or NUL was refused before the network
        for r in m.calls:
            for field in ("to", "cc", "bcc"):
                for a in r.json.get(field, []):
                    assert not re.search(r"[\r\n\0]", a)
            if "from" in r.json:
                assert not re.search(r"[\r\n\0]", r.json["from"]["email"] + r.json["from"].get("name", ""))

    def test_real_transport_refuses_to_emit_a_header_with_crlf_even_if_one_slipped_through(self):
        from unsent import CancelToken, TransportRequest
        from unsent._transport import StdlibTransport

        with RawServer(respond(200, b"{}")) as srv:
            with pytest.raises((ValueError, UnsentError, OSError)):
                StdlibTransport().send(TransportRequest("GET", srv.url + "/x", {"X-Evil": "a\r\nInjected: 1"}, None, 5, CancelToken()))
        assert srv.connections <= 1 and (not srv.requests or b"Injected" not in srv.requests[0])

    def test_base_url_cannot_smuggle_a_request_line_or_headers(self):
        for url in ("https://x.test/\r\nGET /evil HTTP/1.1", "https://x.test/%0d%0aEvil: 1\r\n", "https://x.test\r\n.evil.com"):
            with pytest.raises(UnsentConfigError):
                Unsent(base_url=url, api_key="k")
        # percent-encoded CRLF stays encoded (inert) in the path
        m = MockTransport(lambda r, n: accepted())
        Unsent(base_url="https://x.test/%0d%0aEvil", api_key="k", transport=m).send(**MSG)
        assert "\r" not in m.calls[0].url and "\n" not in m.calls[0].url


class TestRedirects:
    def test_never_follows_and_never_forwards_credentials(self):
        with RawServer(respond(200, b"{}")) as evil:
            with RawServer(respond(302, b"", [("Location", evil.url + "/steal")], "Found")) as srv:
                for call in (lambda c: c.status(), lambda c: c.send(**MSG), lambda c: c.emails.get(1), lambda c: c.health()):
                    c = Unsent(base_url=srv.url, api_key=KEY, api_secret=SECRET, max_retries=3)
                    with pytest.raises(UnsentError) as ei:
                        call(c)
                    assert ei.value.code == "unexpected_redirect"
        assert evil.connections == 0 and all(KEY.encode() not in r for r in evil.requests)
        assert srv.connections == 4  # one attempt each: redirects are not retried

    def test_redirect_message_cannot_inject_log_lines(self):
        with RawServer(respond(302, b"", [("Location", "https://e.test/ok")], "Found")) as srv:
            c = Unsent(base_url=srv.url, api_key="k", max_retries=0)
            err = pytest.raises(UnsentError, c.status).value
        assert "\n" not in str(err)


class TestTransportSecurity:
    def test_http_to_remote_hosts_is_rejected(self):
        for host in ("example.com", "10.0.0.1", "192.168.1.1", "unsent.internal", "localhost.evil.com", "127.0.0.1.evil.com", "[::2]"):
            with pytest.raises(UnsentConfigError):
                Unsent(base_url=f"http://{host}", api_key="k")

    def test_other_schemes_and_credentials_in_url_are_rejected(self):
        for url in ("ftp://x.test", "ws://x.test", "gopher://x.test", "data:text/plain,x", "//x.test", "https:x.test", "https://u:p@x.test", "https://:p@x.test"):
            with pytest.raises(UnsentConfigError):
                Unsent(base_url=url, api_key="k")

    @staticmethod
    def make_cert(tmp_path):
        if shutil.which("openssl") is None:
            pytest.skip("openssl CLI not available")
        cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "2", "-subj", "/CN=localhost",
             "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
            check=True, capture_output=True,
        )  # fmt: skip
        return cert, key

    def tls_server(self, cert, key):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(cert), str(key))
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        sock.listen(8)
        port = sock.getsockname()[1]
        hits = []

        def serve():
            while True:
                try:
                    conn, _ = sock.accept()
                except OSError:
                    return
                try:
                    tls = ctx.wrap_socket(conn, server_side=True)
                    data = tls.recv(65536)
                    hits.append(data)
                    body = b'{"queued":1,"sending":0,"sent":0,"failed":0}'
                    tls.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
                    tls.close()
                except (ssl.SSLError, OSError):
                    conn.close()

        threading.Thread(target=serve, daemon=True).start()
        return sock, port, hits

    def test_untrusted_certificates_are_rejected_and_no_request_is_sent(self, tmp_path):
        cert, key = self.make_cert(tmp_path)
        sock, port, hits = self.tls_server(cert, key)
        try:
            c = Unsent(base_url=f"https://localhost:{port}", api_key=KEY, max_retries=0)
            err = pytest.raises(UnsentError, c.status).value
            assert err.code == "connection_error" and "CERTIFICATE_VERIFY_FAILED" in str(err)
            assert hits == []  # the API key was never transmitted
        finally:
            sock.close()

    def test_a_trusted_certificate_works_end_to_end_over_https(self, tmp_path):
        cert, key = self.make_cert(tmp_path)
        sock, port, hits = self.tls_server(cert, key)
        code = textwrap.dedent(
            f"""
            from unsent import Unsent
            s = Unsent(base_url="https://localhost:{port}", api_key="{KEY}", max_retries=0).status()
            assert s.queued == 1, s
            print("TLS-OK")
            """
        )
        try:
            env = {**os.environ, "SSL_CERT_FILE": str(cert)}
            out = subprocess.run([sys.executable, "-I", "-c", code], env=env, capture_output=True, text=True, timeout=30)
            assert "TLS-OK" in out.stdout, out.stdout + out.stderr
            assert hits and f"Host: localhost:{port}".encode() in hits[0] and KEY.encode() in hits[0]
        finally:
            sock.close()

    def test_hostname_mismatch_is_rejected_even_when_the_certificate_is_trusted(self, tmp_path):
        if shutil.which("openssl") is None:
            pytest.skip("openssl CLI not available")
        cert, key = tmp_path / "other.pem", tmp_path / "other.key"
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "2", "-subj", "/CN=other.test",
             "-addext", "subjectAltName=DNS:other.test"],
            check=True, capture_output=True,
        )  # fmt: skip
        sock, port, hits = self.tls_server(cert, key)
        code = textwrap.dedent(
            f"""
            from unsent import Unsent, UnsentError
            try:
                Unsent(base_url="https://localhost:{port}", api_key="k", max_retries=0).status()
            except UnsentError as e:
                print("REJECTED", e.code, "mismatch" in str(e).lower() or "hostname" in str(e).lower())
            """
        )
        try:
            env = {**os.environ, "SSL_CERT_FILE": str(cert)}
            out = subprocess.run([sys.executable, "-I", "-c", code], env=env, capture_output=True, text=True, timeout=30)
            assert "REJECTED connection_error True" in out.stdout, out.stdout + out.stderr
            assert hits == []
        finally:
            sock.close()


class TestRedosAndResourceExhaustion:
    LIMIT = 0.5

    def timed(self, fn):
        t0 = time.perf_counter()
        try:
            fn()
        except UnsentError:
            pass
        elapsed = time.perf_counter() - t0
        assert elapsed < self.LIMIT, f"took {elapsed:.2f}s"

    def client(self):
        return Unsent(base_url=BASE, api_key="k", transport=MockTransport(lambda r, n: accepted()))

    @pytest.mark.parametrize(
        "evil",
        [
            "a" * 100_000, " " * 100_000 + "<", '"' * 100_000, "<" * 100_000, ">" * 100_000, "a<" * 50_000, '"a' * 50_000, "\t" * 100_000 + "x",
            "<" + " " * 100_000, "x" + " " * 100_000 + "<a@b.co>", '"' + " " * 100_000 + '"<a@b.co>', "<a@b.co>" * 12_500, "a@" * 50_000,
            ("a " * 50_000) + "<x@y.co>", " " * 100_000 + "<a@b.co>", "\r" * 100_000, "@" * 100_000, "<" + "a" * 100_000 + ">",
        ],
    )  # fmt: skip
    def test_address_parsing_is_linear(self, evil):
        c = self.client()
        self.timed(lambda: c.send(from_=evil, **MSG))
        self.timed(lambda: c.send(**{**MSG, "to": evil}))
        self.timed(lambda: c.send(**{**MSG, "to": [evil] * 3, "cc": evil, "bcc": [evil]}))

    @pytest.mark.parametrize(
        "evil",
        ["A" * 100_000 + "!", "=" * 100_000, "A=" * 50_000, "A" * 99_999 + "=", " " * 100_000, "A B" * 33_000, "\n".join(["QUJD"] * 25_000), "A" * 100_000 + "\x00", "=" * 99_999 + "A",
         ("QQ==" * 25_000) + "="],
    )  # fmt: skip
    def test_base64_validation_is_linear(self, evil):
        c = self.client()
        self.timed(lambda: c.send(**MSG, attachments=[{"filename": "a", "content": evil}]))

    def test_other_long_inputs(self):
        c = self.client()
        big = "x" * 100_000
        self.timed(lambda: c.send(to="a@b.co", subject=big, html="h"))
        self.timed(lambda: c.send(**MSG, idempotency_key=big))
        self.timed(lambda: c.send(**MSG, provider_id=big))
        self.timed(lambda: c.send(**MSG, attachments=[{"filename": big, "content": "QQ=="}]))
        self.timed(lambda: c.emails.list(search=big))
        self.timed(lambda: Unsent(base_url="https://" + "a." * 50_000 + "com", api_key="k"))
        self.timed(lambda: Unsent(base_url="https://x.test/" + "../" * 50_000, api_key="k"))
        self.timed(lambda: Unsent(base_url=BASE, api_key="k" * 100_000))
        self.timed(lambda: Unsent(base_url=" " * 100_000 + BASE))
        self.timed(lambda: c.send(to=["a@b.co"] * 100_000, subject="s", html="h"))

    def test_hostile_response_parsing_is_fast(self):
        for body in (b"[" * 200_000, b'{"a":' * 100_000, b'"' + b"\\" * 200_000, b"9" * 1_000_000, b"1" + b"0" * 5_000_000 + b"e1"):
            m = MockTransport(lambda r, n, body=body: raw(body, 200))
            c = Unsent(base_url=BASE, api_key="k", transport=m, max_retries=0)
            t0 = time.perf_counter()
            with pytest.raises(UnsentError):
                c.status()
            assert time.perf_counter() - t0 < 2

    def test_headers_with_pathological_values_are_handled(self):
        for h in ("9" * 100_000, " " * 100_000, "Mon, " * 20_000, "\u0000" * 1000):
            m = MockTransport(lambda r, n, h=h: raw(b"{}", 503, {"Retry-After": h, "Date": h, "Location": h}))
            c = Unsent(base_url=BASE, api_key="k", transport=m, max_retries=0)
            t0 = time.perf_counter()
            with pytest.raises(UnsentError):
                c.status()
            assert time.perf_counter() - t0 < 0.5


class TestRandomness:
    def test_nonces_are_32_lowercase_hex_and_unique(self):
        n = [random_nonce() for _ in range(20_000)]
        assert all(re.fullmatch(r"[0-9a-f]{32}", x) for x in n) and len(set(n)) == len(n)

    def test_uuids_are_v4_and_unique(self):
        u = [random_uuid() for _ in range(5_000)]
        assert all(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", x) for x in u) and len(set(u)) == len(u)

    def test_the_signature_changes_with_every_request_and_covers_the_body(self):
        m = MockTransport(lambda r, n: accepted())
        c = Unsent(base_url=BASE, api_key="k", api_secret=API_SECRET, transport=m)
        for _ in range(5):
            c.send(**MSG, idempotency_key="same")
        assert len({r.header("X-Signature") for r in m.calls}) == 5
        assert len({r.body for r in m.calls}) == 1  # identical body, still distinct signatures (fresh nonce)


def test_streams_and_files_are_not_retained(tmp_path):
    f = io.BytesIO(b"abc")
    m = MockTransport(lambda r, n: accepted())
    Unsent(base_url=BASE, api_key="k", transport=m).send(**MSG, attachments=[{"filename": "a", "content": f}])
    assert not f.closed  # the SDK reads but never closes caller-owned files
