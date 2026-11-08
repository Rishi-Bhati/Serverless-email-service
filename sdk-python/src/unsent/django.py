"""Django email backend.

Settings (all optional if the matching ``UNSENT_*`` environment variable is set)::

    EMAIL_BACKEND = "unsent.django.UnsentEmailBackend"
    UNSENT_BASE_URL = "https://unsent.example.com"
    UNSENT_API_KEY = "..."
    UNSENT_API_SECRET = "..."
    # optional
    UNSENT_TIMEOUT = 30            # seconds per attempt
    UNSENT_MAX_RETRIES = 3
    UNSENT_DEFAULT_PROVIDER_ID = None
    UNSENT_OMIT_FROM = False       # True: never send a "from"; the service's default provider decides

Then ``send_mail()``, ``EmailMessage`` and ``EmailMultiAlternatives`` work unchanged.

Requires Django (``pip install "unsent-sdk[django]"``); the core SDK does not import this module.
"""

from __future__ import annotations

import logging
from email.utils import parseaddr
from typing import Any, Dict, Optional, Sequence

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.message import EmailMessage

from .client import Unsent
from .errors import UnsentConfigError, UnsentError
from .models import SendEmailResult

__all__ = ["UnsentEmailBackend", "message_to_send_kwargs"]

logger = logging.getLogger("unsent.django")

IDEMPOTENCY_HEADER = "X-Unsent-Idempotency-Key"
PROVIDER_HEADER = "X-Unsent-Provider-Id"


def _bare(address: Any) -> str:
    """``"Name <a@b.co>"`` to ``"a@b.co"``: the service takes bare addresses for recipients."""
    text = str(address).strip()
    parsed = parseaddr(text)[1]
    return parsed or text


def _attachment(att: Any) -> Dict[str, Any]:
    if isinstance(att, (tuple, list)):
        filename, content, mimetype = att[0], att[1], (att[2] if len(att) > 2 else None)
        if isinstance(content, str):
            content = content.encode("utf-8")
        return {"filename": str(filename) if filename else "attachment", "content": bytes(content), "content_type": mimetype or None}
    # email.mime.base.MIMEBase / email.message.MIMEPart
    payload = att.get_payload(decode=True)
    if payload is None:  # e.g. message/rfc822 containers
        payload = att.as_bytes()
    return {
        "filename": att.get_filename() or "attachment",
        "content": bytes(payload),
        "content_type": att.get_content_type(),
    }


def message_to_send_kwargs(message: EmailMessage, *, omit_from: bool = False) -> Dict[str, Any]:
    """Translate a Django ``EmailMessage`` into keyword arguments for :meth:`unsent.Unsent.send`."""
    html: Optional[str] = None
    text: Optional[str] = None
    body = str(message.body) if message.body else ""
    if getattr(message, "content_subtype", "plain") == "html":
        html = body or None
    else:
        text = body or None
    for content, mimetype in getattr(message, "alternatives", []) or []:
        if mimetype == "text/html" and html is None:
            html = str(content)
        elif mimetype != "text/html":
            logger.warning("Dropping %r alternative: the Unsent API only supports text and HTML bodies", mimetype)
    if getattr(message, "reply_to", None):
        logger.warning("reply_to is not supported by the Unsent API and was ignored")

    kwargs: Dict[str, Any] = {
        "to": [_bare(a) for a in message.to],
        "cc": [_bare(a) for a in message.cc] or None,
        "bcc": [_bare(a) for a in message.bcc] or None,
        "subject": str(message.subject),
        "html": html,
        "text": text,
    }
    if message.attachments:
        kwargs["attachments"] = [_attachment(a) for a in message.attachments]
    if message.from_email and not omit_from:
        kwargs["from_"] = str(message.from_email)
    headers = getattr(message, "extra_headers", None) or {}
    for name, value in headers.items():
        lowered = str(name).lower()
        if lowered == IDEMPOTENCY_HEADER.lower():
            kwargs["idempotency_key"] = str(value)
        elif lowered == PROVIDER_HEADER.lower():
            kwargs["provider_id"] = str(value)
    return kwargs


_OPTION_NAMES = ("base_url", "api_key", "api_secret", "default_provider_id", "timeout", "max_retries", "omit_from")


class UnsentEmailBackend(BaseEmailBackend):
    """Send Django email through an Unsent deployment.

    Configure with the ``UNSENT_*`` settings above, or per mailer on Django 6.1+::

        MAILERS = {"default": {"BACKEND": "unsent.django.UnsentEmailBackend",
                               "OPTIONS": {"base_url": "...", "api_key": "...", "api_secret": "..."}}}

    ``fail_silently=True`` swallows every ``UnsentError`` (configuration errors included), as Django's
    own backends do. Otherwise errors propagate: configuration problems as ``ImproperlyConfigured``,
    everything else as the SDK's ``UnsentError`` subclasses. After a successful send, the
    :class:`~unsent.SendEmailResult` is available as ``message.unsent_result``.

    Pass ``client=`` (e.g. ``get_connection(client=...)``) to use a pre-built :class:`unsent.Unsent`.
    """

    def __init__(
        self,
        fail_silently: bool = False,
        client: Optional[Unsent] = None,
        *,
        alias: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        options = {name: kwargs.pop(name) for name in _OPTION_NAMES if name in kwargs}
        # Django >= 6.1 validates unknown options against `alias`; older versions ignore extras.
        super().__init__(**({"alias": alias} if alias is not None else {}), **kwargs)
        self.fail_silently = bool(fail_silently)  # own attribute: Django 6.1 deprecates the inherited one
        self._client = client
        self._options = options

    def _setting(self, name: str) -> Any:
        if self._options.get(name) is not None:
            return self._options[name]
        return getattr(settings, "UNSENT_" + name.upper(), None)

    def _get_client(self) -> Unsent:
        if self._client is None:
            try:
                self._client = Unsent(
                    base_url=self._setting("base_url") or None,
                    api_key=self._setting("api_key") or None,
                    api_secret=self._setting("api_secret") or None,
                    default_provider_id=self._setting("default_provider_id") or None,
                    timeout=self._setting("timeout"),
                    max_retries=self._setting("max_retries"),
                )
            except UnsentConfigError as exc:
                raise ImproperlyConfigured(f"Unsent email backend: {exc}") from exc
        return self._client

    def send_messages(self, email_messages: Sequence[EmailMessage]) -> int:
        if not email_messages:
            return 0
        sent = 0
        omit_from = bool(self._setting("omit_from"))
        for message in email_messages:
            try:
                if self._send_one(message, omit_from):
                    sent += 1
            except (UnsentError, ImproperlyConfigured):
                if not self.fail_silently:
                    raise
        return sent

    def _send_one(self, message: EmailMessage, omit_from: bool) -> bool:
        if not message.recipients():
            return False
        client = self._get_client()
        result: SendEmailResult = client.send(**message_to_send_kwargs(message, omit_from=omit_from))
        message.unsent_result = result  # type: ignore[attr-defined]
        return True
