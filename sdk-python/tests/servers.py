"""Tiny raw-socket servers for exercising the real stdlib transport against hostile behavior."""

from __future__ import annotations

import socket
import threading
import time
from typing import Callable, List, Optional, Tuple

Behavior = Callable[[socket.socket, bytes], None]


def read_request(conn: socket.socket, limit: int = 8 * 1024 * 1024) -> bytes:
    data = b""
    conn.settimeout(5)
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(65536)
        if not chunk:
            return data
        data += chunk
    head, _, rest = data.partition(b"\r\n\r\n")
    length = 0
    for line in head.split(b"\r\n")[1:]:
        k, _, v = line.partition(b":")
        if k.strip().lower() == b"content-length":
            length = int(v.strip())
    while len(rest) < length and len(data) < limit:
        chunk = conn.recv(65536)
        if not chunk:
            break
        rest += chunk
        data += chunk
    return head + b"\r\n\r\n" + rest


class RawServer:
    """Accepts connections and runs ``behavior(conn, request_bytes)`` for each (in a thread)."""

    def __init__(self, behavior: Behavior, read_first: bool = True) -> None:
        self.behavior = behavior
        self.read_first = read_first
        self.requests: List[bytes] = []
        self.connections = 0
        self._sock = socket.socket()
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(64)
        self.port = self._sock.getsockname()[1]
        self._stop = threading.Event()
        self._threads: List[threading.Thread] = []
        t = threading.Thread(target=self._accept, daemon=True)
        t.start()
        self._threads.append(t)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _accept(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except OSError:
                return
            self.connections += 1
            t = threading.Thread(target=self._serve, args=(conn,), daemon=True)
            t.start()
            self._threads.append(t)

    def _serve(self, conn: socket.socket) -> None:
        try:
            req = read_request(conn) if self.read_first else b""
            self.requests.append(req)
            self.behavior(conn, req)
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def close(self) -> None:
        self._stop.set()
        try:
            self._sock.close()
        except OSError:
            pass

    def __enter__(self) -> "RawServer":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def http_response(status: int, body: bytes = b"", headers: Optional[List[Tuple[str, str]]] = None, reason: str = "OK") -> bytes:
    head = f"HTTP/1.1 {status} {reason}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n"
    for k, v in headers or []:
        head += f"{k}: {v}\r\n"
    return head.encode() + b"\r\n" + body


def respond(status: int, body: bytes = b"", headers: Optional[List[Tuple[str, str]]] = None, reason: str = "OK") -> Behavior:
    payload = http_response(status, body, headers, reason)

    def behavior(conn: socket.socket, req: bytes) -> None:
        conn.sendall(payload)

    return behavior


def hang_forever(conn: socket.socket, req: bytes) -> None:
    time.sleep(30)


def drip_headers(conn: socket.socket, req: bytes) -> None:
    conn.sendall(b"HTTP/1.1 200 OK\r\n")
    for _ in range(600):
        conn.sendall(b"X-Slow: a\r\n")
        time.sleep(0.05)


def endless_body(conn: socket.socket, req: bytes) -> None:
    conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n")
    chunk = b" " * 4096
    for _ in range(100000):
        conn.sendall(chunk)
        time.sleep(0.01)


def drip_body(conn: socket.socket, req: bytes) -> None:
    conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n")
    for _ in range(1000):
        conn.sendall(b" ")
        time.sleep(0.05)


def close_without_reply(conn: socket.socket, req: bytes) -> None:
    conn.close()
