"""Argument validation and response mapping shared by the sync and async resources."""

from __future__ import annotations

import dataclasses
import datetime as _dt
import functools
import json
import math
import re
from typing import Any, Callable, Dict, List, Optional, TypeVar

from . import _core
from ._address import normalize_recipients
from ._attachments import MAX_ATTACHMENTS, to_wire_attachment
from ._config import check_from, check_provider_id
from ._crypto import random_uuid
from ._mapping import STATUSES, as_int, as_number, invalid_response, map_email, map_email_detail, to_date
from ._util import as_str, is_int, type_name, utf16_len
from .cancel import CancelToken
from .errors import UnsentError, UnsentValidationError
from .models import Email, EmailDetail, Health, ListEmailsResult, QueueStatus, SendEmailResult

#: After this many delivery attempts the service stops retrying a failed email.
MAX_DELIVERY_ATTEMPTS = 3
MAX_SUBJECT = 1000
MAX_SAFE_INT = 2**53 - 1
LIST_STATUSES = ("queued", "sending", "sent", "failed")
LIST_SORTS = ("updated_at_desc", "updated_at_asc", "created_at_desc", "created_at_asc", "attempts_desc")
_IDEMPOTENCY_KEY_RE = re.compile(r"[\x21-\x7e]{1,255}")
_DAY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


_F = TypeVar("_F", bound=Callable[..., Any])


def guarded(fn: _F) -> _F:
    """Turn any unexpected exception from validating exotic argument objects into a ``UnsentValidationError``."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except UnsentError:
            raise
        except Exception as exc:
            raise UnsentValidationError(
                f"{fn.__name__.replace('_', ' ')}: an argument could not be processed ({type(exc).__name__}); check the argument types"
            ) from exc

    return wrapper  # type: ignore[return-value]


def escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")
    )


def is_final(email: Any) -> bool:
    return bool(email.status == "sent" or (email.status == "failed" and email.attempts >= MAX_DELIVERY_ATTEMPTS))


@guarded
def check_cancel(cancel: Any) -> Optional[CancelToken]:
    if cancel is not None and not isinstance(cancel, CancelToken):
        raise UnsentValidationError(f'"cancel" must be a CancelToken (got {type_name(cancel)})')
    return cancel


@guarded
def check_request_options(timeout: Any, max_retries: Any, cancel: Any) -> None:
    if timeout is not None:
        _core.check_timeout(timeout, '"timeout"', UnsentValidationError)
    if max_retries is not None:
        _core.check_max_retries(max_retries, '"max_retries"', UnsentValidationError)
    check_cancel(cancel)


@dataclasses.dataclass
class PreparedSend:
    body: bytes
    idempotency_key: Optional[str]

    @property
    def retry_safe(self) -> bool:
        # Without a key a retry could duplicate the email, so only keyed sends are retried.
        return self.idempotency_key is not None


def prepare_send(
    defaults: Any,
    *,
    to: Any,
    subject: Any,
    html: Any,
    text: Any,
    cc: Any,
    bcc: Any,
    from_: Any,
    attachments: Any,
    provider_id: Any,
    idempotency_key: Any,
    timeout: Any,
    max_retries: Any,
    cancel: Any,
) -> PreparedSend:
    """Validate everything client-side and serialize the request. Raises only ``UnsentError``."""
    try:
        return _prepare_send(
            defaults, to, subject, html, text, cc, bcc, from_, attachments, provider_id, idempotency_key,
            timeout, max_retries, cancel,
        )  # fmt: skip
    except UnsentError:
        raise
    except Exception as exc:  # last line of defense against exotic argument objects
        raise UnsentValidationError(
            f"send() could not process one of its arguments ({type(exc).__name__}); check the argument types"
        ) from exc


def _prepare_send(
    defaults: Any, to: Any, subject: Any, html: Any, text: Any, cc: Any, bcc: Any, from_: Any,
    attachments: Any, provider_id: Any, idempotency_key: Any, timeout: Any, max_retries: Any, cancel: Any,
) -> PreparedSend:  # fmt: skip
    check_request_options(timeout, max_retries, cancel)
    to_list = normalize_recipients(to, "to", True)
    cc_list = normalize_recipients(cc, "cc", False)
    bcc_list = normalize_recipients(bcc, "bcc", False)

    subj = as_str(subject)
    if subj is None or not subj.strip():
        raise UnsentValidationError('"subject" is required')
    if utf16_len(subj) > MAX_SUBJECT:
        raise UnsentValidationError(f'"subject" is {utf16_len(subj)} characters (maximum {MAX_SUBJECT})')

    html_s = as_str(html)
    text_s = as_str(text)
    has_html = html_s is not None and html_s.strip() != ""
    has_text = text_s is not None and text_s.strip() != ""
    if html is not None and html_s is None:
        raise UnsentValidationError('"html" must be a string')
    if text is not None and text_s is None:
        raise UnsentValidationError('"text" must be a string')
    if not has_html and not has_text:
        raise UnsentValidationError('Provide "html", "text", or both')
    # The API requires an HTML body; derive one from the text so text-only sends just work.
    html_body = html_s if has_html and html_s is not None else f'<div style="white-space:pre-wrap">{escape_html(text_s or "")}</div>'

    wire_attachments: Optional[List[Dict[str, str]]] = None
    if attachments is not None:
        if not isinstance(attachments, (list, tuple)):
            raise UnsentValidationError('"attachments" must be an array')
        if len(attachments) > MAX_ATTACHMENTS:
            raise UnsentValidationError(f"Too many attachments ({len(attachments)}, maximum {MAX_ATTACHMENTS})")
        if attachments:
            wire_attachments = [to_wire_attachment(a, i) for i, a in enumerate(attachments)]

    from_in = from_ if from_ is not None else defaults.from_
    sender = check_from(from_in) if from_in is not None else None

    provider_in = provider_id if provider_id is not None else defaults.provider_id
    provider = check_provider_id(provider_in) if provider_in is not None else None

    key: Optional[str]
    if idempotency_key is False:
        key = None
    elif idempotency_key is None:
        key = random_uuid()
    else:
        k = as_str(idempotency_key)
        if k is None or not _IDEMPOTENCY_KEY_RE.fullmatch(k.strip()):
            raise UnsentValidationError(
                '"idempotency_key" must be 1-255 printable ASCII characters without spaces '
                '(e.g. a UUID or "order-123:receipt")',
                "invalid_idempotency_key",
            )
        key = k.strip()

    # Provider and sender go in the signed body, never in headers, so the signature covers them.
    payload: Dict[str, Any] = {"to": to_list}
    if cc_list:
        payload["cc"] = cc_list
    if bcc_list:
        payload["bcc"] = bcc_list
    payload["subject"] = subj
    payload["html"] = html_body
    if has_text:
        payload["text"] = text_s
    if wire_attachments:
        payload["attachments"] = wire_attachments
    if sender:
        payload["from"] = sender
    if provider:
        payload["provider_id"] = provider
    if key:
        payload["idempotency_key"] = key

    try:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except UnicodeEncodeError:
        raise UnsentValidationError(
            "A text field contains characters that cannot be encoded as UTF-8 (for example a lone surrogate)"
        ) from None
    if len(body) > _core.MAX_BODY_BYTES:
        raise UnsentValidationError(
            f"The request body is {len(body) / 1048576:.1f} MiB; the server accepts at most 3 MiB "
            "(about 1.4 MB of raw attachment data).",
            "payload_too_large",
        )
    return PreparedSend(body=body, idempotency_key=key)


def map_send_result(res: _core.CallResult, key: Optional[str]) -> SendEmailResult:
    d = res.data
    if not isinstance(d, dict):
        raise invalid_response("send response is not an object")
    email_id = as_int(d.get("id"))
    if email_id is None or email_id < 1:
        raise invalid_response("send response has no email id")
    status = d.get("status")
    echoed = d.get("idempotency_key")
    target = d.get("targetProvider")
    message = d.get("message")
    return SendEmailResult(
        id=email_id,
        status=status if isinstance(status, str) and status in STATUSES else "queued",
        idempotency_key=echoed if isinstance(echoed, str) else key,
        idempotent_replay=d.get("idempotent_replay") is True or res.headers.get("idempotent-replayed") == "true",
        target_provider=target if isinstance(target, str) else "",
        message=message if isinstance(message, str) else "",
    )


@guarded
def check_email_id(value: Any) -> int:
    if not is_int(value) or value < 1 or value > MAX_SAFE_INT:
        raise UnsentValidationError('"id" must be a positive integer')
    return int(value)


def map_get(res: _core.CallResult) -> EmailDetail:
    d = res.data
    if not isinstance(d, dict) or "email" not in d:
        raise invalid_response("missing email")
    return map_email_detail(d["email"])


def day_param(value: Any, field: str) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(_dt.timezone.utc)
        return str(value.date().isoformat())
    if isinstance(value, _dt.date):
        return value.isoformat()
    s = as_str(value)
    if s is not None and _DAY_RE.match(s):
        try:
            _dt.date.fromisoformat(s[:10])
        except ValueError:
            pass
        else:
            return s[:10]
    raise UnsentValidationError(f'"{field}" must be a date or YYYY-MM-DD')


@guarded
def prepare_list_query(
    *, limit: Any, offset: Any, status: Any, search: Any, from_: Any, to: Any, sort: Any
) -> Dict[str, Any]:
    if limit is not None and (not is_int(limit) or limit < 1 or limit > 200):
        raise UnsentValidationError('"limit" must be an integer from 1 to 200')
    if offset is not None and (not is_int(offset) or offset < 0 or offset > MAX_SAFE_INT):
        raise UnsentValidationError('"offset" must be a non-negative integer')
    st = as_str(status) if status is not None else None
    if status is not None and (st is None or st not in LIST_STATUSES):
        raise UnsentValidationError(f'"status" must be one of {", ".join(LIST_STATUSES)}')
    so = as_str(sort) if sort is not None else None
    if sort is not None and (so is None or so not in LIST_SORTS):
        raise UnsentValidationError(f'"sort" must be one of {", ".join(LIST_SORTS)}')
    q = as_str(search) if search is not None else None
    if search is not None and q is None:
        raise UnsentValidationError('"search" must be a string')
    return {
        "limit": limit,
        "offset": offset,
        "status": st,
        "q": q,
        "from": day_param(from_, "from"),
        "to": day_param(to, "to"),
        "sort": so,
    }


def map_list(res: _core.CallResult) -> ListEmailsResult:
    d = res.data
    if not isinstance(d, dict):
        raise invalid_response("list response is not an object")
    raw = d.get("emails", [])
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise invalid_response("emails is not a list")
    emails: List[Email] = [map_email(e) for e in raw]
    total = as_int(d.get("total")) or 0
    off = as_int(d.get("offset")) or 0
    return ListEmailsResult(
        emails=emails,
        total=total,
        limit=as_int(d.get("limit")) or len(emails),
        offset=off,
        has_more=off + len(emails) < total,
    )


def map_status(res: _core.CallResult) -> QueueStatus:
    d = res.data
    if not isinstance(d, dict):
        raise invalid_response("status response is not an object")
    return QueueStatus(
        queued=as_int(d.get("queued")) or 0,
        sending=as_int(d.get("sending")) or 0,
        sent=as_int(d.get("sent")) or 0,
        failed=as_int(d.get("failed")) or 0,
    )


def map_health(res: _core.CallResult) -> Health:
    d = res.data
    if not isinstance(d, dict):
        raise invalid_response("health response is not an object")

    def s(key: str) -> str:
        v = d.get(key)
        return v if isinstance(v, str) else ""

    ts = as_number(d.get("timestamp"))
    when = to_date(ts) if ts and math.isfinite(ts) else _dt.datetime.now(_dt.timezone.utc)
    return Health(status=s("status"), runtime=s("runtime"), d1=s("d1"), timestamp=when)


@guarded
def check_wait_options(timeout: Any, interval: Any, cancel: Any) -> "tuple[float, float]":
    t = _core.check_timeout(timeout, '"timeout"', UnsentValidationError)
    i = _core.check_timeout(interval, '"interval"', UnsentValidationError)
    check_cancel(cancel)
    return t, max(0.1, i)


def next_interval(interval: float) -> float:
    return min(5.0, round(interval * 1.5, 3))
