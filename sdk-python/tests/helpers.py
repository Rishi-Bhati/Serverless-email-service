"""Shared test helpers: a mock transport, an independent server-side signature check, fake time."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import inspect
import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set
from urllib.parse import parse_qsl, urlsplit

import unsent
from unsent import AsyncUnsent, TransportRequest, TransportResponse, Unsent

BASE = "https://unsent.test"
API_KEY = "test-api-key"
API_SECRET = "test-api-secret"


@dataclass
class Recorded:
    method: str
    url: str
    headers: Dict[str, str]  # lower-cased names
    body: str
    json: Any
    cancel: Any = None
    timeout: float = 0.0
    path: str = ""
    query: Dict[str, str] = field(default_factory=dict)

    def header(self, name: str) -> Optional[str]:
        return self.headers.get(name.lower())

    def has(self, name: str) -> bool:
        return name.lower() in self.headers


Handler = Callable[[Recorded, int], TransportResponse]


class MockTransport:
    """Records requests and delegates to ``handler(rec, call_number)``. Thread-safe."""

    def __init__(self, handler: Handler) -> None:
        self.handler = handler
        self.calls: List[Recorded] = []
        self._lock = threading.Lock()

    def send(self, req: TransportRequest) -> TransportResponse:
        parts = urlsplit(req.url)
        body = req.body.decode("utf-8") if req.body else ""
        rec = Recorded(
            method=req.method,
            url=req.url,
            headers={k.lower(): v for k, v in req.headers.items()},
            body=body,
            json=json.loads(body) if body else None,
            cancel=req.cancel,
            timeout=req.timeout,
            path=parts.path,
            query=dict(parse_qsl(parts.query)),
        )
        with self._lock:
            self.calls.append(rec)
            n = len(self.calls)
        return self.handler(rec, n)


class AsyncMockTransport(MockTransport):
    async def send(self, req: TransportRequest) -> TransportResponse:  # type: ignore[override]
        return MockTransport.send(self, req)


def resp(data: Any, status: int = 200, headers: Optional[Dict[str, str]] = None) -> TransportResponse:
    return TransportResponse(status=status, headers={"Content-Type": "application/json", **(headers or {})}, body=json.dumps(data).encode())


def raw(body: bytes, status: int = 200, headers: Optional[Dict[str, str]] = None, reason: str = "") -> TransportResponse:
    return TransportResponse(status=status, headers=headers or {}, body=body, reason=reason)


def accepted(id: int = 1, **extra: Any) -> TransportResponse:
    return resp(
        {
            "success": True, "id": id, "status": "queued", "idempotent_replay": False,
            "message": "Email successfully queued for sending", "targetProvider": "Automatic Priority / Default", **extra,
        },
        202,
    )  # fmt: skip


def api_error(status: int, code: str, error: str = "Error", reason: Optional[str] = None, headers: Optional[Dict[str, str]] = None) -> TransportResponse:
    body: Dict[str, Any] = {"error": error, "code": code}
    if reason:
        body["reason"] = reason
    return resp(body, status, headers)


def hang(req_rec: Recorded, n: int = 0) -> TransportResponse:
    """Simulate a hung server: block until cancelled or the attempt timeout elapses."""
    if req_rec.cancel.wait(req_rec.timeout):
        raise OSError("aborted")
    raise TimeoutError("timed out")


def verify_signed(rec: Recorded, secret: str = API_SECRET, used_nonces: Optional[Set[str]] = None, now: Optional[float] = None) -> Any:
    """Independent re-implementation of the server's checks (src/auth.ts, `full` mode, no routing headers)."""
    if rec.header("X-API-Key") != API_KEY:
        return "invalid_api_key"
    ts = rec.header("X-Timestamp") or ""
    current = time.time() if now is None else now
    if not re.fullmatch(r"\d+", ts) or abs(current - int(ts)) > 180:
        return "timestamp_skew"
    nonce = rec.header("X-Nonce") or ""
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,128}", nonce):
        return "invalid_nonce"
    sig = (rec.header("X-Signature") or "")
    sig = sig[7:] if sig.startswith("sha256=") else sig
    body_hash = hashlib.sha256(rec.body.encode("utf-8")).hexdigest()
    expected = hmac.new(secret.encode(), f"{ts}\n{nonce}\n{body_hash}".encode(), hashlib.sha256).hexdigest()
    if sig.lower() != expected:
        return "invalid_signature"
    if used_nonces is not None:
        if nonce in used_nonces:
            return "nonce_reused"
        used_nonces.add(nonce)
    if rec.has("X-Provider-Id") or rec.has("X-Sender-Email") or rec.has("Idempotency-Key"):
        return "invalid_signature"
    return True


class Flavor:
    """Runs the same scenario against the sync and the async client."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.is_async = name == "async"

    def make(self, handler: Handler, **opts: Any) -> Any:
        opts.setdefault("base_url", BASE)
        opts.setdefault("api_key", API_KEY)
        opts.setdefault("api_secret", API_SECRET)
        mock = MockTransport(handler)
        cls = AsyncUnsent if self.is_async else Unsent
        client = cls(transport=mock, **opts)
        return mock, client

    def run(self, value: Any) -> Any:
        if inspect.isawaitable(value):
            return asyncio.run(_await(value))
        return value

    def collect(self, iterator: Any) -> List[Any]:
        if self.is_async:

            async def go() -> List[Any]:
                return [x async for x in iterator]

            return asyncio.run(go())
        return list(iterator)

    def raises(self, fn: Callable[[], Any]) -> BaseException:
        try:
            self.run(fn())
        except BaseException as exc:  # noqa: BLE001 - tests inspect any exception
            return exc
        raise AssertionError("expected an exception")


async def _await(value: Any) -> Any:
    return await value


class FakeTime:
    """Deterministic clock: sleeps advance time instantly and are recorded."""

    def __init__(self, start: float = 1_780_000_000.0) -> None:
        self.now = start  # seconds
        self.sleeps: List[float] = []

    def now_ms(self) -> float:
        return self.now * 1000.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, cancel: Any, seconds: float) -> bool:
        if cancel.is_cancelled:
            return True
        self.sleeps.append(seconds)
        self.now += seconds
        return False

    async def asleep(self, cancel: Any, seconds: float) -> bool:
        await asyncio.sleep(0)
        return self.sleep(cancel, seconds)


_ = unsent
