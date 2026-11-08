"""Exceptions raised by the SDK.

Everything derives from :class:`UnsentError`, so ``except UnsentError`` handles every SDK failure.
Branch on ``error.code`` (stable) rather than on the message (may change).
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Type

__all__ = [
    "UnsentError",
    "UnsentConfigError",
    "UnsentValidationError",
    "UnsentConnectionError",
    "UnsentTimeoutError",
    "UnsentAPIError",
    "UnsentAuthenticationError",
    "UnsentPermissionError",
    "UnsentNotFoundError",
    "UnsentConflictError",
    "UnsentRequestError",
    "UnsentRateLimitError",
    "UnsentServerError",
    "api_error_from_response",
]

_MAX_TEXT = 1000


def _restore(cls: Type["UnsentError"], state: Dict[str, Any]) -> "UnsentError":
    obj = cls.__new__(cls)
    Exception.__init__(obj, state.get("message", ""))
    obj.__dict__.update(state)
    return obj


class UnsentError(Exception):
    """Base class of every error raised by the SDK."""

    #: Stable machine-readable code, e.g. ``invalid_api_key``, ``validation_error``, ``timeout``.
    code: str
    #: Extra detail from the server (the API's ``reason`` field), when present.
    reason: Optional[str]
    #: A short suggestion for fixing the problem, when the SDK knows one.
    hint: Optional[str]

    def __init__(
        self,
        message: str,
        *,
        code: str,
        reason: Optional[str] = None,
        hint: Optional[str] = None,
        cause: Optional[BaseException] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.reason = reason
        self.hint = hint
        if cause is not None:
            self.__cause__ = cause

    def __str__(self) -> str:
        return self.message

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, message={self.message!r})"

    def __reduce__(self) -> Any:
        # Keyword-only constructors break default exception pickling (multiprocessing, Celery...).
        state = {k: v for k, v in self.__dict__.items()}
        return (_restore, (type(self), state))


class UnsentConfigError(UnsentError):
    """The client was constructed with invalid options. Nothing was sent."""

    def __init__(self, message: str, code: str = "invalid_config") -> None:
        super().__init__(message, code=code)


class UnsentValidationError(UnsentError):
    """A call argument failed client-side validation. Nothing was sent."""

    def __init__(self, message: str, code: str = "validation_error") -> None:
        super().__init__(message, code=code)


class UnsentConnectionError(UnsentError):
    """The request never produced an HTTP response (DNS, TLS, reset, offline, aborted...)."""

    def __init__(
        self, message: str, *, code: str = "connection_error", cause: Optional[BaseException] = None
    ) -> None:
        super().__init__(message, code=code, cause=cause)


class UnsentTimeoutError(UnsentConnectionError):
    """A request attempt (or ``wait()``) exceeded its timeout."""

    def __init__(self, message: str, *, cause: Optional[BaseException] = None) -> None:
        super().__init__(message, code="timeout", cause=cause)


class UnsentAPIError(UnsentError):
    """The server answered with an error status."""

    status: int
    #: Parsed JSON error body (``{error, code, reason?}``), or raw text when the body was not JSON.
    body: Any
    #: ``id`` of the conflicting email on idempotency conflicts (409).
    existing_email_id: Optional[int]
    #: Delay requested by the server via ``Retry-After``, in seconds (capped at 60).
    retry_after: Optional[float]
    #: Server time (epoch seconds) from the response ``Date`` header, when present.
    server_time: Optional[float]

    def __init__(
        self,
        message: str,
        *,
        status: int,
        code: str,
        reason: Optional[str] = None,
        hint: Optional[str] = None,
        body: Any = None,
        existing_email_id: Optional[int] = None,
        retry_after: Optional[float] = None,
        server_time: Optional[float] = None,
    ) -> None:
        super().__init__(message, code=code, reason=reason, hint=hint)
        self.status = status
        self.body = body
        self.existing_email_id = existing_email_id
        self.retry_after = retry_after
        self.server_time = server_time

    def __repr__(self) -> str:
        return f"{type(self).__name__}(status={self.status}, code={self.code!r}, message={self.message!r})"


class UnsentAuthenticationError(UnsentAPIError):
    """401: bad API key, bad signature, clock skew, replayed nonce..."""


class UnsentPermissionError(UnsentAPIError):
    """403: the endpoint needs an admin dashboard session, which API keys cannot provide."""


class UnsentNotFoundError(UnsentAPIError):
    """404: unknown email or route."""


class UnsentConflictError(UnsentAPIError):
    """409: the idempotency key was already used for a different email."""


class UnsentRequestError(UnsentAPIError):
    """400/413: the server rejected the request contents."""


class UnsentRateLimitError(UnsentAPIError):
    """429."""


class UnsentServerError(UnsentAPIError):
    """5xx: server-side failure. Safe to retry when an idempotency key was used."""


_SIGNED = "The server requires signed requests. Pass api_secret (UNSENT_API_SECRET) to the client."
_HINTS: Dict[str, str] = {
    "invalid_api_key": "Check that api_key matches the API_KEY secret of your Unsent deployment.",
    "unauthorized": "Check that api_key matches the API_KEY secret of your Unsent deployment.",
    "invalid_signature": "Check that api_secret matches the API_SECRET secret of your Unsent deployment (no extra whitespace).",
    "missing_signature": _SIGNED,
    "nonce_reused": "A nonce was replayed. This should not happen with the SDK; check for proxies that duplicate requests.",
    "server_misconfigured": "The Unsent server is missing configuration (API_KEY, API_SECRET, SECURITY_MODE or IDEMPOTENCY_TTL_HOURS). See the server logs.",
    "unauthorized_sender": 'The "from" address or provider_id is not an active provider. Configure it in the dashboard, or omit "from" to use the default provider.',
    "forbidden": "This endpoint needs an admin dashboard session; API keys cannot call it.",
}


def _clip(text: str) -> str:
    return text if len(text) <= _MAX_TEXT else text[:_MAX_TEXT] + "..."


def api_error_from_response(
    status: int,
    body: Any,
    *,
    has_api_secret: bool,
    retry_after: Optional[float] = None,
    server_time: Optional[float] = None,
    status_text: str = "",
) -> UnsentAPIError:
    """Build the right error class from an HTTP error response."""
    obj: Optional[Dict[str, Any]] = body if isinstance(body, dict) else None
    raw_code = obj.get("code") if obj else None
    if isinstance(raw_code, str) and raw_code:
        code = _clip(raw_code)
    else:
        code = "internal_error" if status >= 500 else f"http_{status}"

    raw_error = obj.get("error") if obj else None
    if isinstance(raw_error, str) and raw_error:
        base = _clip(raw_error)
    elif isinstance(body, str) and body.strip():
        base = body.strip()[:200]
    else:
        base = status_text or f"HTTP {status}"
    raw_reason = obj.get("reason") if obj else None
    reason = _clip(raw_reason) if isinstance(raw_reason, str) else None

    hint = _HINTS.get(code)
    if code == "timestamp_skew":
        hint = (
            "Your system clock differs from the server by more than 3 minutes. Sync it (NTP)."
            if has_api_secret
            else _SIGNED
        )
    elif code == "invalid_nonce" and not has_api_secret:
        hint = _SIGNED

    message = f"{base}: {reason}" if reason and reason not in base else base
    if hint:
        message += f" ({hint})"

    existing: Optional[int] = None
    if obj is not None:
        raw_id = obj.get("id")
        if isinstance(raw_id, int) and not isinstance(raw_id, bool):
            existing = raw_id
        elif isinstance(raw_id, float) and raw_id.is_integer() and abs(raw_id) < 2**53:
            existing = int(raw_id)

    kwargs: Dict[str, Any] = dict(
        status=status,
        code=code,
        reason=reason,
        hint=hint,
        body=body,
        existing_email_id=existing,
        retry_after=retry_after,
        server_time=server_time,
    )
    cls: Type[UnsentAPIError]
    if status == 401:
        cls = UnsentAuthenticationError
    elif status == 403:
        cls = UnsentPermissionError
    elif status == 404:
        cls = UnsentNotFoundError
    elif status == 409:
        cls = UnsentConflictError
    elif status == 429:
        cls = UnsentRateLimitError
    elif status >= 500:
        cls = UnsentServerError
    elif status in (400, 413):
        cls = UnsentRequestError
    else:
        cls = UnsentAPIError
    return cls(message, **kwargs)
