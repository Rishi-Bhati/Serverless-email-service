"""Signing and randomness helpers (stdlib only)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hmac_sha256_hex(secret: str, message: str) -> str:
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def random_nonce() -> str:
    """32 lowercase hex chars of CSPRNG output (satisfies the server's ``[a-zA-Z0-9_-]{8,128}``)."""
    return secrets.token_hex(16)


def random_uuid() -> str:
    """RFC 4122 v4 UUID; valid as an idempotency key."""
    return str(uuid.UUID(bytes=secrets.token_bytes(16), version=4))


def sign_request(*, secret: str, timestamp: str, nonce: str, body: bytes) -> str:
    """``HMAC(secret, timestamp + "\\n" + nonce + "\\n" + SHA256(body))`` as lowercase hex."""
    return hmac_sha256_hex(secret, f"{timestamp}\n{nonce}\n{sha256_hex(body)}")
