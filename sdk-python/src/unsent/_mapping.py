"""Map the server's wire format to the SDK's dataclasses. Tolerant of malformed (hostile) responses."""

from __future__ import annotations

import datetime as _dt
import json
import math
from typing import Any, Dict, List, Optional, Union, cast

from ._attachments import base64_size
from ._util import is_int
from .errors import UnsentError
from .models import (
    AttachmentDetail,
    AttachmentInfo,
    Email,
    EmailDetail,
    FailoverAttempt,
)

STATUSES = frozenset({"queued", "sending", "sent", "failed"})
_EPOCH = _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc)


def invalid_response(what: str) -> UnsentError:
    return UnsentError(
        f"Unexpected response from the server: {what}. Is base_url pointing at your Unsent deployment?",
        code="invalid_response",
    )


def as_number(value: Any) -> Union[int, float, None]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def as_int(value: Any) -> Optional[int]:
    """JS ``Number(x)`` for ids and counters, but only for finite integral values."""
    n = as_number(value)
    if n is None:
        return None
    try:
        if isinstance(n, float):
            if not math.isfinite(n) or not n.is_integer():
                return None
            return int(n)
        return int(n)
    except (OverflowError, ValueError):
        return None


def to_date(ms: Any) -> _dt.datetime:
    n = as_number(ms)
    if n is None or not math.isfinite(n):
        return _EPOCH
    try:
        return _EPOCH + _dt.timedelta(milliseconds=n)
    except (OverflowError, ValueError):
        return _EPOCH


def _str_list(value: Any) -> Optional[List[str]]:
    if not isinstance(value, list):
        return None
    return [x for x in value if isinstance(x, str)]


def _opt_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _parse_failover(raw: Any) -> List[FailoverAttempt]:
    items: Any = raw
    if isinstance(raw, str):
        try:
            items = json.loads(raw)
        except (ValueError, RecursionError):
            return []
    if not isinstance(items, list):
        return []
    out: List[FailoverAttempt] = []
    for f in items:
        d: Dict[str, Any] = f if isinstance(f, dict) else {}

        def s(key: str) -> str:
            v = d.get(key)
            return v if isinstance(v, str) else ("" if v is None else str(v)[:500])

        out.append(
            FailoverAttempt(provider=s("provider"), type=s("type"), error=s("error"), timestamp=to_date(d.get("timestamp")))
        )
    return out


def _base(w: Dict[str, Any]) -> Dict[str, Any]:
    html = w.get("html_body") if isinstance(w.get("html_body"), str) else (w.get("body") if isinstance(w.get("body"), str) else "")
    tb = w.get("text_body")
    # The API falls back to the HTML body when no plain-text alternative was stored.
    text = tb if isinstance(tb, str) and tb and tb != html else None
    status = w.get("status")
    email_id = as_int(w.get("id"))
    if email_id is None:
        raise invalid_response("email without a numeric id")
    subject = w.get("subject")
    return dict(
        id=email_id,
        status=status if isinstance(status, str) and status in STATUSES else "queued",
        to=_str_list(w.get("to")) or [],
        cc=_str_list(w.get("cc")),
        bcc=_str_list(w.get("bcc")),
        subject=subject if isinstance(subject, str) else "",
        html_body=html,
        text_body=text,
        from_email=_opt_str(w.get("from_email")),
        from_name=_opt_str(w.get("from_name")),
        provider_id=_opt_str(w.get("provider_id")),
        provider_used=_opt_str(w.get("provider_used")),
        failover_history=_parse_failover(w.get("failover_history")),
        idempotency_key=_opt_str(w.get("idempotency_key")),
        attempts=as_int(w.get("attempts")) or 0,
        error=_opt_str(w.get("error")),
        created_at=to_date(w.get("created_at")),
        updated_at=to_date(w.get("updated_at")),
    )


def _attachment_list(w: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = w.get("attachments")
    return [a if isinstance(a, dict) else {} for a in raw] if isinstance(raw, list) else []


def map_email(w: Any) -> Email:
    if not isinstance(w, dict):
        raise invalid_response("email is not an object")
    attachments: List[AttachmentInfo] = []
    for a in _attachment_list(w):
        size = a.get("size")
        content = a.get("content")
        if is_int(size) or (isinstance(size, float) and math.isfinite(size)):
            n = int(cast(float, size))
        elif isinstance(content, str):
            n = base64_size(content)
        else:
            n = 0
        fn = a.get("filename")
        attachments.append(AttachmentInfo(filename=fn if isinstance(fn, str) else "", mime_type=_opt_str(a.get("mimeType")), size=n))
    return Email(**_base(w), attachments=attachments)


def map_email_detail(w: Any) -> EmailDetail:
    if not isinstance(w, dict):
        raise invalid_response("email is not an object")
    attachments: List[AttachmentDetail] = []
    for a in _attachment_list(w):
        content = a.get("content")
        content = content if isinstance(content, str) else ""
        fn = a.get("filename")
        attachments.append(
            AttachmentDetail(
                filename=fn if isinstance(fn, str) else "",
                mime_type=_opt_str(a.get("mimeType")),
                size=base64_size(content),
                content=content,
            )
        )
    return EmailDetail(**_base(w), attachments=attachments)
