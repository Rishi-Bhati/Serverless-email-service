"""Address parsing and recipient validation (no regular expressions on user input: ReDoS-safe)."""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from ._util import as_str, has_line_break, short, type_name
from .errors import UnsentValidationError

MAX_RECIPIENTS = 100


def parse_address(value: Any, field: str) -> Dict[str, str]:
    """Split ``Name <a@b.com>`` into its parts; pass mappings and bare addresses through."""
    if isinstance(value, Mapping):
        email = as_str(value.get("email"))
        if email is None or not email.strip():
            raise UnsentValidationError(f'"{field}.email" must be a non-empty string')
        raw_name = value.get("name")
        if raw_name is not None:
            name = as_str(raw_name)
            if name is None:
                raise UnsentValidationError(f'"{field}.name" must be a string')
        else:
            name = None
        name = name.strip() if name else ""
        return {"email": email.strip(), "name": name} if name else {"email": email.strip()}

    text = as_str(value)
    if text is None or not text.strip():
        raise UnsentValidationError(f'"{field}" must be a non-empty string or {{email, name}}')
    named = _split_named(text)
    if named is not None:
        email, name = named
        return {"email": email, "name": name} if name else {"email": email}
    return {"email": text.strip()}


def _split_named(value: str) -> Optional["tuple[str, str]"]:
    """Parse ``["]Name["] <addr>``. Linear time; returns ``None`` if the value is not in that form."""
    s = value.strip()
    if not s.endswith(">") or s.count("<") != 1 or s.count(">") != 1:
        return None
    lt = s.index("<")
    addr = s[lt + 1 : -1].strip()
    if not addr or any(ch.isspace() for ch in addr):
        return None
    head = s[:lt].lstrip()
    if head.startswith('"'):
        head = head[1:]
    head = head.rstrip()
    if head.endswith('"'):
        head = head[:-1]
    if '"' in head:
        return None
    return addr, head.strip()


def normalize_recipients(value: Any, field: str, required: bool) -> Optional[List[str]]:
    """Validate a recipient list (a string or a list/tuple of strings) and return it as a list."""
    if value is None:
        if required:
            raise UnsentValidationError(f'"{field}" is required')
        return None
    if isinstance(value, (list, tuple)):
        items: List[Any] = list(value)
    elif isinstance(value, str):
        items = [value]
    else:
        raise UnsentValidationError(f'"{field}" must be a string or an array of strings (got {type_name(value)})')
    cleaned: List[str] = []
    for item in items:
        text = as_str(item)
        if text is None:
            raise UnsentValidationError(f'"{field}" must be a string or an array of strings')
        text = text.strip()
        if text:
            cleaned.append(text)
    if not cleaned:
        if required:
            raise UnsentValidationError(f'"{field}" must contain at least one address')
        return None
    if len(cleaned) > MAX_RECIPIENTS:
        raise UnsentValidationError(f'"{field}" has {len(cleaned)} addresses (maximum {MAX_RECIPIENTS})')
    for addr in cleaned:
        if has_line_break(addr):
            raise UnsentValidationError(f'"{field}" contains a line break or NUL character')
        if "@" not in addr:
            raise UnsentValidationError(f'"{field}" contains an invalid address: {short(addr)}')
    return cleaned
