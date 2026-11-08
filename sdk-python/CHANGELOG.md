# Changelog

## 1.0.0

Initial release.

- `Unsent` (sync) and `AsyncUnsent` (asyncio) clients with `send()`, `emails.send/get/list/iterate/wait`, `status()` and `health()`.
- Automatic HMAC signing and nonces for `signed`/`full` servers; works unchanged with `api-key-only`.
- Idempotency keys generated per send, with safe automatic retries (network errors, timeouts, 408, 425, 429, 5xx), exponential backoff with jitter and `Retry-After`.
- Automatic correction of a skewed local clock (response `Date` header, or `GET /api/health`).
- Attachments from `bytes`/`bytearray`/`memoryview`, binary file objects, base64 strings or `attachment_from_file(path)`.
- Cooperative cancellation with `CancelToken`; cancelling closes the in-flight socket.
- Typed error hierarchy with stable codes and fix hints, never leaking credentials.
- Django `EMAIL_BACKEND` (`unsent.django.UnsentEmailBackend`) and FastAPI helpers (`unsent.fastapi`).
- Zero runtime dependencies; Python 3.9+; fully type-annotated (`py.typed`).
