# unsent-sdk security and QA test plan

Scope: the TypeScript SDK in `sdk/` (version 1.0.0) and its interaction with the self-hosted Unsent worker
(`src/index.ts`, `src/auth.ts`, `src/providers.ts`, `src/queue.ts`). The SDK is fixed when a defect is found. The
server is only observed: server defects are documented, never patched.

## 1. Assets and actors

| Asset | Where it lives | Why it matters |
|---|---|---|
| `API_KEY` | SDK memory, every request header | Full read access to all stored emails (bodies, bcc lists, attachments) and the send endpoint. |
| `API_SECRET` | SDK memory, HMAC key | Lets a holder mint signed sends. In older server versions it also minted admin sessions. |
| Admin session (dashboard) | Server, `ADMIN_PASSWORD` derived | Provider credentials, `GET /api/keys`, deletion. Must be unreachable with API credentials alone. |
| Email contents / recipients | Request bodies, D1, SMTP | Confidentiality of bcc recipients, integrity of headers. |
| SDK caller process | Node/Bun/workerd | Must not crash, hang, leak memory/timers or pollute prototypes because of input or server output. |

Actors:

1. **Attacker controlling SDK inputs.** The app forwards user data (names, subjects, filenames, list filters, ids,
   even whole option objects such as `req.query`) into SDK calls.
2. **Network attacker / MITM / redirecting proxy.** Can observe (if TLS is broken or plain http), replay, delay, drop,
   reset and redirect requests, and add headers.
3. **Hostile or compromised server** (or a wrong `baseUrl`). Returns arbitrary status codes, headers and bodies, never
   ends a body, sends huge `Content-Length`, absurd `Retry-After`/`Date`, `__proto__` keys, or echoes credentials.
4. **API-credential holder attacking the server through the SDK or raw HTTP.** Holds `API_KEY` + `API_SECRET` and tries
   to escalate to admin, tamper with or replay other requests, or inject email headers.

## 2. Threat model (what could go wrong)

| # | Threat | Actor | Expected defence |
|---|---|---|---|
| T1 | Credentials leak through error messages, `cause` chains, `body`, `inspect`/`JSON.stringify`/`toString`, logs | 1,3 | Never present; server-echoed credentials redacted. |
| T2 | Credentials sent to a different host (redirect, `baseUrl` + path concatenation, user-controlled options) | 1,2 | Redirects refused, path is never caller-controlled, every request URL's origin equals the configured origin. |
| T3 | Credentials sent in clear text | 2 | `http://` refused unless loopback. |
| T4 | HTTP header injection (CRLF/Unicode in apiKey, baseUrl, idempotency key, ids) | 1 | Rejected at construction or validation; nothing user-controlled reaches a header except the validated apiKey. |
| T5 | Email header injection (CRLF, quotes, commas, angle brackets in subject/from/to/filename/mimeType) visible in the raw SMTP message | 1,4 | SDK rejects dangerous values; server sanitization verified in the raw message received by the SMTP sink. |
| T6 | Path / query injection via ids, search, status, sort, dates, offset | 1 | Ids are positive safe integers; query values URL-encoded; enums/dates validated client-side. |
| T7 | Signature bypass on the real server: replay, body tampering, stale or future timestamps, unsigned routing/idempotency headers added to a signed request, wrong key | 2,4 | 401 with stable codes. |
| T8 | Privilege escalation: forging an admin session from `API_SECRET`, calling admin endpoints with an API key | 4 | 401/403. |
| T9 | Server-side injection or crash: SQL-like search/status/sort, prototype-pollution bodies, non-object bodies, oversize bodies, huge ids; error responses leak stack traces or SQL | 4 | 4xx with JSON `{error, code}`; 413 for > 3 MiB; no internals. |
| T10 | ReDoS / super-linear algorithms on any SDK regex or loop | 1,3 | Each 100k+ char pathological input finishes in < 250 ms. |
| T11 | Crash on junk input: TypeError/RangeError/hang/unhandled rejection instead of a typed SDK error | 1 | Only `UnsentError` subclasses, always within a bounded time. |
| T12 | Crash, hang or pollution on hostile responses | 3 | Typed errors (`invalid_response`, `response_too_large`, `timeout`, `unexpected_redirect`); no prototype pollution. |
| T13 | Resource exhaustion: memory (unbounded bodies), timers, abort listeners leaked by aborted/retried calls, retry storms | 1,3 | Bounded body reads, all timers cleared, listener counts return to baseline. |
| T14 | Duplicate emails from retries (lost response, timeouts, parallel callers) | 2 | Same idempotency key on every retry; exactly one email server-side. |
| T15 | Supply chain / packaging: runtime deps, secrets or absolute paths in the tarball, broken ESM/CJS, runtime incompatibility | n/a | Zero runtime deps, clean tarball, works on Node, Bun and workerd. |

## 3. Test cases per area

Legend: **U** = unit/fuzz test in default `npm test` (mock or in-process HTTP server on an ephemeral port),
**E** = live end-to-end test gated on `UNSENT_E2E_BASE_URL`, run in all three server `SECURITY_MODE`s unless noted.

### 3.1 Credential and secret leakage (T1-T3) — `test/security.test.ts`
| Case | Type | Expected |
|---|---|---|
| `inspect`, `JSON.stringify`, `String`, `Object.keys/getOwnPropertyNames` on `Unsent`, `Emails`, every error | U | no key/secret |
| Errors from every failure class (connection refused, timeout, abort, 401/403/404/409/413/429/5xx, redirect, invalid JSON, oversize) inspected with `depth: Infinity, showHidden: true` including `cause` | U | no key/secret |
| apiKey with CR, LF, NUL, DEL, TAB, non-ASCII, emoji, U+2028 | U | `UnsentConfigError` at construction; key not in message |
| Server echoes `X-API-Key`/secret in `error`, `reason`, text body, `Location` | U | redacted (`[REDACTED]`) in `message`, `reason`, `body` |
| Redirect 301/302/303/307/308 (+ `Location` to evil host) | U | `unexpected_redirect`, fetch called once, never to the other host; real in-process server variant |
| Option-spread path injection: `list({path:'@evil/x'})`, `get(1,{path,method,body,auth,query,sign,retrySafe})`, `status/health({...})` | U | extra keys ignored; every URL origin = configured origin |
| `baseUrl` userinfo, `http://` remote, `http://localhost.evil.test`, `http://127.0.0.1.nip.io`, IPv4-mapped IPv6, trailing-dot localhost, `javascript:`, `file:`, `data:` | U | config error; loopback forms allowed |
| Env vars `HTTP_PROXY`/`HTTPS_PROXY` set | U | SDK makes no proxy-specific decisions; documented as out of scope |
| SDK writes nothing to `console.*` during any test | U | console spies never called |

### 3.2 Header / CRLF / Unicode injection (T4, T5)
| Case | Type | Expected |
|---|---|---|
| CRLF/NUL in to/cc/bcc/from email/from name/filename/idempotency key/providerId | U | validation error, nothing sent |
| Recipient with `,` `;` `<` `>` `"` whitespace, Unicode line separators U+2028/2029/0085 | U | validation error (prevents recipient-limit bypass and RCPT/To mangling) |
| From display name with `"` or `\` | U | validation error (server does not escape quotes; see §6) |
| Filename with `"`, `\`, control chars; mimeType with params injection / CRLF / > 127 chars | U | validation error |
| Subject with CRLF + `Bcc:` line, U+2028, NEL | E | message accepted; raw SMTP message has exactly one `Subject:` line and no injected header |
| Raw API (bypassing SDK validation): from name with quotes, filename with `"`, mimeType with `;name=`, recipient with comma | E | observe raw message; server defects documented, recorded as known defects |
| `BCC:` header in delivered message | E | **known server defect** — `it.fails` |

### 3.3 Path / query injection (T6) — `test/validation.test.ts`
| Case | Type | Expected |
|---|---|---|
| `get(id)` with `'1/../keys'`, `1.5`, `-1`, `0`, `NaN`, `2**53`, `'1'`, `1n`, objects | U | validation error |
| `list` status/sort outside the enums; search non-string; offset unsafe integer (1e300); limit 0/201/1.5 | U | validation error |
| `list` from/to: invalid calendar dates (`2024-02-30`, `2024-99-99`), trailing junk, years > 9999, invalid `Date` | U | validation error |
| Search with `& = # % + ? /`, SQL meta, 4k chars, unicode | U | exact round-trip through `URLSearchParams` |
| SQL-ish strings in search/status/sort sent raw | E | 200 normal result or 400, never 500/SQL text |

### 3.4 HMAC and server auth attacks (T7, T8) — `test/security.e2e.test.ts`
All requests built with `node:crypto`, independent of the SDK. Expectations are mode-specific
(`full` / `signed` / `api-key-only`):

| Case | full | signed | api-key-only |
|---|---|---|---|
| Valid signed request | 202 | 202 | 202 |
| Exact replay of a captured signed request | 401 `nonce_reused` | accepted (no nonce store; deduplicated only if keyed) | accepted |
| Body tampered after signing | 401 `invalid_signature` | 401 `invalid_signature` | accepted (by design) |
| Timestamp now-181s / now+181s | 401 `timestamp_skew` | same | accepted |
| Timestamp ±170 s | 202 | 202 | 202 |
| Non-numeric / padded timestamp, malformed nonce | 401 | 401 | accepted |
| Add `X-Provider-Id` / `X-Sender-Email` to a validly signed request | 401 `invalid_signature` | same | header honored (by design) |
| Add `Idempotency-Key` header to a signed request (no body key / different body key) | 400 `invalid_idempotency_key` | same | accepted / 400 on mismatch |
| Right signature, wrong API key | 401 `invalid_api_key` | same | same |
| Forged admin token: HMAC(API_SECRET, payload), `unsent:session:v1:` key, v2 key with guessed password | 401 on admin routes; 403 when combined with valid API key | same | same |
| `GET /api/providers`, `GET /api/keys`, `DELETE /api/emails/:id`, `POST /api/providers` with API key only | 403, email still exists | same | same |
| Real admin login → `GET /api/keys` (positive control) | 200 | 200 | 200 |
| Prototype-pollution bodies (`__proto__`, `constructor.prototype`) signed | 202/400, later responses unaffected | same | same |
| Signed non-JSON, `[]`, `null`, `42`, `"str"` bodies | 400 `invalid_json` / `validation_error` | same | same |
| Body > 3 MiB with `Content-Length` and chunked | 413 `payload_too_large` | same | same |
| Every 4xx/5xx body scanned for `at `, `.ts:`, `SQLITE`, `D1_`, `stack` | none | none | none |
| `GET /api/emails/<huge id>`, `limit=abc`, login with JSON `null` body | no 500 (documented if so) | | |

### 3.5 ReDoS and complexity (T10) — `test/fuzz.test.ts`
Every regex and string loop in `src/`: `NAMED_RE`, recipient checks, base64 validation and whitespace stripping,
`/=+$/` in mapping, `/\/+$/` in URL normalisation, date regex, idempotency-key regex, escapeHtml, MIME/filename checks.
Inputs of 100k-1M chars (spaces, `=`, `/`, `<`, quotes, mixed). Each measured; must finish in < 250 ms. Also a 2 MB
attachment encode and a 1 MB html body sign must complete in < 1 s.

### 3.6 Fuzzing every public method (T11) — `test/fuzz.test.ts`
Seeded PRNG (mulberry32, fixed seeds, reproducible). For `new Unsent`, `Unsent.fromEnv`, `send`, `emails.send`,
`get`, `list`, `iterate`, `wait`, `status`, `health`, `attachmentFromFile`: thousands of calls with junk values:
wrong primitives, `NaN`, `±Infinity`, `-0`, BigInt, Symbol, functions, cyclic objects, Proxies whose traps throw, objects
with throwing getters / `toString` / `valueOf` / `Symbol.toPrimitive`, null-prototype objects, huge arrays (1e6),
sparse arrays, huge strings, lone surrogates, CRLF. Assertions: every rejection is an `UnsentError`; every call
settles within 2 s; no `unhandledRejection`/`uncaughtException`; `Object.prototype` unchanged.

### 3.7 Hostile server responses (T12, T13) — `test/hostile-server.test.ts`
Real in-process `node:http` servers on ephemeral ports (and mock fetch where real sockets are not needed):
garbage JSON, `null`, arrays, wrong field types, objects with `toString: null`, `__proto__`/`constructor` keys,
enormous `Content-Length` (> 32 MiB) → `response_too_large` without reading; streamed body over 32 MiB →
`response_too_large`; never-ending body / slowloris headers / slowloris body → `timeout` within `timeoutMs`;
`Retry-After` huge / negative / NaN / HTTP-date → capped at 60 s; absurd `Date` header; 3xx loops; 1xx-ish/odd status
codes; connection reset mid-body; custom `fetch` returning non-Response values.

### 3.8 Resource exhaustion and concurrency (T13, T14) — `test/resilience.test.ts`
| Case | Expected |
|---|---|
| 1000 calls sharing one long-lived `AbortSignal` (success, error, timeout, abort, retry paths) | abort listener count back to 0 |
| Active timers/handles after aborted, timed-out and retried calls (`process.getActiveResourcesInfo()`) | back to baseline |
| 200 parallel sends with mixed failures | each resolves/rejects independently; distinct keys; fresh nonces |
| Shared clock offset under concurrent skew errors | at most one correction per call, offset consistent, no loops |
| Abort races: abort before, during fetch, during body read, during backoff, after settle | `aborted`, no unhandled rejection |
| Per-call `timeoutMs`/`maxRetries` and `wait()` options NaN/negative/Infinity/huge | validation error (no instant timeout, no busy loop) |
| `wait()` deadline also bounds the in-flight `get` | rejects by roughly `timeoutMs` even if the server hangs |
| Client-side 3 MiB body cap and early per-attachment size check | `payload_too_large`, nothing sent, no giant base64 built |

### 3.9 End-to-end functional and resilience — `test/e2e.test.ts`, `test/resilience.e2e.test.ts`
| Case | Expected |
|---|---|
| Existing suite (health, text-only, html+text+cc+bcc+attachments, idempotency replay/conflict, parallel key, 25 signed sends, clock skew, wrong credentials (mode-aware), unauthorized sender, 404, iterate) | pass in all modes |
| **Lost response**: proxy forwards the first `/api/send` upstream, waits for the worker's answer, then destroys the client socket | SDK retries same key; result `idempotentReplay: true`; exactly one email for the tag |
| Delayed response beyond `timeoutMs` | timeout → retry → replay; exactly one email |
| 120 parallel distinct sends; 100 parallel sends with one key | 120 unique ids; exactly 1 email |
| Unicode round-trip (emoji, RTL, combining, CJK, astral, lone surrogate → U+FFFD) in subject/html/text/name/filename | stored values equal; raw message decodes |
| Attachments just under / just over the stored-size limit (computed exactly) | 202 + delivered / 413 `payload_too_large`, not retried |
| 20 vs 21 attachments, 100 vs 101 recipients (SDK and raw API) | 20/100 accepted; 21/101 rejected client-side and by server |
| `wait()` timeout path and `wait()` → permanently `failed` (SMTP sink stopped, queue re-driven) | `UnsentTimeoutError`; then `status: 'failed'`, `attempts >= 3` |

### 3.10 Packaging, supply chain, runtimes — `test/package.test.ts`
| Case | Expected |
|---|---|
| `npm pack`: file list exactly `dist/*`, README, CHANGELOG, package.json | no `src/`, tests, `.env`, maps with absolute paths |
| Tarball grep for test credentials (`e2e-key`, `e2e-secret`, `test-api-key`, `SUPER-`), `/home/`, `file://` | none |
| `dependencies`/`peerDependencies`/`optionalDependencies` empty, no install scripts | zero runtime deps |
| Install tarball into a scratch project; `import` and `require` both entry points | works, same exports |
| Built bundle on Bun and in workerd (Miniflare), signing verified by an independent HMAC | correct signature, no Node-only APIs in the main entry |
| `npm audit --omit=dev` and full `npm audit` | 0 runtime vulnerabilities; dev findings reported |

## 4. Execution

```bash
cd sdk && npm run check                          # typecheck, build, unit/fuzz/security, publint, attw
for mode in full signed api-key-only; do
  eval "$(E2E_ROOT=<scratch> ../scripts/e2e-server.sh start 8815 $mode)"
  npx vitest run --no-file-parallelism test/*e2e*.test.ts
  ../scripts/e2e-server.sh stop 8815
done
```

## 5. Out of scope

- Fixing server code (`src/`). Server defects are documented in `SECURITY_TEST_REPORT.md`.
- TLS validation itself (delegated to the runtime's `fetch`), DNS rebinding, and `*.localhost` resolution behaviour of the
  host resolver.
- Third-party provider APIs (Resend, SendGrid, Mailgun, Postmark); only the SMTP path is exercised end-to-end.
- Timing side channels on the server's API-key comparison (not measurable reliably over loopback).
- Browser execution (the SDK refuses to run in browsers by default); Deno is not installed on the test host.
- Rate limiting / brute force of the dashboard login (no limiter exists; recorded as a residual risk).
- The other SDK ports (`sdk-python/`, `sdk-go/`, `sdk-ruby/`, `sdk-rust/`).
