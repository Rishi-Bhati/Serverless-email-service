# unsent-sdk

Official TypeScript / JavaScript SDK for your self-hosted [Unsent](../README.md) email service.

- **Three lines to send.** No HMAC code, nonces, timestamps or base64 to write yourself.
- **Safe retries.** Every send carries an idempotency key, so network errors and 5xx responses are retried automatically without ever sending the same email twice.
- **Zero dependencies.** Uses `fetch` and Web Crypto. Runs on Node 20+, Bun, Deno, Cloudflare Workers, Vercel Edge and Next.js.
- **Fully typed**, ESM and CommonJS.

```ts
import { Unsent } from 'unsent-sdk';

const unsent = new Unsent(); // reads UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET

await unsent.send({
  to: 'customer@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello</h1><p>Your account is ready.</p>',
});
```

## Install

```bash
npm install unsent-sdk     # or: pnpm add unsent-sdk / yarn add unsent-sdk / bun add unsent-sdk
```

## Set up credentials

You need three values from your Unsent deployment. Sign in to the dashboard as an administrator and open the **API Docs** tab, which fills in your real keys, or use the secrets you deployed:

| Environment variable | Value |
|---|---|
| `UNSENT_BASE_URL` | Your deployment URL, e.g. `https://unsent.example.com` |
| `UNSENT_API_KEY` | The `API_KEY` secret |
| `UNSENT_API_SECRET` | The `API_SECRET` secret |

```bash
# .env (server side only)
UNSENT_BASE_URL=https://unsent.example.com
UNSENT_API_KEY=...
UNSENT_API_SECRET=...
```

Or pass them explicitly: `new Unsent({ baseUrl, apiKey, apiSecret })`.

`apiSecret` is used to sign requests. It is required unless your server runs with `SECURITY_MODE=api-key-only`, and it is safe to pass in every mode: the SDK works with `api-key-only`, `signed` and `full` servers without any configuration.

> **Keep these on the server.** Anyone holding the API secret can send email as you. The SDK refuses to run in a browser unless you set `dangerouslyAllowBrowser: true`.

## Sending email

```ts
const result = await unsent.emails.send({
  from: 'Acme Support <support@acme.com>', // optional; must be a sender configured in your dashboard
  to: ['a@example.com', 'b@example.com'],
  cc: 'manager@example.com',
  bcc: ['audit@example.com'],
  subject: 'Your order has shipped',
  html: '<p>It is on its way.</p>',
  text: 'It is on its way.',               // optional plain-text version
  providerId: 'resend_marketing',          // optional: force a specific provider
  idempotencyKey: 'order-8492:shipped',    // optional, see below
});

result.id;               // 1234
result.status;           // 'queued'
result.idempotentReplay; // false
```

`unsent.send(...)` is a shortcut for `unsent.emails.send(...)`.

| Option | Type | Notes |
|---|---|---|
| `to` | `string \| string[]` | Required. Up to 100 addresses per field. |
| `cc`, `bcc` | `string \| string[]` | Optional. |
| `subject` | `string` | Required, up to 1000 characters. |
| `html` / `text` | `string` | Provide at least one. A text-only send gets an HTML body derived from the text automatically (the API requires HTML). |
| `from` | `string \| { email, name? }` | `"Name <a@b.com>"` is parsed for you. Omit to use your default provider. Falls back to the client's `defaultFrom`. |
| `providerId` | `string` | Route through one provider. Falls back to `defaultProviderId`. |
| `attachments` | `Attachment[]` | Up to 20. See below. |
| `idempotencyKey` | `string \| false` | See below. |
| `signal`, `timeoutMs`, `maxRetries` | | Per-call overrides. |

`send()` resolves as soon as Unsent has **accepted** the email (HTTP 202). Delivery happens in the background, with automatic failover across your providers.

### Waiting for delivery

```ts
const { id } = await unsent.send({ ... });
const email = await unsent.emails.wait(id);          // polls until final, 60 s timeout by default

if (email.status === 'sent') console.log('delivered via', email.providerUsed);
else console.error('failed:', email.error, email.failoverHistory);
```

`wait()` returns once the email is `sent`, or `failed` after the service has used up its delivery attempts. A permanent failure is a normal return value, not an exception. If the email is still in flight at the deadline it throws `UnsentTimeoutError`.

### Attachments

```ts
await unsent.send({
  to: 'customer@example.com',
  subject: 'Invoice',
  html: '<p>Attached.</p>',
  attachments: [
    { filename: 'report.csv', content: Buffer.from(csv), contentType: 'text/csv' },
    { filename: 'logo.png', content: uint8Array },
    { filename: 'photo.jpg', content: arrayBuffer },
    { content: fileFromFormData },            // File/Blob: name and type are taken from it
    { filename: 'pre.pdf', content: base64String }, // a string is treated as base64
  ],
});
```

On Node, read files straight from disk:

```ts
import { attachmentFromFile } from 'unsent-sdk/node';

attachments: [await attachmentFromFile('./invoice.pdf')]
```

The service stores the body and attachments together in one database row, so keep the total under about **1.4 MB of raw attachment data**. Larger emails are rejected with a `413 payload_too_large`.

### Idempotency and retries

Network blips and 5xx responses are retried up to `maxRetries` times (default 3) with exponential backoff, honoring `Retry-After`. Retries are safe because every send carries an idempotency key:

- By default the SDK generates a UUID per `send()` call and reuses it across that call's retries. A request that actually succeeded but whose response was lost is recognised on retry (`result.idempotentReplay === true`).
- Pass your **own** key (e.g. `order-8492:shipped`) to also deduplicate across calls, processes and your own job retries. The same key with the same message returns the original email (kept for 24 hours by default); the same key with a *different* message throws `UnsentConflictError`.
- Pass `idempotencyKey: false` to opt out. The SDK then never retries that send.

Keys are 1 to 255 printable ASCII characters without spaces.

## Inspecting emails

```ts
const email = await unsent.emails.get(1234);          // includes attachment content (base64)

const page = await unsent.emails.list({
  status: 'failed',
  search: 'invoice',
  from: '2026-01-01',      // Date or YYYY-MM-DD (UTC)
  limit: 50,
});
page.emails; page.total; page.hasMore;

for await (const email of unsent.emails.iterate({ status: 'failed' })) { /* every match, page by page */ }

await unsent.status();   // { queued, sending, sent, failed }
await unsent.health();   // public liveness probe (does not verify credentials)
```

Dates come back as `Date` objects and fields are camelCase (`htmlBody`, `providerUsed`, `createdAt`, ...).

Provider management (adding SMTP/Resend/SendGrid credentials) and deleting emails need an admin dashboard session and are intentionally not exposed through API keys.

## Error handling

Every failure is an `UnsentError` with a stable `code`, so branch on `error.code`, not on the message:

```ts
import { UnsentError, UnsentConflictError, UnsentAuthenticationError } from 'unsent-sdk';

try {
  await unsent.send({ ... });
} catch (err) {
  if (err instanceof UnsentAuthenticationError) { /* wrong key/secret: err.code, err.hint */ }
  else if (err instanceof UnsentConflictError)  { /* key reused with a different message: err.existingEmailId */ }
  else if (err instanceof UnsentError)          { console.error(err.code, err.status, err.message); }
  else throw err;
}
```

| Class | When | Typical `code` |
|---|---|---|
| `UnsentConfigError` | Bad client options (nothing was sent) | `invalid_config`, `browser_not_allowed` |
| `UnsentValidationError` | Bad arguments caught before sending | `validation_error`, `invalid_idempotency_key` |
| `UnsentAuthenticationError` (401) | Wrong key or secret, clock skew | `invalid_api_key`, `invalid_signature`, `missing_signature`, `timestamp_skew` |
| `UnsentRequestError` (400, 413) | The server rejected the request | `validation_error`, `unauthorized_sender`, `payload_too_large` |
| `UnsentConflictError` (409) | Idempotency key reused with different content | `idempotency_key_conflict` |
| `UnsentNotFoundError` (404) | Unknown email id | `not_found` |
| `UnsentPermissionError` (403) | Endpoint needs an admin session | `forbidden` |
| `UnsentRateLimitError` (429) | Rate limited upstream | `rate_limited` |
| `UnsentServerError` (5xx) | Server failure (already retried) | `internal_error`, `server_misconfigured` |
| `UnsentTimeoutError` | A request or `wait()` timed out | `timeout` |
| `UnsentConnectionError` | No HTTP response, or the call was aborted | `connection_error`, `aborted` |

`UnsentAPIError` subclasses also carry `status`, `reason`, `body` and, where the SDK knows one, a `hint` that is appended to the message (for example "Check that apiSecret matches the API_SECRET secret of your deployment").

## Recipes

**Next.js (App Router)** · [examples/nextjs-route.ts](examples/nextjs-route.ts)

```ts
// app/api/contact/route.ts
import { Unsent } from 'unsent-sdk';
const unsent = new Unsent();

export async function POST(req: Request) {
  const { email, message } = await req.json();
  const { id } = await unsent.send({ to: 'support@acme.com', subject: `Contact: ${email}`, text: message });
  return Response.json({ id }, { status: 202 });
}
```

**Express / Fastify / any Node server**

```ts
const unsent = new Unsent();
app.post('/signup', async (req, res) => {
  await unsent.send({ to: req.body.email, subject: 'Welcome', html: '<p>Hi!</p>', idempotencyKey: `welcome:${req.body.email}` });
  res.sendStatus(202);
});
```

**Cloudflare Workers** · [examples/cloudflare-worker.ts](examples/cloudflare-worker.ts). Bindings are not on `process.env`, so use `fromEnv`:

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const unsent = Unsent.fromEnv(env);
    ctx.waitUntil(unsent.send({ to: 'ops@acme.com', subject: 'Hi', text: 'Hello' }));
    return new Response('ok');
  },
};
```

**CommonJS**

```js
const { Unsent } = require('unsent-sdk');
```

**Local development.** `http://localhost` and `http://127.0.0.1` base URLs are allowed for `wrangler dev`; any other `http://` URL is rejected so your key never travels in plain text.

## Client options

```ts
new Unsent({
  baseUrl,              // default: process.env.UNSENT_BASE_URL
  apiKey,               // default: process.env.UNSENT_API_KEY
  apiSecret,            // default: process.env.UNSENT_API_SECRET
  defaultFrom,          // used when send() has no `from`
  defaultProviderId,    // used when send() has no `providerId`
  timeoutMs: 30_000,    // per attempt
  maxRetries: 3,        // 0 to disable
  fetch,                // custom fetch (tests, proxies)
  dangerouslyAllowBrowser: false,
});
```

Secrets are held in private fields and never appear in `console.log(unsent)` or `JSON.stringify(unsent)`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `invalid_api_key` | `apiKey` must equal the server's `API_KEY`. Check for stray whitespace or a different environment's key. |
| `invalid_signature` | `apiSecret` must equal the server's `API_SECRET`. |
| `timestamp_skew` with an `apiSecret` set | Your server clock is off by more than 3 minutes. The SDK corrects for this automatically; if it still fails, sync your clock (NTP). |
| `timestamp_skew` / `missing_signature` without an `apiSecret` | The server requires signed requests. Set `UNSENT_API_SECRET`. |
| `unauthorized_sender` | The `from` address is not an active provider in the dashboard. Add it there, or omit `from`. |
| `invalid_response` | `baseUrl` is not pointing at an Unsent deployment (got HTML instead of JSON). |
| `Could not reach ...` | DNS, TLS or network problem. The cause is in `error.cause`. |

## Compatibility

Node 20+, Bun, Deno, Cloudflare Workers (with or without `nodejs_compat`), Vercel Edge, and any runtime with `fetch` and Web Crypto. Browsers are blocked by default (see above). The package ships ESM and CommonJS builds with type declarations.

## Development

```bash
npm install
npm run check                       # typecheck, build, unit tests, package lint
UNSENT_E2E_BASE_URL=http://localhost:8787 UNSENT_E2E_API_KEY=... UNSENT_E2E_API_SECRET=... \
  UNSENT_E2E_FROM=you@example.com npm run test:e2e   # live tests against `wrangler dev` (SECURITY_MODE=full)
```
