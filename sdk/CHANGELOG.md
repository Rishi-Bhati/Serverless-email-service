# Changelog

## 1.0.0

Initial release.

- `Unsent` client with `send()`, `emails.send/get/list/iterate/wait`, `status()` and `health()`.
- Automatic HMAC signing and nonces for `signed`/`full` servers; works unchanged with `api-key-only`.
- Idempotency keys generated per send, with safe automatic retries (network errors, 408, 429, 5xx), backoff and `Retry-After`.
- Automatic correction of a skewed local clock.
- Attachments from `Uint8Array`, `Buffer`, `ArrayBuffer`, `Blob`/`File` or base64, plus `attachmentFromFile` for Node (`unsent-sdk/node`).
- Typed error hierarchy with stable codes and fix hints.
- Zero dependencies; ESM and CommonJS; Node 20+, Bun, Deno, Cloudflare Workers, Vercel Edge.
