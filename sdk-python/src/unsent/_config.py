"""Client option resolution (explicit options win over the environment)."""

from __future__ import annotations

import dataclasses
import inspect
import os
from typing import Any, Dict, Mapping, Optional

from ._address import parse_address
from ._core import ClientState, check_max_retries, check_timeout, normalize_base_url
from ._util import has_line_break, utf16_len
from .errors import UnsentConfigError, UnsentValidationError

DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3


@dataclasses.dataclass
class Resolved:
    state: ClientState
    default_from: Optional[Dict[str, str]]
    default_provider_id: Optional[str]
    transport: Any


def _clean(value: Any, name: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise UnsentConfigError(f"{name} must be a string")
    text = str.__str__(value).strip()
    return text or None


def _env_value(env: Mapping[str, Any], key: str) -> Optional[str]:
    value = env.get(key)
    if isinstance(value, str):
        return value.strip() or None
    return None


def _check_printable(value: str, name: str) -> None:
    if not all(0x20 <= ord(c) <= 0x7E for c in value):
        raise UnsentConfigError(
            f"{name} contains a character that is not printable ASCII (control characters, line breaks and "
            "non-ASCII characters are not allowed). Check for a stray newline or a copy-paste artifact."
        )


def check_provider_id(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or utf16_len(value) > 255:
        raise UnsentValidationError('"provider_id" must be a non-empty string up to 255 characters')
    return str.__str__(value).strip()


def check_from(value: Any, field: str = "from") -> Dict[str, str]:
    parsed = parse_address(value, field)
    if has_line_break(parsed["email"] + parsed.get("name", "")):
        raise UnsentValidationError(f'"{field}" contains a line break or NUL character')
    return parsed


def _resolve(
    *,
    base_url: Any = None,
    api_key: Any = None,
    api_secret: Any = None,
    default_from: Any = None,
    default_provider_id: Any = None,
    timeout: Any = None,
    max_retries: Any = None,
    transport: Any = None,
    env: Optional[Mapping[str, Any]] = None,
    allow_async_transport: bool = False,
) -> Resolved:
    source: Mapping[str, Any] = os.environ if env is None else env
    base = _clean(base_url, "base_url") or _env_value(source, "UNSENT_BASE_URL")
    key = _clean(api_key, "api_key") or _env_value(source, "UNSENT_API_KEY")
    secret = _clean(api_secret, "api_secret") or _env_value(source, "UNSENT_API_SECRET")

    if not base:
        raise UnsentConfigError("Missing base_url. Pass base_url= or set UNSENT_BASE_URL (e.g. https://unsent.example.com).")
    if not key:
        raise UnsentConfigError("Missing api_key. Pass api_key= or set UNSENT_API_KEY (the API_KEY of your deployment).")
    _check_printable(key, "api_key")
    if secret:
        _check_printable(secret, "api_secret")

    t = DEFAULT_TIMEOUT if timeout is None else check_timeout(timeout, "timeout")
    retries = DEFAULT_MAX_RETRIES if max_retries is None else check_max_retries(max_retries, "max_retries")

    if transport is not None:
        send = getattr(transport, "send", None)
        if not callable(send):
            raise UnsentConfigError("transport must be an object with a send(request) method")
        if inspect.iscoroutinefunction(send) and not allow_async_transport:
            raise UnsentConfigError("This transport is async; use AsyncUnsent, or pass a synchronous transport.")

    from_parsed: Optional[Dict[str, str]] = None
    if default_from is not None:
        try:
            from_parsed = check_from(default_from, "default_from")
        except UnsentValidationError as exc:
            raise UnsentConfigError(str(exc)) from None
    provider: Optional[str] = None
    if default_provider_id is not None:
        try:
            provider = check_provider_id(default_provider_id)
        except UnsentValidationError:
            raise UnsentConfigError("default_provider_id must be a non-empty string up to 255 characters") from None

    state = ClientState(
        base_url=normalize_base_url(base), api_key=key, api_secret=secret or None, timeout=t, max_retries=retries
    )
    return Resolved(state=state, default_from=from_parsed, default_provider_id=provider, transport=transport)


def resolve(**kwargs: Any) -> Resolved:
    """Resolve client options. Raises only :class:`UnsentConfigError`."""
    try:
        return _resolve(**kwargs)
    except UnsentConfigError:
        raise
    except Exception as exc:
        raise UnsentConfigError(f"Invalid client options ({type(exc).__name__}); check the option types") from exc
