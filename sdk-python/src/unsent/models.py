"""Public data types."""

from __future__ import annotations

import dataclasses
import datetime as _dt
from typing import (
    IO,
    Any,
    Dict,
    List,
    Mapping,
    Optional,
    Protocol,
    Union,
    runtime_checkable,
)

__all__ = [
    "Address",
    "Attachment",
    "AttachmentDetail",
    "AttachmentInfo",
    "Email",
    "EmailDetail",
    "EmailStatus",
    "FailoverAttempt",
    "Health",
    "ListEmailsResult",
    "QueueStatus",
    "SendEmailResult",
    "Transport",
    "TransportRequest",
    "TransportResponse",
    "AsyncTransport",
]

EmailStatus = str  # one of "queued" | "sending" | "sent" | "failed"

#: ``"a@b.com"``, ``"Name <a@b.com>"`` or ``{"email": ..., "name": ...}``.
Address = Union[str, Mapping[str, Any]]


@dataclasses.dataclass
class Attachment:
    """A file to attach.

    ``content`` as ``str`` is treated as **already base64-encoded** (the API's wire format).
    Pass ``bytes`` / ``bytearray`` / ``memoryview`` / a binary file object and the SDK encodes it.
    Plain ``dict`` s with the same keys (``filename``, ``content``, ``content_type`` / ``mime_type``) work too.
    """

    content: Union[str, bytes, bytearray, memoryview, IO[bytes]]
    filename: Optional[str] = None
    content_type: Optional[str] = None
    mime_type: Optional[str] = None


@dataclasses.dataclass(frozen=True)
class SendEmailResult:
    id: int
    #: ``queued`` for a new email; the current status on an idempotent replay.
    status: str
    #: The key used (yours, or the generated one); ``None`` if idempotency was disabled.
    idempotency_key: Optional[str]
    #: ``True`` when the key matched an email already queued; no new email was created.
    idempotent_replay: bool
    target_provider: str
    message: str


@dataclasses.dataclass(frozen=True)
class FailoverAttempt:
    provider: str
    type: str
    error: str
    timestamp: _dt.datetime


@dataclasses.dataclass(frozen=True)
class AttachmentInfo:
    filename: str
    mime_type: Optional[str]
    #: Decoded size in bytes.
    size: int


@dataclasses.dataclass(frozen=True)
class AttachmentDetail(AttachmentInfo):
    #: Base64 content.
    content: str = ""

    def to_bytes(self) -> bytes:
        """Decode the base64 content."""
        import base64

        return base64.b64decode(self.content)


@dataclasses.dataclass(frozen=True)
class Email:
    """An email as stored by the service (list view: attachment metadata only)."""

    id: int
    status: str
    to: List[str]
    cc: Optional[List[str]]
    bcc: Optional[List[str]]
    subject: str
    html_body: str
    #: ``None`` when the email was sent without a plain-text alternative.
    text_body: Optional[str]
    from_email: Optional[str]
    from_name: Optional[str]
    provider_id: Optional[str]
    provider_used: Optional[str]
    failover_history: List[FailoverAttempt]
    idempotency_key: Optional[str]
    attempts: int
    error: Optional[str]
    created_at: _dt.datetime
    updated_at: _dt.datetime
    attachments: List[AttachmentInfo]


@dataclasses.dataclass(frozen=True)
class EmailDetail:
    """Full email from ``emails.get``; attachments include their base64 ``content``."""

    id: int
    status: str
    to: List[str]
    cc: Optional[List[str]]
    bcc: Optional[List[str]]
    subject: str
    html_body: str
    text_body: Optional[str]
    from_email: Optional[str]
    from_name: Optional[str]
    provider_id: Optional[str]
    provider_used: Optional[str]
    failover_history: List[FailoverAttempt]
    idempotency_key: Optional[str]
    attempts: int
    error: Optional[str]
    created_at: _dt.datetime
    updated_at: _dt.datetime
    attachments: List[AttachmentDetail]


@dataclasses.dataclass(frozen=True)
class ListEmailsResult:
    emails: List[Email]
    total: int
    limit: int
    offset: int
    has_more: bool


@dataclasses.dataclass(frozen=True)
class QueueStatus:
    queued: int
    sending: int
    sent: int
    failed: int


@dataclasses.dataclass(frozen=True)
class Health:
    status: str
    runtime: str
    d1: str
    timestamp: _dt.datetime


_SENSITIVE_HEADERS = {"x-api-key", "x-signature"}


class _Headers(Dict[str, str]):
    """A header dict whose repr hides credentials (so tracebacks and debuggers cannot leak them)."""

    def __repr__(self) -> str:
        shown = {k: ("<redacted>" if k.lower() in _SENSITIVE_HEADERS else v) for k, v in self.items()}
        return f"Headers({shown!r})"

    __str__ = __repr__


@dataclasses.dataclass
class TransportRequest:
    """One HTTP request handed to a :class:`Transport`."""

    method: str
    url: str
    headers: Dict[str, str]
    body: Optional[bytes]
    #: Seconds this attempt may take in total (connect + send + receive).
    timeout: float
    #: Cancelled when the caller aborts; transports should stop work promptly.
    cancel: Any  # CancelToken (typed loosely to avoid an import cycle)

    def __repr__(self) -> str:
        return f"TransportRequest({self.method} {self.url})"


@dataclasses.dataclass
class TransportResponse:
    """The result of one HTTP exchange. Redirects must be returned as-is, never followed."""

    status: int
    headers: Mapping[str, str]
    body: bytes
    reason: str = ""

    def __post_init__(self) -> None:
        # Header names are case-insensitive; keep a lower-cased view.
        self.headers = {str(k).lower(): str(v) for k, v in dict(self.headers).items()}


@runtime_checkable
class Transport(Protocol):
    """Synchronous HTTP transport (for tests, proxies, instrumentation).

    ``send`` must honor ``request.timeout``, must **not follow redirects**, and should stop
    promptly when ``request.cancel`` is cancelled (``request.cancel.add_callback(...)``).
    Raise ``OSError`` (including ``TimeoutError``) for network failures.
    """

    def send(self, request: TransportRequest) -> TransportResponse: ...


@runtime_checkable
class AsyncTransport(Protocol):
    """Async variant of :class:`Transport`, accepted by :class:`~unsent.AsyncUnsent`."""

    async def send(self, request: TransportRequest) -> TransportResponse: ...

