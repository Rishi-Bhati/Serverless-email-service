# Changelog

## 1.0.0

Initial release.

- `Unsent::Client` (thread-safe, frozen) with `send_email`/`deliver`, `emails.send_email/get/list/each/iterate/wait`, `status` and `health`, plus `Unsent::Client.from_env`.
- Automatic HMAC signing and nonces for `signed`/`full` servers; works unchanged with `api-key-only`.
- Idempotency keys generated per send, with safe automatic retries (network errors, timeouts, 408, 425, 429, 5xx), exponential backoff with jitter and `Retry-After`.
- Automatic correction of a skewed local clock (response `Date` header, or `GET /api/health`).
- Attachments from binary strings, base64 strings, IO-like objects, or `Unsent::Attachment.from_file`.
- Cooperative cancellation with `Unsent::CancelToken`.
- Typed error hierarchy under `Unsent::Error` with stable codes and fix hints; credentials never appear in `inspect`, `pp`, JSON or error messages.
- ActionMailer delivery method for Rails (`config.action_mailer.delivery_method = :unsent`), registered automatically when ActionMailer is present.
- RBS signatures in `sig/`. No runtime dependencies; Ruby 3.1+.
