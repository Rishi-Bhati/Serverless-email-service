"""Sans-IO core shared by the sync and async clients.

The retry / signing / clock-skew logic lives in one generator, :func:`call_plan`. It yields
:class:`Attempt` (perform one HTTP exchange) and :class:`Sleep` (wait, cancellably) steps; the
sync and async drivers in ``client.py`` / ``async_client.py`` only perform the I/O. Exceptions from the
I/O are thrown back into the generator, so both flavors behave identically by construction.
"""

from __future__ import annotations

import calendar
import dataclasses
import email.utils
import http.client
import ipaddress
import json
import math
import random
import re
import socket
import time
from typing import Any, Dict, Generator, List, Mapping, Optional, Union
from urllib.parse import quote, urlencode, urlsplit

from ._crypto import random_nonce, sign_request
from ._util import clean_text
from ._version import __version__
from .cancel import CancelToken
from .errors import (
    UnsentAPIError,
    UnsentConfigError,
    UnsentConnectionError,
    UnsentError,
    UnsentTimeoutError,
    UnsentValidationError,
    api_error_from_response,
)
from .models import TransportRequest, TransportResponse, _Headers

MAX_BACKOFF_S = 8.0
MAX_RETRY_AFTER_S = 60.0
BASE_BACKOFF_S = 0.5
#: Skews smaller than this are not worth correcting (the server tolerates 180 s).
MIN_CLOCK_CORRECTION_MS = 30_000
MAX_ATTEMPT_TIMEOUT_S = 86_400.0
MAX_BODY_BYTES = 3 * 1024 * 1024
USER_AGENT = f"unsent-sdk-python/{__version__}"


def now_ms() -> float:
    """Wall clock in milliseconds (patched by tests)."""
    return time.time() * 1000.0


def monotonic() -> float:
    """Monotonic clock in seconds (patched by tests)."""
    return time.monotonic()


class Secret:
    """Holds a credential; never prints it, never pickles."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        self._value = value

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "Secret(<redacted>)"

    __str__ = __repr__

    def __reduce__(self) -> Any:
        raise TypeError("credentials cannot be pickled")

    def __copy__(self) -> "Secret":
        return self

    def __deepcopy__(self, memo: Any) -> "Secret":
        return self


# ---------------------------------------------------------------------------------------------
# option validation


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_timeout(value: Any, name: str, exc: type = UnsentConfigError) -> float:
    if not _is_number(value) or not math.isfinite(value) or not value > 0:
        raise exc(f"{name} must be a positive, finite number of seconds")
    return float(value)


def check_max_retries(value: Any, name: str, exc: type = UnsentConfigError) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise exc(f"{name} must be an integer from 0 to 10")
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise exc(f"{name} must be an integer from 0 to 10")
    if not 0 <= value <= 10:
        raise exc(f"{name} must be an integer from 0 to 10")
    return int(value)


_LABEL_RE = re.compile(r"[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?")


def _remove_dot_segments(path: str) -> str:
    out: List[str] = []
    for seg in path.split("/"):
        if seg == ".":
            continue
        if seg == "..":
            if len(out) > 1:
                out.pop()
            continue
        out.append(seg)
    return "/".join(out)


def normalize_base_url(raw: str) -> str:
    """Trim, validate and canonicalize the deployment URL. See SPEC section 1."""
    s = raw.strip()
    invalid = UnsentConfigError(
        f"base_url {s[:80]!r} is not a valid URL. Expected something like https://unsent.example.com"
    )
    if not s or any(ord(c) <= 0x20 or ord(c) == 0x7F or c == "\\" for c in s):
        raise invalid
    try:
        parts = urlsplit(s)
        scheme = parts.scheme.lower()
        if not scheme or not parts.netloc:
            raise invalid
        if scheme not in ("http", "https"):
            raise UnsentConfigError(f"base_url must start with https:// (got {scheme}://)")
        if "@" in parts.netloc:
            raise UnsentConfigError("base_url must not contain credentials; pass api_key/api_secret instead.")
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise invalid from exc
    if not host:
        raise invalid

    ipv6 = ":" in host
    if ipv6:
        try:
            host = str(ipaddress.IPv6Address(host))
        except ValueError as exc:
            raise invalid from exc
    else:
        try:
            host = host.encode("idna").decode("ascii").lower() if not host.isascii() else host.lower()
        except UnicodeError as exc:
            raise invalid from exc
        bare = host[:-1] if host.endswith(".") else host
        if not bare or len(bare) > 253 or not all(_LABEL_RE.fullmatch(lbl) for lbl in bare.split(".")):
            raise invalid

    loopback = host in ("localhost", "127.0.0.1", "::1") or host.endswith(".localhost")
    if scheme == "http" and not loopback:
        raise UnsentConfigError(
            "base_url uses plain http://, which would send your API key unencrypted. "
            "Use https:// (http:// is only allowed for localhost)."
        )

    default_port = 443 if scheme == "https" else 80
    netloc = f"[{host}]" if ipv6 else host
    if port is not None and port != default_port:
        netloc += f":{port}"
    path = quote(_remove_dot_segments(parts.path), safe="/%:@!$&'()*+,;=-._~").rstrip("/")
    return f"{scheme}://{netloc}{path}"


# ---------------------------------------------------------------------------------------------
# plan


@dataclasses.dataclass
class CallOptions:
    method: str
    path: str
    query: Optional[Dict[str, Any]] = None
    body: Optional[bytes] = None
    #: Sign with HMAC (POST /api/send). GET endpoints authenticate with the API key alone.
    sign: bool = False
    #: Send the API key. ``False`` for the public health probe.
    auth: bool = True
    #: May be re-sent after an ambiguous failure without risk of duplication.
    retry_safe: bool = False
    timeout: Optional[float] = None
    max_retries: Optional[int] = None


@dataclasses.dataclass
class CallResult:
    status: int
    data: Any
    headers: Mapping[str, str]


@dataclasses.dataclass
class Attempt:
    request: TransportRequest


@dataclasses.dataclass
class Sleep:
    seconds: float


Step = Union[Attempt, Sleep]
Plan = Generator[Step, Any, CallResult]


class ClientState:
    """Immutable configuration plus the learned clock offset. Secrets are held in :class:`Secret`."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        api_secret: Optional[str],
        timeout: float,
        max_retries: int,
    ) -> None:
        self.base_url = base_url
        self.host = urlsplit(base_url).netloc
        self._api_key = Secret(api_key)
        self._api_secret = Secret(api_secret) if api_secret else None
        self.timeout = timeout
        self.max_retries = max_retries
        #: Server clock minus local clock, learned from a ``timestamp_skew`` response.
        self.clock_offset_ms = 0.0

    @property
    def has_api_secret(self) -> bool:
        return self._api_secret is not None

    def __repr__(self) -> str:
        return f"ClientState(base_url={self.base_url!r}, has_api_secret={self.has_api_secret})"

    def __reduce__(self) -> Any:
        raise TypeError("clients cannot be pickled (they hold credentials)")


def abort_error(what: str = "The request was aborted") -> UnsentConnectionError:
    return UnsentConnectionError(what, code="aborted")


def backoff(attempt: int) -> float:
    exp = min(MAX_BACKOFF_S, BASE_BACKOFF_S * 2**attempt)
    return float(round(exp / 2 + random.random() * (exp / 2), 3))


_RETRY_AFTER_RE = re.compile(r"\s*(\d{1,20})(\.\d{1,6})?\s*")


def parse_retry_after(header: Optional[str]) -> Optional[float]:
    """Seconds, capped at 60; ``None`` if absent or invalid."""
    if not header or len(header) > 200:
        return None
    m = _RETRY_AFTER_RE.fullmatch(header)
    if m:
        return min(float(m.group(1) + (m.group(2) or "")), MAX_RETRY_AFTER_S)
    ts = parse_http_date(header)
    if ts is None:
        return None
    return min(max(0.0, ts - now_ms() / 1000.0), MAX_RETRY_AFTER_S)


def parse_http_date(header: Optional[str]) -> Optional[float]:
    """HTTP-date to epoch seconds, or ``None``."""
    if not header or len(header) > 200:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(header)
        if dt is None:
            return None
        return float(calendar.timegm(dt.utctimetuple()))
    except (TypeError, ValueError, IndexError, OverflowError):
        return None


def is_retryable_status(err: UnsentAPIError) -> bool:
    if err.code == "server_misconfigured":
        return False
    s = err.status
    return s in (408, 425, 429) or (s >= 500 and s not in (501, 505))


def _reject_constant(name: str) -> Any:
    raise ValueError(f"invalid JSON constant {name}")


def parse_body(body: Any) -> "tuple[str, Any, bool]":
    """Decode a response body: ``(text, parsed, is_json)``."""
    if isinstance(body, str):
        text = body
    else:
        try:
            text = bytes(body).decode("utf-8", errors="replace")
        except (TypeError, ValueError):
            text = ""
    if text.startswith("﻿"):
        text = text[1:]
    if not text:
        return text, text, False
    try:
        return text, json.loads(text, parse_constant=_reject_constant), True
    except (ValueError, RecursionError):
        return text, text, False


def scrub_traceback(exc: Optional[BaseException]) -> None:
    """Drop traceback frames from a transport exception chain.

    Frames inside ``http.client`` hold the raw request bytes (including the API key) in their locals;
    tools that capture locals on error (Sentry, pytest ``--showlocals``) would otherwise log them.
    """
    seen = 0
    while exc is not None and seen < 20:
        exc.__traceback__ = None
        nxt = exc.__cause__ or exc.__context__
        exc = nxt if nxt is not exc else None
        seen += 1


def map_transport_error(
    exc: BaseException, *, cancel: CancelToken, timeout: float, host: str, path: str
) -> Optional[UnsentError]:
    """Translate an exception raised by a transport. ``None`` means: not ours, re-raise."""
    if isinstance(exc, UnsentError):
        return exc
    if isinstance(exc, (OSError, http.client.HTTPException, EOFError)):
        scrub_traceback(exc)
    if cancel.is_cancelled:
        return abort_error()
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return UnsentTimeoutError(f"Request to {path} timed out after {timeout:g} s", cause=exc)
    if isinstance(exc, (OSError, http.client.HTTPException, EOFError)):
        cause = exc.__cause__ or exc
        detail = clean_text(str(cause) or type(cause).__name__)
        return UnsentConnectionError(f"Could not reach {host}: {detail}", cause=exc)
    return None


def build_url(base_url: str, path: str, query: Optional[Dict[str, Any]]) -> str:
    url = base_url + path
    if query:
        items = [(k, str(v)) for k, v in query.items() if v is not None and v != ""]
        if items:
            url += "?" + urlencode(items, quote_via=quote)
    return url


def interpret(resp: TransportResponse, st: ClientState, path: str) -> CallResult:
    status = resp.status
    if not isinstance(status, int) or isinstance(status, bool):
        raise UnsentError(f"The transport returned a response without a valid status for {path}", code="invalid_response")
    headers = resp.headers
    if 300 <= status < 400:
        location = headers.get("location")
        where = f" to {clean_text(location)}" if location else ""
        raise UnsentError(
            f"{path} was redirected{where}. The SDK does not follow redirects because that would send your API key "
            "to another host. Set base_url to the final URL (use https://).",
            code="unexpected_redirect",
        )
    text, parsed, is_json = parse_body(resp.body)
    if not 200 <= status < 300:
        raise api_error_from_response(
            status,
            parsed if is_json else text,
            has_api_secret=st.has_api_secret,
            retry_after=parse_retry_after(headers.get("retry-after")),
            server_time=parse_http_date(headers.get("date")),
            status_text=resp.reason if isinstance(resp.reason, str) else "",
        )
    if not is_json:
        raise UnsentError(
            f"Unexpected non-JSON response from {path} (HTTP {status}). Is base_url pointing at your Unsent deployment?",
            code="invalid_response",
        )
    return CallResult(status=status, data=parsed, headers=headers)


def _build_request(
    st: ClientState, opts: CallOptions, timeout: float, cancel: CancelToken, with_auth: bool, sign: bool
) -> TransportRequest:
    headers = _Headers({"Accept": "application/json", "User-Agent": USER_AGENT})
    if with_auth:
        headers["X-API-Key"] = st._api_key.reveal()
    if opts.body is not None:
        headers["Content-Type"] = "application/json"
    if sign and st._api_secret is not None:
        # Fresh timestamp + nonce on every attempt: the server rejects reused nonces.
        timestamp = str(int(math.floor((now_ms() + st.clock_offset_ms) / 1000.0)))
        nonce = random_nonce()
        headers["X-Timestamp"] = timestamp
        headers["X-Nonce"] = nonce
        headers["X-Signature"] = "sha256=" + sign_request(
            secret=st._api_secret.reveal(), timestamp=timestamp, nonce=nonce, body=opts.body or b""
        )
    return TransportRequest(
        method=opts.method,
        url=build_url(st.base_url, opts.path, opts.query),
        headers=headers,
        body=opts.body,
        timeout=timeout,
        cancel=cancel,
    )


def _attempt(st: ClientState, opts: CallOptions, timeout: float, cancel: CancelToken) -> Plan:
    req = _build_request(st, opts, timeout, cancel, opts.auth, opts.sign)
    resp: TransportResponse = yield Attempt(req)
    return interpret(resp, st, opts.path)


def _sync_clock(st: ClientState, err: UnsentError, timeout: float, cancel: CancelToken) -> Generator[Step, Any, bool]:
    """Learn the server clock from the error's ``Date`` header or the public health probe.

    Returns True when a meaningful offset was learned (or a stale one dropped) and a retry is worthwhile.
    """
    server_ms: Optional[float] = None
    local_ms = now_ms()
    st_time = getattr(err, "server_time", None)
    if isinstance(st_time, (int, float)):
        server_ms = st_time * 1000.0
    else:
        try:
            before = now_ms()
            probe = CallOptions(method="GET", path="/api/health", auth=False, retry_safe=True)
            res = yield from _attempt(st, probe, min(timeout, 5.0), cancel)
            after = now_ms()
        except UnsentError:
            return False
        ts = res.data.get("timestamp") if isinstance(res.data, dict) else None
        if not isinstance(ts, (int, float)) or isinstance(ts, bool) or not math.isfinite(ts):
            return False
        server_ms = float(ts)
        local_ms = (before + after) / 2.0
    offset = server_ms - local_ms
    if abs(offset) < MIN_CLOCK_CORRECTION_MS:
        # The local clock is fine now. If we were compensating for an earlier skew (e.g. the host clock
        # was since fixed), drop the stale offset and retry; otherwise skew is not the problem.
        if st.clock_offset_ms == 0:
            return False
        st.clock_offset_ms = 0.0
        return True
    st.clock_offset_ms = offset
    return True


def call_plan(st: ClientState, opts: CallOptions, cancel: CancelToken) -> Plan:
    max_retries = st.max_retries if opts.max_retries is None else max(0, opts.max_retries)
    timeout = min(opts.timeout if opts.timeout is not None else st.timeout, MAX_ATTEMPT_TIMEOUT_S)
    attempt = 0
    clock_corrected = False
    while True:
        if cancel.is_cancelled:
            raise abort_error()
        try:
            return (yield from _attempt(st, opts, timeout, cancel))
        except UnsentError as err:
            if cancel.is_cancelled:
                raise abort_error() from err
            # A skewed local clock fails signature checks before the nonce is consumed, so one
            # corrected retry is free and always safe.
            if not clock_corrected and err.code == "timestamp_skew" and st.has_api_secret:
                clock_corrected = True
                if (yield from _sync_clock(st, err, timeout, cancel)):
                    continue
            if cancel.is_cancelled:
                raise abort_error() from err
            delay: Optional[float] = None
            if attempt < max_retries and opts.retry_safe:
                if isinstance(err, UnsentConnectionError) and err.code != "aborted":
                    delay = backoff(attempt)
                elif isinstance(err, UnsentAPIError) and is_retryable_status(err):
                    delay = max(backoff(attempt), err.retry_after or 0.0)
            if delay is None:
                raise
            attempt += 1
            yield Sleep(delay)
