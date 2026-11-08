# Changelog

## 1.0.0

Initial release.

- `unsent.New(Options)` / `unsent.NewFromEnv()` client with `Send`, `Emails.Send/Get/List/Iterate/Each/Wait` (and `Emails.All` on Go 1.23+), `Status` and `Health`. Every call takes a `context.Context`.
- Automatic HMAC signing and nonces for `signed`/`full` servers; works unchanged with `api-key-only`.
- Idempotency keys generated per send, with safe automatic retries (network errors, timeouts, 408, 425, 429, 5xx), exponential backoff with jitter and `Retry-After`.
- Automatic correction of a skewed local clock (response `Date` header, or `GET /api/health`).
- Attachments from `[]byte`, `io.Reader`, base64 strings or a file path (`AttachmentFromFile`).
- Typed errors (`*APIError`, `*ValidationError`, `*ConnectionError`, `*ConfigError`, `*BaseError`) with stable codes and fix hints, usable with `errors.As` / `errors.Is`, plus `IsConflict`, `IsNotFound`, ... helpers.
- Redirects are never followed; credentials never appear in errors, `fmt` output or JSON.
- Standard library only. Go 1.21+. Safe for concurrent use.
