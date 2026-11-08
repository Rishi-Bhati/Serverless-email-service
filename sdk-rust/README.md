# unsent (Rust)

Official Rust SDK for your self-hosted [Unsent](../README.md) email service.

- **A few lines to send.** No HMAC code, nonces, timestamps or base64 to write yourself.
- **Safe retries.** Every send carries an idempotency key, so network errors and 5xx responses are retried automatically without ever sending the same email twice.
- **Async and idiomatic.** `async fn` everywhere on tokio, a single `Error` enum with stable codes, and an `Unsent` client that is `Clone + Send + Sync` — build one at startup and clone it into every handler and task.
- **Small and safe.** `reqwest` on rustls plus `tokio`, `#![forbid(unsafe_code)]`, Rust 1.89+.

```rust
use unsent::{EmailStatus, SendEmail, Unsent};

#[tokio::main]
async fn main() -> Result<(), unsent::Error> {
    let client = Unsent::from_env()?; // UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET

    let receipt = client
        .emails()
        .send(
            SendEmail::builder()
                .to("customer@example.com")
                .subject("Welcome!")
                .html("<h1>Hello</h1><p>Your account is ready.</p>"),
        )
        .await?;
    println!("queued as #{}", receipt.id);

    let email = client.emails().wait(receipt.id).await?; // polls until delivered
    if email.status == EmailStatus::Sent {
        println!("delivered via {}", email.provider_used.as_deref().unwrap_or("-"));
    }
    Ok(())
}
```

Runnable examples live in [`examples/`](examples): `basic`, `attachments`, `errors`, `list_and_iterate`, `cancel`, `axum_handler` and `custom_transport`.

## Install

```bash
cargo add unsent-sdk
cargo add tokio --features rt-multi-thread,macros   # for #[tokio::main]; the SDK itself needs tokio too
```

The **crate** is `unsent-sdk` (that is what goes in `Cargo.toml`); the **library** is `unsent`, so you import it as `use unsent::{SendEmail, Unsent};`.

TLS comes from `rustls` (no OpenSSL, no system dependencies) and the HTTP stack from `reqwest`; both are pulled in for you. Any tokio runtime works.

## Set up credentials

You need three values from your Unsent deployment. Sign in to the dashboard as an administrator and open the **API Docs** tab, which fills in your real keys, or use the secrets you deployed:

| Environment variable | Value |
|---|---|
| `UNSENT_BASE_URL` | Your deployment URL, e.g. `https://unsent.example.com` |
| `UNSENT_API_KEY` | The `API_KEY` secret |
| `UNSENT_API_SECRET` | The `API_SECRET` secret |

Empty variables count as unset. Or pass them explicitly — explicit options always win over the environment:

```rust
use unsent::Unsent;

fn client() -> Result<Unsent, unsent::Error> {
    Unsent::builder()
        .base_url("https://unsent.example.com")
        .api_key(std::env::var("MY_KEY").unwrap_or_default())
        .api_secret(std::env::var("MY_SECRET").unwrap_or_default())
        .build()
}
```

`api_secret` is used to sign requests. It is required unless your server runs with `SECURITY_MODE=api-key-only`, and it is safe to pass in every mode: the SDK signs only when a secret is configured, so the same code works everywhere.

| `SECURITY_MODE` | What the server checks | What the SDK sends |
|---|---|---|
| `api-key-only` | `X-API-Key` | `X-API-Key`. Signing is skipped when no secret is set; a secret you do set is simply ignored by the server. |
| `signed` | `X-API-Key`, plus a signature on `POST /api/send` | `X-API-Key`, `X-Timestamp`, `X-Nonce`, `X-Signature` on every send |
| `full` | the same, plus a nonce-replay store | the same, with a fresh nonce on every attempt |

`Unsent::from_vars(iter)` reads the same three names from any iterator of pairs, for configuration that does not live in the process environment (a config crate, a secret manager, a test):

```rust
use unsent::Unsent;

fn client(vars: &[(&str, &str)]) -> Result<Unsent, unsent::Error> {
    Unsent::from_vars(vars.iter().copied())
}
```

> **Keep these on the server.** Anyone holding the API secret can send email as you. The SDK never prints them: `Debug` on the client (`{:?}`, `{:#?}`), the `Secret` type, error messages, error fields and error `Debug` output all redact credentials.

Credentials must be printable ASCII (leading and trailing whitespace is trimmed); anything else is `Error::Config` with code `invalid_config`. `base_url` must be `https://` (`http://` is accepted only for `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`) and must not embed credentials. It is normalized for you: trimmed, query and fragment dropped, trailing `/` removed, path prefix kept.

## Sending email

```rust
use unsent::{Address, SendEmail, Unsent};

async fn welcome(client: &Unsent, signup: &str) -> Result<(), unsent::Error> {
    let email = SendEmail::builder()
        // optional; must be a sender configured in your dashboard, otherwise omit it
        .from(Address::with_name("support@acme.com", "Acme Support"))
        .to_all(["a@example.com", "b@example.com"])
        .cc("manager@example.com")
        .bcc("audit@example.com")
        .subject("Your order has shipped")
        .html("<p>It is on its way.</p>")
        .text("It is on its way.") // optional plain-text alternative
        .provider_id("resend_marketing") // optional: force one provider
        .idempotency_key(format!("welcome:{signup}")); // optional, see below

    let receipt = client.emails().send(email).await?;
    // receipt.id, receipt.status (Queued), receipt.idempotent_replay, receipt.target_provider
    println!("queued as {}", receipt.id);
    Ok(())
}
```

`client.send(email)` is a shortcut for `client.emails().send(email)`.

| Method | Notes |
|---|---|
| `.to(addr)` / `.to_all(iter)` | Required. Up to 100 addresses per field; each must contain `@` and no CR, LF or NUL. |
| `.cc(addr)` / `.cc_all(iter)` | Optional, up to 100. |
| `.bcc(addr)` / `.bcc_all(iter)` | Optional, up to 100. |
| `.subject(s)` | Required, non-blank, up to 1000 **UTF-16 units** (the server counts JS string length, so an emoji counts 2). |
| `.html(s)` / `.text(s)` | Provide at least one. A text-only send gets an HTML body derived from the text automatically (the API requires HTML). |
| `.from(addr)` | `"Name <a@b.com>"`, `"a@b.com"`, an `Address`, or `(email, name)`. Falls back to the client's `default_from`, then to the server's default provider. |
| `.provider_id(s)` | Route through one provider (non-blank, up to 255 characters). Falls back to the client's `default_provider_id`. |
| `.attachment(a)` / `.attachments(iter)` | Up to 20. See below. |
| `.idempotency_key(k)` | See below. 1 to 255 printable ASCII characters without spaces. |
| `.no_idempotency()` | Send without a key. The send is then never retried. |
| `.timeout(d)` / `.max_retries(n)` | Per-call overrides of the client defaults. |
| `.cancellation_token(token)` | Abort the call (including retries and backoff sleeps) when the token fires. |
| `SendEmail::from_json(&value)` | Build a message from JSON, for example a queue payload. |

Everything is validated **before any network I/O**; invalid input returns `Error::Validation` (code `validation_error`, or `invalid_idempotency_key`, `payload_too_large` and `attachment_read_error` for those specific cases) and nothing is sent. The rules, in full:

- `to` is required and must hold at least one non-blank address after trimming; `cc`/`bcc` are optional and blank entries are dropped.
- Every address must be a string containing `@`, and must not contain CR, LF or NUL.
- `subject` is required and must not be blank; over 1000 UTF-16 units it is rejected with the counted length in the message.
- At least one of `html`/`text` must be non-blank. If only text is given, the SDK derives `<div style="white-space:pre-wrap">` + HTML-escaped text (`& < > " '`) + `</div>`, because the API requires an HTML body.
- Attachments: at most 20, each with a non-blank filename (≤ 255 UTF-16 units, no CR/LF/NUL) and non-empty content.
- `from` must have a non-blank email and no CR/LF/NUL in the email or the display name.
- `provider_id` must be non-blank and at most 255 UTF-16 units.
- The finished JSON body must be at most 3 MiB; larger messages are refused as `payload_too_large` **before** the base64 is built, so a huge attachment cannot exhaust memory.

`send()` returns as soon as Unsent has **accepted** the email (HTTP 202). Delivery happens in the background, with automatic failover across your providers.

`SendEmail::from_json` accepts a queue payload and never panics on wrong types — it returns `Error::Validation` instead. Recognised fields: `to`, `cc`, `bcc` (a string or an array of strings), `subject`, `html`, `text`, `from` (a string or `{ "email", "name" }`), `provider_id` (or `providerId`), `idempotency_key` (or `idempotencyKey`; `false` disables it) and `attachments` (an array of `{ "filename", "content" (base64), "content_type" }`).

### Waiting for delivery

```rust
use std::time::Duration;
use unsent::{EmailStatus, Unsent, WaitOptions};

async fn deliver_and_report(client: &Unsent, id: i64) -> Result<(), unsent::Error> {
    let email = client.emails().wait(id).await?; // polls until final, 60 s timeout by default

    if email.status == EmailStatus::Sent {
        println!("delivered via {}", email.provider_used.as_deref().unwrap_or("-"));
    } else {
        println!("failed: {:?} after {:?}", email.error, email.failover_history);
    }
    Ok(())
}

async fn patient(client: &Unsent, id: i64) -> Result<(), unsent::Error> {
    let email = client
        .emails()
        .wait_with(
            id,
            WaitOptions::new()
                .timeout(Duration::from_secs(120))
                .interval(Duration::from_millis(500)),
        )
        .await?;
    println!("{}", email.status);
    Ok(())
}
```

`wait` returns once the email is `sent`, or `failed` after the service has used up its delivery attempts (`unsent::MAX_DELIVERY_ATTEMPTS`, which is 3). **A permanent failure is a normal return value, not an error** — check `email.status`. If the email is still in flight at the deadline you get `Error::Timeout` (code `timeout`).

`WaitOptions::new()` defaults to a 60 s deadline and a 1 s first poll interval. The interval is raised to at least 100 ms, grows by 1.5x up to 5 s, and the last sleep is clipped to the remaining time. `WaitOptions::cancellation_token(..)` stops the loop early with `Error::Aborted`. `email.is_final()` is the exact predicate the loop uses.

### Attachments

```rust
use unsent::{Attachment, SendEmail, Unsent};

fn invoice(pdf_bytes: Vec<u8>) -> Result<SendEmail, unsent::Error> {
    // raw bytes: base64-encoded for you
    let csv = Attachment::from_bytes("report.csv", "id,total\n1,9\n").content_type("text/csv");
    // content that is already base64
    let hello = Attachment::from_base64("hello.txt", "aGVsbG8=").content_type("text/plain");
    // a file on disk: name and MIME type taken from the path
    let logo = Attachment::from_path("./logo.png")?.filename("logo-2026.png");

    Ok(SendEmail::builder()
        .to("customer@example.com")
        .subject("Invoice")
        .html("<p>Attached.</p>")
        .attachment(Attachment::from_bytes("invoice.pdf", pdf_bytes))
        .attachment(csv)
        .attachment(hello)
        .attachment(logo))
}

async fn send_it(client: &Unsent, email: SendEmail) -> Result<(), unsent::Error> {
    client.emails().send(email).await?;
    Ok(())
}
```

| Constructor | Notes |
|---|---|
| `Attachment::from_bytes(name, impl Into<Vec<u8>>)` | Raw bytes: `&str`, `[u8; N]`, `Vec<u8>` all work. The SDK base64-encodes them. |
| `Attachment::from_base64(name, impl Into<String>)` | Content that is already base64. Whitespace is stripped; it must be valid, **padded** standard base64, otherwise you get a validation error telling you to pass bytes for non-base64 data. |
| `Attachment::from_path(path)` | Reads the file synchronously, takes the filename from the last path component and guesses the MIME type from the extension (pdf, png, jpg/jpeg, gif, webp, svg, txt, csv, json, html, xml, zip, doc/docx, xls/xlsx, ics). Returns `Error::Validation` with code `attachment_read_error` when the file cannot be read. |

Override the name or type with `.filename(..)` / `.content_type(..)`. `Attachment` is `Clone`, and its `Debug` output shows the filename, the type and the content *length* — never the content. Because `from_path` blocks, wrap it in `tokio::task::spawn_blocking` for large files inside async code.

The service stores the body and attachments together in one database row, so keep the total under about **1.4 MB of raw attachment data**. The SDK's own limit is the 3 MiB request body (about 2.2 MB of raw bytes); above the server's row limit the send fails with `413 payload_too_large`.

### Idempotency and retries

Network problems, per-attempt timeouts and 5xx responses are retried up to `max_retries` times (default 3) with exponential backoff, honouring `Retry-After`. Retries are safe because every send carries an idempotency key:

- By default the SDK generates a UUIDv4 per `send()` call and reuses it across that call's retries. A request that actually succeeded but whose response was lost is recognised on retry (`receipt.idempotent_replay == true`).
- Pass your **own** key (e.g. `order-8492:shipped`) to also deduplicate across calls, processes and your own job retries. The same key with the same message returns the original email (kept for 24 hours by default); the same key with a *different* message fails with `Error::Conflict` (code `idempotency_key_conflict`, `err.existing_email_id() == Some(..)`).
- Call `.no_idempotency()` to opt out. The SDK then never retries that send, because without a key a retry could deliver the email twice. Every other send the SDK retries is keyed.

Keys are 1 to 255 printable ASCII characters without spaces; anything else is `Error::Validation` with code `invalid_idempotency_key`, raised before a request is made.

What is retried: network errors, per-attempt timeouts, HTTP 408, 425, 429 and 5xx — except 501, 505 and the `server_misconfigured` code. Never retried: other 4xx, 3xx, cancellation, and any call that is not retry-safe (a send without an idempotency key). `GET` calls are always retry-safe. Every attempt gets a fresh timestamp and nonce; the body, including the idempotency key, is byte-identical across attempts.

Backoff: `exp = min(8000, 500 * 2^attempt)` ms, delay = `exp/2 + random * exp/2` (full jitter), raised to `max(backoff, Retry-After)` when the server sent one. `Retry-After` is parsed as seconds or as an HTTP date and **capped at 60 s**; unparsable values are ignored. The sleep is cancellable, so aborting during backoff returns immediately.

The SDK also corrects a skewed local clock. On a `401 timestamp_skew` with an `api_secret` configured it learns the server time — from the response `Date` header, or else from `GET /api/health` (bounded by a 5 s probe timeout) — at most **once per call**, without consuming a retry. An offset of at least 30 s is stored and used for all later signatures; a smaller offset resets a stale stored offset to 0. Either way the call retries immediately; if neither helps, the original error is returned.

## Inspecting emails

```rust
use unsent::{EmailStatus, ListEmails, Sort, Unsent};

async fn inspect(client: &Unsent) -> Result<(), unsent::Error> {
    // includes attachment content (base64)
    let email = client.emails().get(1234).await?;
    if let Some(Ok(bytes)) = email.attachments.first().and_then(|a| a.bytes()) {
        println!("first attachment: {} bytes", bytes.len());
    }

    let page = client
        .emails()
        .list(
            ListEmails::new()
                .status(EmailStatus::Failed)
                .search("invoice")
                .from("2026-01-01") // YYYY-MM-DD (UTC), or a SystemTime
                .sort(Sort::CreatedAtDesc)
                .limit(50),
        )
        .await?;
    println!("{} of {} emails, more: {}", page.emails.len(), page.total, page.has_more);

    let queue = client.status().await?; // { queued, sending, sent, failed }; also verifies your credentials
    println!("{} queued, {} sent", queue.queued, queue.sent);

    let health = client.health().await?; // public liveness probe (does not verify credentials)
    println!("{} on {}", health.status, health.runtime);
    Ok(())
}
```

| `ListEmails` method | Notes |
|---|---|
| `.limit(n)` | 1 to 200; validated client-side. |
| `.offset(n)` | Rows to skip (default 0). |
| `.status(EmailStatus)` | `Queued`, `Sending`, `Sent` or `Failed`. |
| `.search(s)` | Matches subject, recipients, sender, provider, body and error text. |
| `.from(day)` / `.to(day)` | `"YYYY-MM-DD"` (UTC) or a `SystemTime`; a malformed string is a validation error when the query runs. |
| `.sort(Sort)` | `UpdatedAtDesc` (the server default), `UpdatedAtAsc`, `CreatedAtDesc`, `CreatedAtAsc`, `AttemptsDesc`. |
| `.timeout(d)` / `.max_retries(n)` / `.cancellation_token(t)` | Per-call overrides. |

`get_with(id, &options)`, `status_with(&options)` and `health_with(&options)` take a [`RequestOptions`](#per-call-options) when you need per-call options on a single fetch rather than on a builder.

### Iterating

`iterate` walks every match page by page, oldest first (so email sent while you iterate does not shift pages):

```rust
use unsent::{EmailStatus, ListEmails, Unsent};

async fn failures(client: &Unsent) -> Result<(), unsent::Error> {
    let mut failed = client
        .emails()
        .iterate(ListEmails::new().status(EmailStatus::Failed).limit(100));
    while let Some(email) = failed.next().await {
        let email = email?; // the iterator yields Result<Email, Error>
        println!("{} {}", email.id, email.subject);
    }
    Ok(())
}
```

`EmailIter::next_page()` gives you `Result<Option<Vec<Email>>, Error>` when you want whole pages (for batching, say). The iterator finishes after an error and never yields an empty page. `iterate` forces the sort to `CreatedAtAsc` unless you set one, and starts at `ListEmails::offset` if you set it.

### Fields

`Email` (`Debug`, `Clone`, `PartialEq`, `Eq`):

| Field | Type | Notes |
|---|---|---|
| `id` | `i64` | |
| `status` | `EmailStatus` | `Queued` / `Sending` / `Sent` / `Failed`. |
| `to` | `Vec<String>` | |
| `cc`, `bcc` | `Option<Vec<String>>` | `None` when absent. |
| `subject` | `String` | |
| `html_body` | `String` | |
| `text_body` | `Option<String>` | `None` when the API only echoed the HTML body. |
| `from_email`, `from_name` | `Option<String>` | |
| `provider_id` | `Option<String>` | Requested at send time, if any. |
| `provider_used` | `Option<String>` | The provider that actually delivered it. |
| `failover_history` | `Vec<FailoverAttempt>` | `{ provider, kind, error, timestamp }`; malformed server data becomes an empty list. (`kind` is the provider type.) |
| `idempotency_key` | `Option<String>` | `None` when it was sent without one. |
| `attempts` | `u32` | Failed delivery attempts. |
| `error` | `Option<String>` | Last delivery error. |
| `created_at`, `updated_at` | `SystemTime` | UTC instants. |
| `attachments` | `Vec<AttachmentInfo>` | Metadata, plus content for `get`. |

`AttachmentInfo`: `filename: String`, `mime_type: Option<String>`, `size: u64` (decoded bytes), `content: Option<String>` (base64: `Some` from `get`, `None` from `list`), plus `bytes() -> Option<Result<Vec<u8>, Error>>` to decode it.

`EmailPage`: `emails: Vec<Email>`, `total: u64`, `limit: u64`, `offset: u64`, `has_more: bool` (true when `offset + emails.len() < total`).

`SendResult`: `id: i64`, `status: EmailStatus`, `idempotency_key: Option<String>`, `idempotent_replay: bool`, `target_provider: String`, `message: String`.

`QueueStatus`: `queued`, `sending`, `sent`, `failed`, all `u64`. `Health`: `status`, `runtime`, `d1` (`String`) and `timestamp` (`SystemTime`).

Enums: `EmailStatus` (`as_str`, `Display`, `FromStr`), `Sort` (`as_str`), and `Day`, which converts from `&str`, `String` or `SystemTime`.

Provider management (adding SMTP/Resend/SendGrid credentials) and deleting emails need an admin dashboard session and are intentionally not exposed through API keys.

## Error handling

Every failure is `unsent::Error`, a single `#[non_exhaustive]` enum with a stable `code()`. Branch on the variant or the code, not on the message. The variants hold `Box<ErrorInfo>` to keep the enum small; `err.info()` hands you the `&ErrorInfo`.

```rust
use unsent::{Error, SendEmail, Unsent};

async fn signup(client: &Unsent, email: &str) {
    let sent = client
        .emails()
        .send(SendEmail::builder().to(email).subject("Welcome").html("<p>Hi!</p>"))
        .await;

    match sent {
        Ok(receipt) => println!("queued as #{}", receipt.id),
        Err(e @ Error::Validation(_)) => {
            eprintln!("bad arguments, nothing was sent: {e}");
        }
        Err(e @ Error::Authentication(_)) => {
            eprintln!("{}: {}", e.code(), e.hint().unwrap_or("no hint"));
        }
        Err(e @ Error::Conflict(_)) => {
            eprintln!("key reused; email {:?} already exists", e.existing_email_id());
        }
        Err(e) if e.is_timeout() || e.is_aborted() => eprintln!("gave up: {e}"),
        Err(e) => {
            eprintln!("send failed: {e}"); // never contains your credentials
            if e.is_retryable() {
                eprintln!("(retrying later, Retry-After {:?})", e.retry_after());
            }
        }
    }
}
```

| Variant | When | Typical `code()` |
|---|---|---|
| `Error::Config` | Bad client options (nothing was sent) | `invalid_config`, `http_client_error`, `entropy_unavailable` |
| `Error::Validation` | Bad arguments caught before sending | `validation_error`, `invalid_idempotency_key`, `payload_too_large`, `attachment_read_error` |
| `Error::Connection` | No HTTP response (DNS, TLS, reset, offline) or the body was cut off | `connection_error` |
| `Error::Timeout` | A request exceeded its per-attempt timeout, or `wait` hit its deadline | `timeout` |
| `Error::Aborted` | The `CancellationToken` fired (dropping the future stops the work too, but then no error is observed) | `aborted` |
| `Error::Authentication` (401) | Wrong key or secret, clock skew, nonce problems | `invalid_api_key`, `invalid_signature`, `missing_signature`, `timestamp_skew`, `unauthorized`, `invalid_nonce`, `nonce_reused` |
| `Error::PermissionDenied` (403) | The endpoint needs an admin dashboard session | `forbidden` |
| `Error::NotFound` (404) | Unknown email id or route | `not_found` |
| `Error::Conflict` (409) | Idempotency key reused with different content | `idempotency_key_conflict` |
| `Error::RateLimited` (429) | Rate limited upstream | `rate_limited` |
| `Error::Server` (5xx) | Server failure (already retried) | `internal_error`, `server_misconfigured` |
| `Error::Request` (400, 413) | The server rejected the request contents | `validation_error`, `unauthorized_sender`, `payload_too_large` |
| `Error::Api` (other non-2xx) | Any status without a more specific variant (for example 402 or 405) | `http_<status>` |
| `Error::Protocol` | A redirect was refused, a 2xx body was not JSON, or a response was too large | `unexpected_redirect`, `invalid_response`, `response_too_large` |

Accessors on `Error`, valid for every variant (they return `None` when the information does not exist):

| Method | Returns |
|---|---|
| `code()` | Stable machine-readable code, e.g. `invalid_api_key`. Branch on this. |
| `message()` | The human-readable message, including the hint when there is one. |
| `status()` | `Option<u16>`, the HTTP status for errors that came from a response. |
| `reason()` | `Option<&str>`, the API's `reason` field. |
| `hint()` | `Option<&str>`, a suggested fix when the SDK knows one. |
| `body()` | `Option<&serde_json::Value>`, the parsed error body (or the raw text as a JSON string). |
| `existing_email_id()` | `Option<i64>`, the email a 409 conflict refers to. |
| `retry_after()` | `Option<Duration>`, the server's `Retry-After`, capped at 60 s. |
| `is_retryable()` | Whether repeating the call might succeed: connection and timeout errors, 408, 425, 429 and 5xx except 501, 505 and `server_misconfigured`. The SDK already retried where that was safe; this is for your own retry logic after it gave up. |
| `is_timeout()` | This is `Error::Timeout`. |
| `is_aborted()` | This is `Error::Aborted`. |
| `info()` | `&ErrorInfo`, if you want to reach the details directly. |

Hints are appended to the message and are also available from `hint()`. For example `invalid_signature` carries "Check that api_secret matches the API_SECRET secret of your Unsent deployment (no extra whitespace).", and `unauthorized_sender` explains that the `from` address or `provider_id` is not an active provider.

`Error` implements `std::error::Error`, so `?` works with `Box<dyn std::error::Error>`, `anyhow`, `eyre` and friends; the underlying transport failure is reachable through `std::error::Error::source`.

## Secrets never leak

- Both credentials are held in `unsent::Secret`, whose `Debug` prints `Secret(***)` and whose `Display` prints `***`. The value is only reachable through `Secret::expose()`, which the SDK calls internally.
- `Debug` for `Unsent` shows `api_key: "***"`, `api_secret: "***"` (or `"(none)"`), the base URL, the timeout and the retry count — and nothing else. `UnsentBuilder` does the same.
- API, validation and connection errors never contain the key or the secret, in the message, in any field or in `Debug` output.
- Text that comes *from the server* (error messages, reasons, redirect targets, transport details) is scrubbed: any occurrence of either credential of 8 characters or more is replaced with `***` before it reaches you.
- `Attachment`'s `Debug` prints the content length, not the content.

## Recipes

**axum** · [examples/axum_handler.rs](examples/axum_handler.rs). Build one client at startup, put it in your state and clone it per request (the client is `Clone + Send + Sync`).

```rust
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use unsent::{Error, SendEmail, Unsent};

#[derive(Clone)]
struct AppState {
    unsent: Unsent,
}

#[derive(Deserialize)]
struct Signup {
    email: String,
}

async fn signup(State(state): State<AppState>, Json(body): Json<Signup>) -> Response {
    let sent = state
        .unsent
        .emails()
        .send(
            SendEmail::builder()
                .to(body.email.clone())
                .subject("Welcome")
                .html("<p>Your account is ready.</p>")
                .idempotency_key(format!("welcome:{}", body.email)),
        )
        .await;

    match sent {
        Ok(receipt) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "id": receipt.id }))).into_response(),
        Err(Error::Validation(e)) => (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()).into_response(),
        Err(e) => {
            eprintln!("send failed: {e}"); // never contains your credentials
            (StatusCode::BAD_GATEWAY, "could not send".to_owned()).into_response()
        }
    }
}

fn router(unsent: Unsent) -> Router {
    Router::new()
        .route("/signup", post(signup))
        .with_state(AppState { unsent })
}
```

**actix-web.** The same shape: keep the client in `web::Data` and let the handler's own async block be dropped when the client disconnects.

```rust
use actix_web::{post, web, HttpResponse, Responder};
use unsent::{Error, SendEmail, Unsent};

struct AppState {
    unsent: Unsent,
}

#[derive(serde::Deserialize)]
struct Signup {
    email: String,
}

#[post("/signup")]
async fn signup(state: web::Data<AppState>, body: web::Json<Signup>) -> impl Responder {
    let sent = state
        .unsent
        .emails()
        .send(
            SendEmail::builder()
                .to(body.email.clone())
                .subject("Welcome")
                .html("<p>Your account is ready.</p>"),
        )
        .await;
    match sent {
        Ok(receipt) => HttpResponse::Accepted().json(serde_json::json!({ "id": receipt.id })),
        Err(Error::Validation(e)) => HttpResponse::UnprocessableEntity().body(e.to_string()),
        Err(e) => {
            eprintln!("send failed: {e}");
            HttpResponse::BadGateway().finish()
        }
    }
}

fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(signup);
}
// At startup: App::new().app_data(web::Data::new(AppState { unsent })).configure(configure)
```

**Other frameworks** (axum 0.8, actix-web 4, warp, poem, rocket). The SDK has no framework dependency: it only needs a `&Unsent` and gives you a `Future` you can await in any handler. Keep one client per process, not per request.

**Background jobs.** Use a stable key so your own queue redeliveries are deduplicated too:

```rust
use unsent::{Attachment, SendEmail, Unsent};

async fn receipt(client: &Unsent, invoice_id: u64, pdf: Vec<u8>) -> Result<(), unsent::Error> {
    client
        .emails()
        .send(
            SendEmail::builder()
                .to("customer@example.com")
                .subject(format!("Invoice {invoice_id}"))
                .html("<p>Your invoice is attached.</p>")
                .attachment(Attachment::from_bytes("invoice.pdf", pdf))
                .idempotency_key(format!("invoice-{invoice_id}:receipt")),
        )
        .await?;
    Ok(())
}
```

**Tests.** Inject a `Transport` instead of hitting the network. The SDK still signs, retries and maps responses around it, so what your transport records is byte-for-byte what a server would see:

```rust
use unsent::{BoxFuture, Transport, TransportError, TransportRequest, TransportResponse, Unsent};

struct Canned;

impl Transport for Canned {
    fn send<'a>(
        &'a self,
        request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
        Box::pin(async move {
            assert!(request.url.ends_with("/api/send"));
            assert!(request.header("X-Signature").is_some());
            Ok(TransportResponse::new(
                202,
                vec![("Content-Type".into(), "application/json".into())],
                r#"{"id":1,"status":"queued"}"#,
            ))
        })
    }
}

fn client() -> Result<Unsent, unsent::Error> {
    Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("test-key")
        .transport(Canned)
        .build()
}
```

[examples/custom_transport.rs](examples/custom_transport.rs) has the full version, including how to fake a 409 conflict and a connection reset. A custom transport must honour two rules: **never follow redirects** (return the 3xx as it is) and never read more than `unsent::MAX_RESPONSE_BYTES` (32 MiB). Dropping the returned future must cancel the request.

**Local development.** `http://localhost` and `http://127.0.0.1` base URLs are allowed for `wrangler dev`; any other `http://` URL is rejected so your key never travels in plain text. Redirects are never followed: the default `reqwest` client is built with `redirect::Policy::none()`, and one that is followed anyway is reported as `unexpected_redirect`.

## Client options

```rust
use std::time::Duration;
use unsent::Unsent;

fn client() -> Result<Unsent, unsent::Error> {
    Unsent::builder()
        .base_url("https://unsent.example.com") // default: $UNSENT_BASE_URL
        .api_key("key") // default: $UNSENT_API_KEY
        .api_secret("secret") // default: $UNSENT_API_SECRET
        .default_from("Acme <support@acme.com>") // used when a send has no `from`
        .default_provider_id("resend_main") // used when a send has no `provider_id`
        .timeout(Duration::from_secs(30)) // per attempt
        .max_retries(3) // 0 disables retries; max 10
        .no_env() // ignore the UNSENT_* variables entirely
        .build()
}
```

| Builder method | Default | Notes |
|---|---|---|
| `.base_url(s)` | `$UNSENT_BASE_URL` | Required. Normalized; must be `https://` (loopback excepted) with no embedded credentials. |
| `.api_key(s)` | `$UNSENT_API_KEY` | Required. Printable ASCII only. |
| `.api_secret(s)` | `$UNSENT_API_SECRET` | Optional. Needed for `signed`/`full` servers, harmless for `api-key-only`. |
| `.default_from(addr)` | none | `"Name <a@b.com>"`, `"a@b.com"`, `Address` or `(email, name)`. |
| `.default_provider_id(s)` | none | Used when a send has no `provider_id`. |
| `.timeout(Duration)` | 30 s | Per attempt; must be greater than zero. |
| `.max_retries(u32)` | 3 | Retries *after* the first attempt, 0 to 10. |
| `.transport(impl Transport)` | `reqwest` | A custom stack for tests, proxies or instrumentation. Wins over `.reqwest_client(..)`. |
| `.reqwest_client(reqwest::Client)` | built-in | Your own client (proxy, extra root certificates). Build it with `redirect(reqwest::redirect::Policy::none())`. |
| `.no_env()` | environment read | Use only what was set on the builder. |
| `.build()` | | Validates every option and returns `Error::Config` on a problem; sends nothing. |

`Unsent::from_env()` is `Unsent::builder().build()`, and `Unsent::from_vars(iter)` is the same with an explicit variable source. The client is cheap to clone: clones share one connection pool and one clock correction.

### Per-call options

`SendEmail`, `ListEmails` and `RequestOptions` carry the same three knobs (with identical builder methods), and `WaitOptions` carries the timeout, an interval and the token:

| Option | `SendEmail` / `ListEmails` | `RequestOptions` | `WaitOptions` |
|---|---|---|---|
| Per-attempt timeout | `.timeout(Duration)` | `.timeout(Duration)` | `.timeout(Duration)` — the overall deadline |
| Max retries (0-10) | `.max_retries(u32)` | `.max_retries(u32)` | — |
| Cancellation | `.cancellation_token(CancellationToken)` | `.cancellation_token(CancellationToken)` | `.cancellation_token(CancellationToken)` |
| Poll interval | — | — | `.interval(Duration)` (at least 100 ms) |

```rust
use std::time::Duration;
use unsent::{CancellationToken, RequestOptions, Unsent};

async fn fetch(client: &Unsent) -> Result<(), unsent::Error> {
    let token = CancellationToken::new();
    let email = client
        .emails()
        .get_with(
            42,
            &RequestOptions::new()
                .timeout(Duration::from_secs(5))
                .max_retries(0)
                .cancellation_token(token.clone()),
        )
        .await?;
    println!("{}", email.subject);
    Ok(())
}
```

`WaitOptions` has `.timeout(..)` (the deadline, not a per-attempt timeout), `.interval(..)` and `.cancellation_token(..)`; `RequestOptions::new()` starts with no overrides at all.

## Cancelling

A `CancellationToken` is a cheap, cloneable flag. Pass one to a call and `token.cancel()` from anywhere (another task, a signal handler, a shutdown hook) aborts it **immediately** — including while it sleeps between retries — with `Error::Aborted` (code `aborted`), and no further attempts are made. A token that is already cancelled prevents the request from starting at all.

Dropping the future is the other way to cancel: `drop(fut)`, or wrapping the call in `tokio::time::timeout(..)` / `select!`, stops all SDK work for that call as soon as it is dropped, because the future owns the in-flight request. Whether the server processed the request is unknowable at that point, which is exactly why keyed sends exist.

```rust
use std::time::Duration;
use unsent::{CancellationToken, Error, SendEmail, Unsent};

async fn send_with_deadline(client: &Unsent, email: SendEmail) -> Result<i64, Error> {
    let token = CancellationToken::new();
    let handle = tokio::spawn({
        let token = token.clone();
        async move {
            tokio::time::sleep(Duration::from_secs(10)).await;
            token.cancel();
        }
    });

    let result = client
        .emails()
        .send(email.cancellation_token(token.clone()))
        .await
        .map(|receipt| receipt.id);
    handle.abort();
    result
}
```

See [examples/cancel.rs](examples/cancel.rs).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `invalid_api_key` | `api_key` must equal the server's `API_KEY`. Check for stray whitespace or a different environment's key. |
| `invalid_signature` | `api_secret` must equal the server's `API_SECRET` (no extra whitespace). |
| `timestamp_skew` with a secret set | The local clock is off by more than 3 minutes. The SDK corrects for this automatically; if it still fails, sync the clock (NTP). |
| `timestamp_skew` / `missing_signature` without a secret | The server requires signed requests. Set `UNSENT_API_SECRET`. |
| `unauthorized_sender` | The `from` address (or `provider_id`) is not an active provider in the dashboard. Add it there, or omit `from`. |
| `invalid_response` | `base_url` is not pointing at an Unsent deployment (you got HTML instead of JSON). |
| `unexpected_redirect` | The URL redirects (http to https, or a trailing path). Set `base_url` to the final URL; the SDK never follows redirects because that would forward your API key to another host. |
| `connection_error` ("Could not reach ...") | DNS, TLS or network problem. The cause is in `std::error::Error::source`. |
| `payload_too_large` | The request exceeds 3 MiB, or (server-side) body plus attachments exceed about 1.9 MB encoded. Shrink the attachments. |
| `invalid_config`: "base_url uses plain http://" | Use `https://`; plain http is only allowed for loopback hosts. |
| `invalid_config`: "Missing api_key" | The variable is unset or empty and no `.api_key(..)` was given — or `.no_env()` was called. |
| `timeout` from `wait` | Delivery took longer than the deadline. Increase `WaitOptions::timeout`, or `get` the email to inspect `attempts` and `error`. |
| `aborted` | Something cancelled the call. Do not reuse a `CancellationToken` you have already cancelled. |

## Compatibility

Rust 1.89 or newer, edition 2021. Async on tokio, HTTP on `reqwest` with `rustls` — no OpenSSL, no C toolchain. `#![forbid(unsafe_code)]` (and `#![deny(missing_docs)]`) inside the crate. The client is `Send + Sync`; `reqwest`'s connection pool is shared across clones, so reuse one client.

## Development

```bash
cargo build --examples                      # every example compiles
cargo test                                  # unit, property/fuzz seeds, hostile server, security (e2e skipped)
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

The end-to-end suite in `tests/e2e.rs` runs against a real local worker plus an SMTP sink and is skipped (it returns early) unless `UNSENT_E2E_BASE_URL` is set:

```bash
# from the repository root
eval "$(scripts/e2e-server.sh start 8814)"      # exports UNSENT_E2E_* (set E2E_ROOT to move the state directory)
(cd sdk-rust && cargo test --test e2e)
scripts/e2e-server.sh stop 8814

scripts/e2e-server.sh start 8814 signed         # or: api-key-only
scripts/e2e-server.sh mails 8814                # what the SMTP sink received
```

All three `SECURITY_MODE`s are exercised (`UNSENT_E2E_MODE` is exported by the script). The credentials are fixed test values, only `noreply@e2e.test` is an authorized sender, and nothing is delivered anywhere but the local sink.

The examples are runnable as they are: `cargo run --example custom_transport`, `--example errors`, `--example cancel`, `--example axum_handler` and `--example attachments` need no server, while `basic` and `list_and_iterate` exit early with a note when `UNSENT_BASE_URL` is unset.
