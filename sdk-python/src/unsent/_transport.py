"""Default HTTP transport built on ``http.client`` (stdlib only).

Properties that matter for this SDK:

* never follows redirects (``http.client`` does not), so the API key cannot be forwarded elsewhere;
* one overall deadline per attempt (connect + TLS + request + response), enforced by closing the socket;
* the socket is closed immediately on cancellation, so aborts do not wait for the server;
* response bodies are capped at 32 MiB;
* TLS certificates and host names are verified (``ssl.create_default_context()``).
"""

from __future__ import annotations

import http.client
import socket
import ssl
import threading
import time
from typing import Dict, List, Optional
from urllib.parse import urlsplit

from .errors import UnsentError
from .models import TransportRequest, TransportResponse, _Headers

MAX_RESPONSE_BYTES = 32 * 1024 * 1024
_CHUNK = 64 * 1024
_ssl_context: Optional[ssl.SSLContext] = None
_ssl_lock = threading.Lock()


def _context() -> ssl.SSLContext:
    global _ssl_context
    with _ssl_lock:
        if _ssl_context is None:
            _ssl_context = ssl.create_default_context()
        return _ssl_context


class _Killer:
    """Closes the in-flight socket from another thread (timeout watchdog or cancellation)."""

    def __init__(self) -> None:
        self.sock: Optional[socket.socket] = None
        self.reason: Optional[str] = None
        self._lock = threading.Lock()

    def kill(self, reason: str) -> None:
        with self._lock:
            if self.reason is None:
                self.reason = reason
            sock = self.sock
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    def set_sock(self, sock: socket.socket) -> None:
        with self._lock:
            self.sock = sock
            dead = self.reason is not None
        if dead:
            self.kill(self.reason or "cancel")

    def check(self) -> None:
        if self.reason == "timeout":
            raise TimeoutError("timed out")
        if self.reason is not None:
            raise OSError("aborted")


def _connect(host: str, port: int, deadline: float, killer: _Killer) -> socket.socket:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    killer.check()
    last: Optional[BaseException] = None
    for family, kind, proto, _canon, addr in infos:
        killer.check()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("timed out")
        sock = socket.socket(family, kind, proto)
        killer.set_sock(sock)
        try:
            sock.settimeout(remaining)
            sock.connect(addr)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            return sock
        except OSError as exc:
            last = exc
            killer.check()
            try:
                sock.close()
            except OSError:
                pass
    raise last if last is not None else OSError(f"could not resolve {host}")


def _too_large() -> UnsentError:
    return UnsentError(
        f"The response is larger than {MAX_RESPONSE_BYTES // (1024 * 1024)} MiB; refusing to read it.",
        code="response_too_large",
    )


class StdlibTransport:
    """The default :class:`~unsent.Transport`."""

    def send(self, request: TransportRequest) -> TransportResponse:
        parts = urlsplit(request.url)
        https = parts.scheme == "https"
        host = parts.hostname or ""
        port = parts.port or (443 if https else 80)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")

        killer = _Killer()
        deadline = time.monotonic() + request.timeout
        timer = threading.Timer(request.timeout, killer.kill, args=("timeout",))
        timer.daemon = True
        remove = request.cancel.add_callback(lambda: killer.kill("cancel"))
        timer.start()
        conn: Optional[http.client.HTTPConnection] = None
        try:
            sock = _connect(host, port, deadline, killer)
            if https:
                sock = _context().wrap_socket(sock, server_hostname=host)
                killer.set_sock(sock)
            killer.check()
            sock.settimeout(max(deadline - time.monotonic(), 0.001))
            if https:
                conn = http.client.HTTPSConnection(host, port, context=_context())
            else:
                conn = http.client.HTTPConnection(host, port)
            conn.set_debuglevel(0)  # never let a global debuglevel print our credentials
            conn.sock = sock
            # _Headers hides credentials in reprs, so tracebacks/debuggers that capture locals cannot leak them.
            headers = _Headers(request.headers)
            headers["Connection"] = "close"
            conn.request(request.method, target, body=request.body, headers=headers)
            resp = conn.getresponse()
            killer.check()  # http.client treats a closed socket as "end of headers"; do not mistake that for success
            length = resp.getheader("Content-Length")
            if length is not None and length.strip().isdigit() and int(length.strip()) > MAX_RESPONSE_BYTES:
                raise _too_large()
            chunks: List[bytes] = []
            total = 0
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RESPONSE_BYTES:
                    raise _too_large()
                chunks.append(chunk)
            killer.check()  # an EOF-delimited body cut short by the watchdog looks complete otherwise
            merged: Dict[str, str] = {}
            for name, value in resp.getheaders():
                key = name.lower()
                merged[key] = f"{merged[key]}, {value}" if key in merged else value
            return TransportResponse(status=resp.status, headers=merged, body=b"".join(chunks), reason=resp.reason or "")
        except UnsentError:
            raise
        except BaseException as exc:
            if killer.reason == "timeout":
                raise TimeoutError("timed out") from exc
            if killer.reason is not None:
                raise OSError("aborted") from exc
            if isinstance(exc, http.client.HTTPException):
                raise ConnectionError(f"{type(exc).__name__}: {exc}") from exc
            raise
        finally:
            timer.cancel()
            remove()
            if conn is not None:
                try:
                    conn.close()
                except OSError:
                    pass
            if killer.sock is not None:
                try:
                    killer.sock.close()
                except OSError:
                    pass
