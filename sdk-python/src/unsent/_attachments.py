"""Attachment validation and encoding."""

from __future__ import annotations

import base64
import mimetypes
import os
import re
from typing import Any, Dict, Mapping, Optional, Union

from ._util import as_str, has_line_break, type_name, utf16_len
from .errors import UnsentValidationError
from .models import Attachment

MAX_ATTACHMENTS = 20
_BASE64_RE = re.compile(r"[A-Za-z0-9+/]*={0,2}")  # linear: no nested quantifiers


def _read_filelike(raw: Any, at: str) -> bytes:
    try:
        data = raw.read()
    except Exception as exc:
        raise UnsentValidationError(f"{at}.content could not be read: {type_name(exc)}") from exc
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise UnsentValidationError(f"{at}.content file objects must be opened in binary mode")
    return bytes(data)


def _field(att: Any, *names: str) -> Any:
    if isinstance(att, Mapping):
        for n in names:
            v = att.get(n)
            if v is not None:
                return v
        return None
    for n in names:
        v = getattr(att, n, None)
        if v is not None:
            return v
    return None


def to_wire_attachment(att: Any, index: int) -> Dict[str, str]:
    """Validate one attachment and convert it to the API's wire format (base64 ``content``)."""
    at = f"attachments[{index}]"
    if not (isinstance(att, Mapping) or isinstance(att, Attachment)):
        raise UnsentValidationError(f"{at} must be an Attachment or a dict")

    raw = _field(att, "content")
    raw_name = _field(att, "filename")
    if raw_name is None and hasattr(raw, "read"):
        n = getattr(raw, "name", None)
        raw_name = os.path.basename(n) if isinstance(n, str) else None
    if raw_name is None:
        raise UnsentValidationError(f"{at}.filename is required")
    name = as_str(raw_name)
    if name is None:
        raise UnsentValidationError(f"{at}.filename must be a string")
    filename = "".join(ch for ch in name if ch not in "\r\n\0").strip()
    if not filename:
        raise UnsentValidationError(f"{at}.filename is required")
    if utf16_len(filename) > 255:
        raise UnsentValidationError(f"{at}.filename exceeds 255 characters")

    text = as_str(raw)
    if text is not None:
        content = "".join(text.split())
        if not content or len(content) % 4 != 0 or not _BASE64_RE.fullmatch(content):
            raise UnsentValidationError(
                f"{at}.content is a string, so it must be valid base64. To attach text or binary data, "
                "pass bytes (e.g. text.encode('utf-8')) or a binary file object."
            )
    elif isinstance(raw, (bytes, bytearray, memoryview)):
        content = base64.b64encode(bytes(raw)).decode("ascii")
    elif hasattr(raw, "read"):
        content = base64.b64encode(_read_filelike(raw, at)).decode("ascii")
    elif isinstance(raw, os.PathLike):
        raise UnsentValidationError(f"{at}.content is a path; use unsent.attachment_from_file(path) to read a file")
    else:
        raise UnsentValidationError(
            f"{at}.content must be a base64 string, bytes, bytearray, memoryview or a binary file object"
        )
    if not content:
        raise UnsentValidationError(f"{at}.content is empty")

    mime_raw = _field(att, "content_type", "contentType", "mime_type", "mimeType")
    mime: Optional[str] = None
    if mime_raw is not None:
        mime = as_str(mime_raw)
        if mime is None:
            raise UnsentValidationError(f"{at}.content_type must be a string")
        mime = mime.strip()
        if has_line_break(mime):
            raise UnsentValidationError(f"{at}.content_type contains a line break or NUL character")
    out = {"filename": filename, "content": content}
    if mime:
        out["mimeType"] = mime
    return out


def attachment_from_file(
    path: Union[str, bytes, "os.PathLike[str]"],
    *,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
) -> Attachment:
    """Read a file from disk as an attachment (MIME type guessed from the extension).

    Raises ``UnsentValidationError`` for a ``path`` of the wrong type and the usual ``OSError`` if the
    file cannot be read.
    """
    try:
        fspath = os.fsdecode(os.fspath(path))
    except Exception:
        raise UnsentValidationError("path must be a str, bytes or os.PathLike") from None
    try:
        with open(fspath, "rb") as fh:
            data = fh.read()
    except ValueError:  # embedded NUL, lone surrogates: not a usable file name
        raise UnsentValidationError("path is not a valid file name") from None
    name_given = as_str(filename) if filename is not None else None
    type_given = as_str(content_type) if content_type is not None else None
    if (filename is not None and name_given is None) or (content_type is not None and type_given is None):
        raise UnsentValidationError("filename and content_type must be strings")
    return Attachment(
        content=data,
        filename=name_given or os.path.basename(fspath),
        content_type=type_given or mimetypes.guess_type(fspath)[0],
    )


def base64_size(content: str) -> int:
    """Decoded size in bytes of a base64 string."""
    padding = len(content) - len(content.rstrip("="))
    return max(0, (len(content) * 3) // 4 - padding)


