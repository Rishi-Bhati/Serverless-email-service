"""Official Python client for your self-hosted Unsent email service.

>>> from unsent import Unsent
>>> unsent = Unsent()  # reads UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET  # doctest: +SKIP
>>> unsent.send(to="customer@example.com", subject="Welcome!", html="<h1>Hello</h1>")  # doctest: +SKIP
"""

from ._attachments import attachment_from_file
from ._resources import MAX_DELIVERY_ATTEMPTS
from ._version import __version__
from .async_client import AsyncEmails, AsyncUnsent
from .cancel import CancelToken
from .client import Emails, Unsent
from .errors import (
    UnsentAPIError,
    UnsentAuthenticationError,
    UnsentConfigError,
    UnsentConflictError,
    UnsentConnectionError,
    UnsentError,
    UnsentNotFoundError,
    UnsentPermissionError,
    UnsentRateLimitError,
    UnsentRequestError,
    UnsentServerError,
    UnsentTimeoutError,
    UnsentValidationError,
)
from .models import (
    Address,
    AsyncTransport,
    Attachment,
    AttachmentDetail,
    AttachmentInfo,
    Email,
    EmailDetail,
    FailoverAttempt,
    Health,
    ListEmailsResult,
    QueueStatus,
    SendEmailResult,
    Transport,
    TransportRequest,
    TransportResponse,
)

__all__ = [
    "__version__",
    "Unsent",
    "AsyncUnsent",
    "Emails",
    "AsyncEmails",
    "CancelToken",
    "attachment_from_file",
    "MAX_DELIVERY_ATTEMPTS",
    "Address",
    "Attachment",
    "AttachmentDetail",
    "AttachmentInfo",
    "Email",
    "EmailDetail",
    "FailoverAttempt",
    "Health",
    "ListEmailsResult",
    "QueueStatus",
    "SendEmailResult",
    "Transport",
    "AsyncTransport",
    "TransportRequest",
    "TransportResponse",
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
]
