"""Small helpers shared by the validation code. No secrets pass through here."""

from __future__ import annotations

import re
from typing import Any, Optional

_CTRL_RE = re.compile(r"[\r\n\0]")
_CLEAN_RE = re.compile(r"[\x00-\x1f\x7f]")


def as_str(value: Any) -> Optional[str]:
    """Return ``value`` as an exact ``str`` if it is a string (or subclass), else ``None``.

    Subclasses are copied to a real ``str`` first so overridden methods cannot misbehave.
    """
    if type(value) is str:
        return value
    if isinstance(value, str):
        return str.__str__(value)
    return None


def is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def has_line_break(text: str) -> bool:
    """CR, LF or NUL."""
    return _CTRL_RE.search(text) is not None


def utf16_len(text: str) -> int:
    """Length as JavaScript counts it (UTF-16 code units), which is what the server limits use."""
    return len(text) + sum(1 for ch in text if ord(ch) > 0xFFFF)


def short(text: str, limit: int = 60) -> str:
    """Quoted, truncated, escaped text for error messages."""
    body = text if len(text) <= limit else text[:limit] + "..."
    return repr(body)


def clean_text(text: str, limit: int = 200) -> str:
    """Strip control characters and truncate untrusted text (server headers) before logging it."""
    return _CLEAN_RE.sub(" ", text)[:limit]


def type_name(value: Any) -> str:
    return type(value).__name__
