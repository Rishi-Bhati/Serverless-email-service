# Changelog

## 1.0.0

Initial release.

- `Unsent::builder()` / `Unsent::from_env()` / `Unsent::from_vars(..)` client with `send`, `Emails::send/get/get_with/list/iterate/wait/wait_with`, `status` and `health`, all `async fn` on tokio.
- Automatic HMAC signing and nonces for `signed`/`full` servers; works unchanged with `api-key-only`.
- Idempotency keys generated per send, with safe automatic retries (network errors, timeouts, 408, 425, 429, 5xx), exponential backoff with jitter and `Retry-After` (capped at 60 s).
- Automatic correction of a skewed local clock (response `Date` header, or `GET /api/health`), remembered for later signatures.
- Attachments from bytes, base64 strings or a file path (`Attachment::from_bytes` / `from_base64` / `from_path`).
- One `Error` enum with stable `code()`s and fix hints, plus `status()`, `reason()`, `hint()`, `body()`, `existing_email_id()`, `retry_after()`, `is_retryable()`, `is_timeout()` and `is_aborted()`.
- Cooperative cancellation through `CancellationToken`; dropping a future also cancels.
- Credentials are never printed: the `Secret` type, `Debug` on the client, builder and errors, and redaction of server-provided text.
- Redirects are never followed; oversized responses are refused before they are read.
- Async on tokio with `reqwest`/rustls, no `unsafe` code (`#![forbid(unsafe_code)]`), `#[non_exhaustive]` error enum. Rust 1.89+. Safe to share and clone between tasks.
