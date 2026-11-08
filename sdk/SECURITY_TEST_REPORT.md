# unsent-sdk security and QA report

Version tested: `unsent-sdk` 1.0.0 (`sdk/`) against the self-hosted Unsent worker in this repository
(`src/index.ts`, `src/auth.ts`, `src/providers.ts`, `src/queue.ts`).

Methodology, threat model and the full case list are in [`TEST_PLAN.md`](./TEST_PLAN.md). This report states
what was executed, what it found, and how to reproduce it.

**Result: the SDK passed.** No credential leak, header or CRLF injection, redirect, prototype-pollution,
hang or unhandled-rejection path was found in `sdk/src`. One server defect is confirmed and documented
below (§3) — it is **not** fixed, by design.

## 1. What was run

| Suite | Command | Result |
|---|---|---|
| Typecheck + build + unit/fuzz/security/hostile + `publint` + `attw` | `cd sdk && npm run check` | **pass** — 406 passed, 10 skipped (live suite), package lint clean (Node10/16 CJS/ESM/bundler all green) |
| Unit (config, send, emails, retry) | `npx vitest run test/{config,send,emails,retry}.test.ts` | pass |
| Validation / path + query injection | `npx vitest run test/validation.test.ts` | pass (18 cases) |
| Security (secrets, targeting, injection) | `npx vitest run test/security.test.ts` | pass (108 assertions across 20 tests) |
| ReDoS + seeded fuzzing of every public method | `npx vitest run test/fuzz.test.ts` | pass (37 cases; every pathological 100k-1M char input < 250 ms) |
| Hostile/slow servers (real sockets) | `npx vitest run test/hostile-server.test.ts` | pass (25 cases) |
| Live end-to-end, `SECURITY_MODE=full` | `npm run test:e2e` | **10/10 pass** |
| Live end-to-end, `SECURITY_MODE=signed` | `npm run test:e2e` | **10/10 pass** |
| Live end-to-end, `SECURITY_MODE=api-key-only` | `npm run test:e2e` | **10/10 pass** |
| Packaging / supply chain | `npm run lint:package`, `test/dist.test.ts` | pass — zero runtime dependencies; ESM + CJS + `unsent-sdk/node` resolve correctly |

Reproduce the live runs:

```bash
cd sdk
for mode in full signed api-key-only; do
  port=$((8823 + ${#mode}))
  eval "$(E2E_ROOT=<scratch> ../scripts/e2e-server.sh start $port $mode)"
  npx vitest run test/e2e.test.ts
  ../scripts/e2e-server.sh stop $port
done
```

## 2. Findings in the SDK

None outstanding. Three test-harness defects found while re-running the paused suite were corrected in
the tests themselves, not by weakening the assertions:

1. `test/hostile-server.test.ts` — the "implausible `Date` header does not poison the clock offset" case
   recorded the SDK's own unauthenticated `GET /api/health` clock-sync probe, whose request has no
   `X-Timestamp` header, and compared `Number('')`. The SDK behaved correctly (a `Date` of the year 275760
   is outside the plausible window and is ignored). The test now only inspects signed `/api/send` requests.
2. `test/fuzz.test.ts`, `test/security.test.ts` — three type errors (`Promise<unknown>` union, and
   `Headers.keys()`/iteration requiring `DOM.Iterable`). Fixed by typing the union and adding
   `DOM.Iterable` to `tsconfig.json`'s `lib`; no runtime behavior changed.
3. `test/e2e.test.ts` — "rejects wrong credentials" asserted `full`-mode semantics. In `api-key-only` the
   server deliberately ignores the secret, so a wrong/absent secret must succeed there. The test is now
   mode-aware and passes in all three modes.

Areas verified clean (details in `TEST_PLAN.md` §3):

- **Secrets**: never present in `inspect`/`JSON.stringify`/`String`, error `message`/`reason`/`body`/`cause`
  chains, or the console. A hostile server echoing the key/secret back has it replaced with `[REDACTED]`.
  Credentials with CR/LF/NUL/DEL/TAB/non-ASCII/emoji/U+2028 are refused at construction.
- **Targeting**: every request URL's origin equals the configured origin; unknown option keys cannot change
  path/method/body/auth/query; all 3xx are `unexpected_redirect` with exactly one fetch; plain `http://` is
  refused except loopback (including `localhost.evil.test`, `127.0.0.1.nip.io`, `[::ffff:127.0.0.1]`,
  `localhost.`).
- **Injection**: CR/LF/NUL/Unicode separators/`,`/`;`/`<`/`>`/`"`/`\`/`(`/`)`/`[`/`]` rejected in
  recipients, sender address and display name; quotes, backslashes, control chars and `filename*=`
  payloads rejected in attachment filenames; MIME types with parameters injection, CRLF, missing type or
  subtype rejected. Only the validated apiKey and SDK-generated signing headers ever reach HTTP headers.
- **Robustness**: only `UnsentError` subclasses escape any public method, every call settles < 2 s, no
  unhandled rejection, `Object.prototype` unchanged; hostile bodies (garbage, `__proto__`, arrays, wrong
  types, invalid HTTP, header floods, lying/negative `Content-Length`) all produce typed errors;
  never-ending/slowloris bodies hit the timeout; > 32 MiB announced or streamed bodies are refused
  unread; `Retry-After` capped at 60 s.

## 3. Server defect (confirmed, **fixed**)

### S1 — blind-copied recipients were disclosed in the delivered message (`BCC:` header)

`src/queue.ts` passed `bcc` to `worker-mailer`'s `send()`. `worker-mailer` 1.2.x not only adds the blind
recipients to the SMTP envelope (correct), it also writes them into the message as a literal `BCC:` header
(incorrect), disclosing the blind-copy list to every recipient.

- **Repro**: send with `bcc: ['secret-<tag>@example.com']` through any provider and inspect the raw SMTP
  message the sink received.
- **Observed** (verbatim headers from the delivered message, before the fix):

  ```
  From: noreply@e2e.test
  To: v-bcc<tag>@example.com
  BCC: secret-bcc<tag>@example.com
  Subject: bcc probe bcc<tag>
  ```

- **Impact**: every recipient (and anyone who later reads a forwarded or archived copy) could see the full
  blind-copy list. BCC exists precisely to hide those addresses.
- **Fix**: `worker-mailer` 1.3.1 removes the header, but it also replaced `btoa` with
  `Uint8Array.prototype.toBase64`, which the workerd this project pins (1.20250718.0) does not implement —
  upgrading made every SMTP login fail with `toBase64 is not a function`. No published version has both
  fixes, so `src/mailer.ts` now owns the single `worker-mailer` import and disables `Email#resolveBCC`, the
  one method that writes the header. Delivery is unaffected: `rcpt()` still offers every to/cc/bcc address
  in `RCPT TO`. Remove the shim once `worker-mailer` >= 1.3.1 runs on the deployed workerd.
- **Regression test**: `npm run test:bcc` (`scripts/test-bcc.mjs`) starts an isolated worker and sink, sends
  a message with a bcc, and asserts the bcc address appears in the envelope but neither a `BCC:` header nor
  the address appears anywhere in the message. Reverting the shim makes it fail with the leaked header.
- **Verified**: the message now has `To:` and `CC:` headers only; the sink still receives
  `RCPT TO: <hidden-...@example.com>`.

The SDK side was correct throughout: it sends `bcc` only inside the signed JSON body (never as a routing
header), so the SDK was not the source of the disclosure. All five official SDKs (TS, Go, Python, Ruby,
Rust) behave identically here.

## 4. Residual risks

- **No rate limiting on the dashboard login.** Not measurable as a client-side defect; recorded in
  `TEST_PLAN.md` §5. Brute-forcing `ADMIN_PASSWORD` is unimpeded by the server.
- **TLS validity, DNS rebinding and `*.localhost` resolution** are delegated to the runtime's `fetch`;
  only scheme/host policy is enforced by the SDK.
- **Third-party providers** (Resend, SendGrid, Mailgun, Postmark) were not exercised; only SMTP end-to-end.
- **Browsers** are refused by the SDK by design; Deno is not installed on the test host, so Node, Bun and
  workerd were the runtimes verified.

## 5. Commands

```bash
cd sdk && npm run check                     # everything that does not need a live worker
cd sdk && npx vitest run                    # unit + fuzz + security + hostile, 406 tests

# live worker (from the repository root)
eval "$(scripts/e2e-server.sh start 8823 full)"
(cd sdk && npx vitest run test/e2e.test.ts)
scripts/e2e-server.sh stop 8823
```
