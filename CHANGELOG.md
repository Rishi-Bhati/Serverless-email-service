# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-11-03

This release changes only the API documentation built into the dashboard. It has no API or server behavior changes, no migration, and no new settings.

### Changed

- The dashboard API reference documents `idempotency_key` (body field) and the `Idempotency-Key` header (api-key-only mode only), the 200 idempotent replay and 409 conflict responses, the new 202 response fields, the `{ error, code, reason }` error shape, and a full error-code table. It also has a Retries section. It says to retry network errors and 5xx responses with the same key and a fresh timestamp, nonce and signature, and not to retry other 4xx responses.
- Code examples (cURL, TypeScript, Python, Go, and the Next.js route handler and server action) send an `idempotency_key`. The TypeScript, Python, and Next.js examples include the error `code` in the error they raise or log. The cURL and Go examples print the response body instead.
- The reusable TypeScript `sendEmail()` helper retries network errors and 5xx responses up to 3 times with backoff. It keeps one idempotency key across attempts (generated if not supplied), re-signs each attempt, and accepts `attachments`.

### Fixed

- `DELETE /api/emails/:id` was documented as needing only an API key. It requires an admin dashboard session, and an API key alone gets `403 forbidden`.
- Examples no longer send `reply_to` or `metadata`, which the API does not support and silently ignores. This applies to the TypeScript helper, the Next.js route handler, and the Next.js provider routing example.
- The Next.js route handler example no longer returns internal error messages to the browser. It logs them on the server and returns a generic message.

## [1.2.0] - 2026-11-03

### Upgrade notes

**Recommended:** Set a separate encryption key for provider credentials. This release has no database migration.

1. Generate a key with `openssl rand -hex 32`. It must be at least 32 characters.
2. Add `ENCRYPTION_KEY=...` to `.env`.
3. Run `npx wrangler secret put ENCRYPTION_KEY` or `npm run secrets:deploy -- --prod`.
4. Run `npm run deploy`.

Within a minute, the cron trigger re-encrypts existing provider credentials to the new format. No downtime is required.

**Caution:** once provider credentials have been re-encrypted, they can only be decrypted with this `ENCRYPTION_KEY`. Do not remove or change it afterwards. If it is lost or changed, provider credentials must be re-entered in the dashboard. Keep a backup of it.

Other changes that may affect clients:

- `POST /api/providers/test` returns 502 `provider_error` instead of 400 when the provider rejects the test. Clients that branch on that status must be updated.
- Login with a malformed JSON body returns "Invalid JSON body" (400 `invalid_json`). Previously the parser message was returned.
- Idempotency keys now expire after 24 hours by default. Review any client that relies on a key never expiring.

### Security

- Provider credentials were encrypted with a key derived from `API_SECRET`. Every API client holds `API_SECRET` for request signing, so a client holding `API_SECRET` and a copy of the database could decrypt stored SMTP passwords and provider API keys. Rotating `API_SECRET` also made stored credentials unreadable. Set the new `ENCRYPTION_KEY` secret to use a separate key (see Added).
- Internal error details are no longer returned in any API response. All endpoints (login, keys, status, emails list, providers list, create, update, delete, set-default, and test) return `Internal server error` with code `internal_error` for unexpected failures. The detail is written to the Worker log. In 1.1.0 this applied only to `POST /api/send`.

### Added

- Optional `ENCRYPTION_KEY` secret for provider credential encryption. It is server-only, is never given to API clients, and must be at least 32 characters.
  - When set, new and updated credentials are written in envelope version v2, keyed from `ENCRYPTION_KEY`.
  - Existing records stay readable. Records in envelope version v1 (keyed from `API_SECRET`) and older unencrypted records are re-encrypted to v2 by the cron trigger, which runs every minute. A row is overwritten only if it has not changed since it was read.
  - When `ENCRYPTION_KEY` is not set, behavior is unchanged (v1, keyed from `API_SECRET`) and the Worker logs a warning. Setting it is strongly recommended.
- New error code `provider_error` with status 502, returned by `POST /api/providers/test` when the provider rejects the test.

### Changed

- Idempotency keys expire. They are remembered for 24 hours by default, counted from when the original email was created. The period is configurable with `IDEMPOTENCY_TTL_HOURS` (a number from 1 to 720). After expiry, a request with the same key creates a new email, and the key moves to that email. The old email keeps its record but no longer holds the key. Concurrent requests with an expired key still produce exactly one new email. Previously, keys were held until the email was deleted.
- An invalid `IDEMPOTENCY_TTL_HOURS` makes sends that carry an idempotency key fail with 500 `server_misconfigured`. Sends without a key are not affected.
- If `ENCRYPTION_KEY` is set but shorter than 32 characters, provider endpoints return 500 `server_misconfigured`, with the detail written only to the Worker log. Sends routed through providers fail with that configuration error. Sends are still accepted and queued.
- Malformed JSON bodies return 400 `invalid_json` with the message "Invalid JSON body". Login previously returned "Authentication failed: <parser message>".
- Invalid numeric fields on provider create and update (`priority`, `daily_limit`) return 400 `validation_error` with a readable message.
- Unexpected database errors on provider create, update, and set-default return 500 instead of 400.
- `POST /api/providers/test`: when the provider rejects the test (connection or authentication failure), the response is 502 `provider_error` with the message `Provider test failed: <provider's error>`. Previously this was 400. The endpoint requires an admin session, and the provider's error is shown because it is the purpose of the test.
- A last-resort handler wraps every route, so an uncaught exception returns the standard JSON error instead of the platform error page.

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

[1.2.1]: https://github.com/Rishi-Bhati/Serverless-email-service/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Rishi-Bhati/Serverless-email-service/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Rishi-Bhati/Serverless-email-service/compare/e53e5ba...v1.1.0
[1.0.0]: https://github.com/Rishi-Bhati/Serverless-email-service/tree/e53e5ba
