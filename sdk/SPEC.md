# Unsent SDK specification

Every official Unsent SDK (TypeScript in `sdk/`, and the ports in `sdk-python/`, `sdk-go/`, `sdk-ruby/`, `sdk-rust/`)
implements this contract so that behavior is identical across languages. The TypeScript SDK in `sdk/src` is the
reference implementation; when this document and the server (`src/index.ts`, `src/auth.ts`) disagree, the server wins.

## 1. Configuration

| Option | Env var | Notes |
|---|---|---|
| `base_url` | `UNSENT_BASE_URL` | Required. Normalized: trimmed, query/fragment dropped, trailing `/` removed, path prefix kept. |
| `api_key` | `UNSENT_API_KEY` | Required. Trimmed. Must be printable ASCII (0x20-0x7e); otherwise a config error (never put it in a header unchecked). |
| `api_secret` | `UNSENT_API_SECRET` | Optional (needed unless server is `api-key-only`). Trimmed. |
| `default_from`, `default_provider_id` | | Used when a send omits them. |
| `timeout` | | Per attempt. Default 30 s. Must be > 0 and finite. |
| `max_retries` | | Default 3, integer 0-10. |
| custom HTTP transport | | For tests/proxies. |

- Empty-string env vars count as unset. Explicit options win over env.
- `base_url` must be `https://`; `http://` only for `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`. Reject URLs with
  embedded credentials, other schemes, or unparsable values. Errors are config errors raised at construction.
- **Never follow redirects.** A 3xx response is an error `unexpected_redirect` (it would forward the API key to another
  host). Not retried.
- Secrets must never appear in `repr`/`toString`/`inspect`/debug output, log lines, error messages, or exceptions' fields.

## 2. Wire protocol

Base: `{base_url}` + path. All bodies JSON, UTF-8.

### Send: `POST /api/send`

Headers: `X-API-Key: <api_key>`, `Content-Type: application/json`, `Accept: application/json`,
`User-Agent: unsent-sdk-<lang>/<version>`.

If `api_secret` is set, **always sign** (works in every server mode):

```
timestamp = floor((now_ms + clock_offset_ms) / 1000)            # decimal string
nonce     = 32 lowercase hex chars from a CSPRNG
body_hash = lowercase hex SHA-256 of the exact request body bytes (UTF-8)
signature = lowercase hex HMAC-SHA256(key = api_secret as UTF-8, msg = timestamp + "\n" + nonce + "\n" + body_hash)
headers  += X-Timestamp: <timestamp>, X-Nonce: <nonce>, X-Signature: sha256=<signature>
```

The signature covers the exact bytes sent: serialize once, hash that string, send that same string.
**Fresh timestamp + nonce on every attempt** (the server rejects reused nonces).
**Never send** `X-Provider-Id`, `X-Sender-Email` or `Idempotency-Key` headers: sender, provider and idempotency key go
in the (signed) JSON body only.

Body fields (omit absent optionals; never send null):

```json
{ "to": ["a@b.co"], "cc": [...], "bcc": [...], "subject": "...", "html": "...", "text": "...",
  "attachments": [{ "filename": "a.pdf", "content": "<base64>", "mimeType": "application/pdf" }],
  "from": { "email": "x@y.co", "name": "X" }, "provider_id": "...", "idempotency_key": "..." }
```

Responses: `202` new email, `200` idempotent replay (`idempotent_replay: true`, header `Idempotent-Replayed: true`):
`{ success, id, status, idempotency_key, idempotent_replay, message, targetProvider }`.

### Other calls (API key only, no signature)

- `GET /api/emails/{id}` → `{ email: {...} }` (includes attachment `content`)
- `GET /api/emails?limit&offset&status&q&from&to&sort` → `{ emails, total, limit, offset }`
- `GET /api/status` → `{ queued, sending, sent, failed }`
- `GET /api/health` (no credentials) → `{ status, runtime, d1, timestamp }`

Query params with empty/absent values are omitted. `from`/`to` are `YYYY-MM-DD` (UTC).
`status` ∈ queued|sending|sent|failed; `sort` ∈ updated_at_desc|updated_at_asc|created_at_desc|created_at_asc|attempts_desc.

### Email object mapping

Idiomatic casing for the language. `to/cc/bcc` arrays (`cc`/`bcc` null when absent); `html_body`→html body;
`text_body` is null when it equals the html body (the API echoes html when no text part was stored);
`created_at`/`updated_at` epoch-ms → native datetime; `failover_history` (JSON string or array) → list of
`{provider, type, error, timestamp}` (malformed → empty); attachment `size` = decoded base64 length; list responses give
attachment metadata `{filename, mimeType, size}`, detail responses also give `content`.

## 3. Send semantics

1. Validate everything client-side **before any network I/O**; raise validation errors (nothing is sent):
   - `to` required, non-empty after trimming; `cc`/`bcc` optional; each ≤ 100 addresses; each address a string containing `@`,
     no CR/LF/NUL. Accept a single string or a list.
   - `subject` required non-blank, ≤ 1000 chars, string.
   - at least one of `html`/`text` non-blank; both must be strings if given. **If only `text` is given, derive
     `html = <div style="white-space:pre-wrap">` + HTML-escaped text (& < > " ') + `</div>`** (the API requires html).
   - attachments: list, ≤ 20; each needs a non-blank filename (≤ 255, no CR/LF/NUL) and non-empty content. Content may be
     raw bytes (SDK base64-encodes) or a base64 string (whitespace stripped, must be valid padded base64, else a validation
     error that tells the user to pass bytes for non-base64 data). `content_type`/`mime_type` optional string.
   - `from`: string (`"Name <a@b.co>"` parsed to `{email, name}`, quotes around name stripped) or `{email, name?}`; no CR/LF/NUL.
   - `provider_id`: non-blank string ≤ 255.
   - Per-call overrides (`timeout`, `max_retries`) validated like the client options.
   - Total JSON body must be ≤ 3 MiB (`payload_too_large`), mirroring the server limit.
   - Wrong types (numbers, objects, null where a string is expected) are validation errors — never a crash
     (TypeError/NullPointer/panic).
2. Idempotency key: default = fresh random UUIDv4 per call, reused across that call's retries. Caller key: trimmed,
   `^[\x21-\x7e]{1,255}$`, else validation error `invalid_idempotency_key`. Caller may disable (key omitted) — then **no
   retries of any kind** for that call.
3. Result: `{ id, status, idempotency_key|null, idempotent_replay, target_provider, message }`.

## 4. Retries, timeouts, clock skew

- Retry only if the call is retry-safe (GET, or a keyed send) and attempts < `max_retries`:
  network errors/timeouts, and HTTP 408, 425, 429, and 5xx except 501 and 505 and except code `server_misconfigured`.
  Never retry 4xx otherwise, 3xx, or `aborted`.
- Backoff: `exp = min(8000, 500 * 2^attempt)` ms; delay = `exp/2 + random * exp/2`; use `max(backoff, Retry-After)`.
  `Retry-After` is seconds or HTTP-date, capped at 60 s; invalid values ignored.
- Per-attempt timeout → timeout error. Caller cancellation (context/signal/cancel token) aborts immediately including
  during backoff sleeps, with code `aborted`, no further attempts.
- Clock skew: on 401 with code `timestamp_skew` and an `api_secret`, once per call: learn the server clock from the
  response `Date` header, else from `GET /api/health` `timestamp` (midpoint of request, short timeout). If |offset| ≥ 30 s,
  store it as `clock_offset_ms` (used for all later signatures) and retry immediately without consuming a retry. If |offset| < 30 s
  but a nonzero offset was stored, reset it to 0 and retry. Otherwise fail with the original error. At most one correction per call.
- Do not read unbounded responses: reject bodies announced larger than 32 MiB.
- Non-JSON 2xx body → error `invalid_response` ("is base_url pointing at an Unsent deployment?").

## 5. Errors

All errors derive from one base `UnsentError` with `code` (stable string), `message`, optional `reason`, `hint`.
API errors add `status`, `body` (parsed JSON or text), `existing_email_id` (from `id` in 409 bodies), `retry_after`.
Subclass/kind by status: 401 authentication, 403 permission, 404 not found, 409 conflict, 429 rate limit, ≥500 server,
400/413 request; plus config, validation, connection (incl. `timeout`, `aborted`, `unexpected_redirect`→base error).

Error body: `{ error, code, reason? }`; `code` falls back to `internal_error` (5xx) or `http_<status>`. Message =
`error` + `: reason` (if not already contained) + ` (hint)`. Hints:

| code | hint |
|---|---|
| invalid_api_key, unauthorized | Check that apiKey matches the API_KEY secret of your Unsent deployment. |
| invalid_signature | Check that apiSecret matches the API_SECRET secret of your Unsent deployment (no extra whitespace). |
| missing_signature | The server requires signed requests. Pass apiSecret (UNSENT_API_SECRET) to the client. |
| timestamp_skew (with secret) | Your system clock differs from the server by more than 3 minutes. Sync it (NTP). |
| timestamp_skew / invalid_nonce (no secret) | The server requires signed requests. Pass apiSecret (UNSENT_API_SECRET) to the client. |
| unauthorized_sender | The "from" address or providerId is not an active provider. Configure it in the dashboard, or omit "from" to use the default provider. |
| forbidden | This endpoint needs an admin dashboard session; API keys cannot call it. |

Error messages, `repr`, and fields must never contain the API key or secret.

## 6. Resource methods

`send`, `get(id)` (id positive integer), `list(...)` (limit 1-200, offset ≥ 0, status/sort enums validated client-side,
`has_more = offset + len < total`), `iterate(...)` (pages oldest-first, default sort `created_at_asc`),
`wait(id, timeout=60s, interval=1s)` (poll; interval ×1.5 up to 5 s; final = `sent` OR (`failed` AND attempts ≥ 3);
timeout error if not final; cancellable), `status()`, `health()`.

## 7. Required tests (all in the language's standard test tooling)

1. **Unit** (mock transport, no network): everything in §1-§6 — config validation and normalization, signing verified
   by an *independent* HMAC implementation in the test, fresh nonce per attempt, idempotency key reuse across retries,
   each retry/no-retry status, Retry-After, clock skew (Date header + health fallback + stale offset), timeouts, abort,
   redirect refusal, error mapping + hints, attachment encoding, address parsing, text-only html derivation, response
   mapping, wait/iterate, secret non-disclosure (repr/str/errors).
2. **Fuzz / hostile input**: thousands of seeded-random junk values (wrong types, huge strings, CRLF, unicode, nested
   structures) into every public method: must only raise the SDK's own errors, never an internal crash. Hostile server
   responses (garbage JSON, wrong types, `__proto__`-style keys, giant `Retry-After`, huge/never-ending bodies, 3xx) must
   not crash or hang.
3. **Security**: no secret leakage anywhere; CR/LF/control-char/non-ASCII credentials rejected at construction; no header
   injection; no redirect following; http to remote host rejected; ReDoS-safe address/base64 parsing (pathological
   100k-char inputs finish in well under a second).
4. **End-to-end** against the real worker (see below): health/status; text-only, html+text, cc/bcc, unicode,
   binary attachments round-trip byte-exact; idempotent replay + 409 conflict (`existing_email_id`); 6 parallel sends
   with one key → exactly 1 email; 25 concurrent signed sends (nonce store); skewed local clock auto-corrected;
   wrong key / wrong secret / no secret errors+hints; unauthorized sender; 404; `iterate`; `wait` → `sent`; and the
   **lost-response test**: a tiny local proxy that forwards the first `/api/send` to the worker but kills the connection
   before replying — the SDK retries with the same key and exactly one email exists afterwards (`idempotent_replay`).
   Gated on `UNSENT_E2E_BASE_URL` so plain unit runs skip them.

## 8. Test server

```bash
eval "$(scripts/e2e-server.sh start <port> [full|signed|api-key-only])"   # exports UNSENT_E2E_* variables
scripts/e2e-server.sh stop <port>
scripts/e2e-server.sh mails <port>                                         # raw messages the SMTP sink received
```

Credentials are fixed test values (`UNSENT_E2E_API_KEY`, `UNSENT_E2E_API_SECRET`, `UNSENT_E2E_FROM`). Only
`noreply@e2e.test` is an authorized sender. The server has no `Date` response header locally.
