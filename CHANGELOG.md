# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-03

### Upgrade notes

**Required:** Apply the new database migration before deploying the new Worker code.

1. `npm run deploy` now applies pending migrations automatically, because it runs `npm run db:migrate:prod` before `wrangler deploy`. If you deploy with `wrangler deploy` directly, or through another pipeline, run `npm run db:migrate:prod` before deploying the new code. Otherwise every `POST /api/send` and `GET /api/emails` request fails with a 500 because the new columns do not exist yet.
2. Dashboard login now requires `ADMIN_PASSWORD` (or `DASHBOARD_PASSWORD`) to be set. There is no fallback to `API_SECRET` anymore.
3. Clients that branch on HTTP status must be updated. Internal failures on `POST /api/send` are now 500 (previously 400), and server misconfiguration is now 500 (previously 401).

### Security

- Fixed: any API client holding `API_SECRET` could forge an administrator dashboard session token. Session tokens signed with the raw `API_SECRET`, or with the legacy key `unsent:session:v1:<API_SECRET>`, were accepted. Because every API client is given `API_SECRET` to sign requests, a client could mint an admin token and read credentials via `GET /api/keys`, manage providers, and delete emails. Now only tokens signed with the key derived from `API_SECRET` plus the admin username and password are accepted. Severity: high. Existing sessions created through the legacy path stop working; normal dashboard logins are unaffected.
- Login no longer falls back to an `API_SECRET`-derived signing key when no admin password is configured. If no admin password is set, Bearer tokens are ignored and requests fall through to API-key authentication.
- Internal error details (database messages) are no longer returned in `POST /api/send` error responses. They are logged in the Worker instead.
- Server misconfiguration responses on `POST /api/send` (500 `server_misconfigured`) no longer include a `reason` that names the missing secret or setting, because these responses are returned before authentication. The detail is written to the Worker log instead.
- On signature-verified requests (`SECURITY_MODE` `signed` or `full`), the idempotency key must be sent in the signed request body, because the `Idempotency-Key` header is not covered by the HMAC signature.

### Added

- Idempotent sends on `POST /api/send`. Pass `idempotency_key` in the JSON body (works in all modes), or the `Idempotency-Key` header (api-key-only mode and dashboard sessions only). Keys are 1-255 printable ASCII characters without spaces. If both the header and the body are sent, they must match.
  - First request: 202 with the new email `id`.
  - Repeat with the same key and the same message: 200 with the original `id`, `"idempotent_replay": true`, and response header `Idempotent-Replayed: true`. No second email is queued.
  - Same key with a different message: 409 with code `idempotency_key_conflict`.
  - Safe under concurrent requests, enforced by a unique database index.
- Migration `0005_idempotency.sql`: adds `idempotency_key` and `idempotency_hash` columns to `emails` and a unique index on `idempotency_key`. Existing rows are unaffected.
- `idempotency_key` is returned by `GET /api/emails` and `GET /api/emails/:id`.
- `POST /api/send` success responses now also include `status`, `idempotency_key`, and `idempotent_replay`.
- Every error response now has the shape `{ "error": "...", "code": "...", "reason": "..." }`, where `reason` is optional. `code` is stable and intended for programmatic handling. Codes by HTTP status:

| Status | Codes |
|--------|-------|
| 400 | `validation_error`, `invalid_json`, `invalid_idempotency_key`, `unauthorized_sender`, `bad_request` |
| 401 | `invalid_api_key`, `invalid_header`, `timestamp_skew`, `invalid_nonce`, `missing_signature`, `invalid_signature`, `nonce_reused`, `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `idempotency_key_conflict` |
| 413 | `payload_too_large` |
| 500 | `internal_error`, `server_misconfigured` |

- README sections "Idempotent Sends" and "Error Responses".

### Changed

- `npm run deploy` now runs `npm run db:migrate:prod` before `wrangler deploy`, so pending migrations are applied automatically. Running `wrangler deploy` directly still skips migrations.
- `POST /api/send`: internal failures return 500 `internal_error` instead of 400. Invalid recipient input still returns 400 `validation_error`.
- `POST /api/send`: server misconfiguration (missing `API_KEY` or `API_SECRET`, invalid `SECURITY_MODE` or `NONCE_TTL_SECONDS`) returns 500 `server_misconfigured` instead of 401.
- `POST /api/send`: an empty or whitespace-only idempotency key is rejected with 400 `invalid_idempotency_key`. Previously an empty key was ignored, which disabled deduplication without warning. This applies to an empty `idempotency_key` body field and to an `Idempotency-Key` header that is present but empty.
- The human-readable `error` field and its text are unchanged, so existing clients and the dashboard keep working.
- CORS now allows the `Idempotency-Key` request header and exposes the `Idempotent-Replayed` response header.

### Fixed

- `POST /api/send`: malformed field types that previously caused a 500 now return 400 `validation_error`, so clients do not retry requests that can never succeed. This applies when `subject`, `from.email`, `from.name`, `from_email`, `from_name`, a recipient entry or its `email`, `provider_id` or `provider`, or an attachment's `mimeType` is an object or array rather than a string. Numbers are still accepted where they were before (for example, a numeric subject). A `provider_id` longer than 255 characters is rejected with 400.

## [1.0.0] - 2026-09-23

Initial release.

### Added

- Multi-provider delivery via SMTP, Resend, SendGrid, Mailgun, and Postmark, with priority failover and daily sending limits.
- Provider routing policies (`priority`, `direct_only`, `last_resort`) and multi-provider targeting. Explicit fallbacks are guarded.
- D1-backed send queue with atomic locking and cron-based self-healing.
- Attachments and plain-text bodies in sends.
- Admin dashboard with username/password login, a Detailed Logs tab with search, pagination, and expandable entries, an email inspection drawer with previews, a Report Issue button, and view routing persisted in the URL hash and across page refreshes.
- API documentation hub with multi-language quickstarts, email template examples, and a simplified API docs page.

### Security

- HMAC-SHA256 request signing with timestamp verification and D1-backed nonce replay protection.
- AES-256-GCM encryption of stored provider credentials.
- Constant-time comparisons for secrets.
- SSRF protection on outbound provider calls.
- CRLF sanitization of header values to prevent header injection.
- Dashboard output escaping fixes, and unified session-token authentication for the dashboard.
- Hardening pass across the queue and API that resolved concurrency and logic bugs.

[1.1.0]: https://github.com/Rishi-Bhati/Serverless-email-service/compare/e53e5ba...v1.1.0
[1.0.0]: https://github.com/Rishi-Bhati/Serverless-email-service/tree/e53e5ba
