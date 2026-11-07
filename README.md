# Serverless Email Queue Service

[![Report Issues Here](https://img.shields.io/badge/Report-Issues%20Here-orange?style=for-the-badge)](https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/)

A serverless email queuing and delivery service built on Cloudflare Workers and Cloudflare D1 (SQLite).

## What Is It

This service is a self-hosted, serverless email API and background queue worker. It accepts email requests via an authenticated HTTP API, stages them in a transactional SQLite database (Cloudflare D1), and asynchronously delivers them through configured email providers (SMTP, Resend, SendGrid, Mailgun, Postmark).

It includes an embedded, authenticated single-page administration dashboard for inspecting delivery logs, tracking queue health, and managing provider configurations.

## Why Is It

- Zero Infrastructure Cost: Runs within Cloudflare's free tier limits (100,000 Worker requests/day, 100,000 D1 writes/day, 5,000,000 D1 reads/day).
- Overload and Rate-Limit Protection: Serializes email delivery and pools SMTP connections to prevent rate-limit throttling and socket exhaustion on provider accounts.
- Automatic Multi-Provider Failover: Routes emails based on configured priority order and automatically fails over to backup providers if a primary provider fails or hits its daily sending limit.
- Resilient Background Processing: Utilizes atomic database locks (`UPDATE ... RETURNING`) and self-healing cron fallbacks to ensure emails are never lost, duplicated, or permanently stuck in transit.

## How to Install

### Prerequisites

- Node.js 18 or later
- Cloudflare account
- Cloudflare Wrangler CLI (`npm install -g wrangler` or via `npx wrangler`)

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/Rishi-Bhati/Serverless-email-service.git
cd Serverless-email-service
npm install
```

### Step 2: Authenticate with Cloudflare

```bash
npx wrangler login
```

### Step 3: Provision the D1 Database

```bash
npx wrangler d1 create reportary-email-db
```

Copy the generated `database_id` and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "reportary-email-db"
database_id = "your-database-id-here"
```

### Step 4: Apply Database Migrations

Apply database schemas to both local and production environments:

```bash
# Local development
npm run db:migrate:local

# Production
npm run db:migrate:prod
```

### Step 5: Configure Environment Secrets

Create a `.env` file in the root directory:

```env
API_KEY=your_secure_api_key
API_SECRET=your_secure_hmac_secret
SECURITY_MODE=full
NONCE_TTL_SECONDS=300

# Server-only key for provider credentials at rest (openssl rand -hex 32). Never share it with API clients.
ENCRYPTION_KEY=generate_with_openssl_rand_hex_32

# Dashboard login requires these
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_dashboard_password

# Optional: hours that idempotency keys are remembered (default 24, range 1-720)
# IDEMPOTENCY_TTL_HOURS=24

# Optional legacy/fallback SMTP credentials
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_STARTTLS=true
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
SMTP_FROM_NAME=Email Service
SMTP_THROTTLE_DELAY_MS=1000
```

Deploy secrets to Cloudflare:

```bash
npm run secrets:deploy -- --prod
```

### Step 6: Deploy to Cloudflare Workers

```bash
npm run deploy
```

`npm run deploy` applies any pending D1 migrations to the production database before deploying, so the schema is always updated before the new code goes live.

Once deployed, your live service URL will be displayed in the terminal:
`https://reportary-email-service.<your-subdomain>.workers.dev`

## Critical Security Measures

1. Application-Level AES-256-GCM Envelope Encryption
Third-party credentials (SMTP passwords, Resend/SendGrid API keys, Postmark tokens) stored in Cloudflare D1 are encrypted using AES-256-GCM with a key derived from `ENCRYPTION_KEY`, a server-only secret that is separate from the `API_SECRET` used by API clients. Records written before `ENCRYPTION_KEY` was set are re-encrypted automatically by the cron trigger. If `ENCRYPTION_KEY` is not set, the key is derived from `API_SECRET` instead and the Worker logs a warning. Each record uses an independent 96-bit initialization vector (`IV`). Database backups and raw database dumps contain only ciphertext, never plaintext secrets. Decryption occurs solely in Worker memory during email dispatch.

2. HMAC-SHA256 Request Signing and Anti-Replay Protection
In `signed` and `full` security modes, API requests require HMAC-SHA256 signatures over a canonical string composed of the Unix timestamp, unique nonce, routing headers, and SHA-256 body hash. Timestamps are strictly verified within a +/- 3-minute window, and nonces are recorded in D1 to prevent replay and capture attacks.

3. Constant-Time Cryptographic Verification
All API key checks and signature comparisons utilize constant-time equality checks (`timingSafeEqual`) to prevent timing side-channel attacks.

4. Server-Side Request Forgery (SSRF) Prevention
All outbound network calls validate destination hosts and IP ranges against loopback, RFC 1918 private networks, broadcast addresses, and cloud provider metadata services (such as 169.254.169.254).

5. Header and Body Injection Prevention
Recipient, subject, and sender fields are sanitized against carriage return/newline (`CRLF`) characters to prevent email header injection. Secrets returned to the administration dashboard are masked (`••••••••`) before transmission.

## Idempotent Sends

`POST /api/send` accepts an optional idempotency key, so a request retried after a timeout or network error never sends the same email twice.

- Send it as the `idempotency_key` body field. In `signed` and `full` mode the body field is required, because it is covered by the HMAC signature and the header is not. In `api-key-only` mode and dashboard sessions the `Idempotency-Key` header also works. If both are present they must match.
- Keys are 1-255 printable ASCII characters without spaces (a UUID or `order-123:receipt` both work).
- An empty or whitespace-only key (an empty `idempotency_key` field, or an `Idempotency-Key` header that is present but empty) is rejected with `400` and code `invalid_idempotency_key`. It is not ignored.
- The first request returns `202` with the new email `id`. A repeat with the same key and the same message returns `200` with the original `id`, `"idempotent_replay": true`, and an `Idempotent-Replayed: true` header.
- Reusing a key with a different message returns `409` with code `idempotency_key_conflict`.
- Each retry still needs a fresh `X-Nonce` and `X-Timestamp` in `signed`/`full` mode; only the idempotency key stays the same.
- Keys are remembered for 24 hours by default, counted from when the original email was created. Set `IDEMPOTENCY_TTL_HOURS` (1 to 720) to change this. After a key expires, sending with it creates a new email and the key moves to that email. An invalid `IDEMPOTENCY_TTL_HOURS` makes sends that carry a key fail with `500` and code `server_misconfigured`.

## Error Responses

Every error response has the same JSON shape:

```json
{ "error": "Unauthorized", "code": "invalid_signature", "reason": "Invalid signature (request headers or body may have been tampered with)" }
```

`error` is a readable message, `reason` adds detail when available, and `code` is stable, so branch on `code`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_error`, `invalid_json`, `invalid_idempotency_key`, `unauthorized_sender`, `bad_request` | The request is malformed or the sender/provider is not configured |
| 401 | `invalid_api_key`, `invalid_header`, `timestamp_skew`, `invalid_nonce`, `missing_signature`, `invalid_signature`, `nonce_reused`, `unauthorized` | Authentication failed |
| 403 | `forbidden` | Requires an admin dashboard session |
| 404 | `not_found` | Unknown route or email |
| 409 | `idempotency_key_conflict` | Idempotency key reused with different content |
| 413 | `payload_too_large` | Body or attachments exceed the size limits |
| 500 | `internal_error`, `server_misconfigured` | Server-side failure. Details are written to the Worker log only and are not returned in the response. Safe to retry with the same idempotency key |
| 502 | `provider_error` | The provider rejected a provider test from the dashboard (`POST /api/providers/test`). The provider's error message is returned |

## JavaScript / TypeScript SDK

The [`sdk/`](sdk/README.md) folder contains `unsent-sdk`, an official client with no dependencies for Node, Bun, Deno, Cloudflare Workers and Next.js. It handles request signing, nonces, idempotency keys, retries and attachments for you:

```ts
import { Unsent } from 'unsent-sdk';

const unsent = new Unsent(); // reads UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET
await unsent.send({ to: 'user@example.com', subject: 'Welcome', html: '<p>Hello!</p>' });
```

See the [SDK README](sdk/README.md) for the full guide.

## Report Issues

If you run into any issues or have feedback, please report them here:
[Report Issues & Feedback](https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/)
