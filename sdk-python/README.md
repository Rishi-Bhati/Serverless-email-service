# unsent-sdk (Python)

Official Python SDK for your self-hosted [Unsent](../README.md) email service.

- **A few lines to send.** No HMAC code, nonces, timestamps or base64 to write yourself.
- **Safe retries.** Every send carries an idempotency key, so network errors and 5xx responses are retried automatically without ever sending the same email twice.
- **Zero dependencies.** Standard library only, Python 3.9+. Sync **and** `asyncio` clients.
- **Batteries included.** A Django `EMAIL_BACKEND` and FastAPI helpers, fully type-annotated (`py.typed`).

```python
from unsent import Unsent

unsent = Unsent()  # reads UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET

unsent.send(
    to="customer@example.com",
    subject="Welcome!",
    html="<h1>Hello</h1><p>Your account is ready.</p>",
)
```

## Install

```bash
pip install unsent-sdk                 # core, no dependencies
pip install "unsent-sdk[django]"       # + the Django email backend
pip install "unsent-sdk[fastapi]"      # + the FastAPI helpers
```

The distribution is `unsent-sdk`; the import name is `unsent`. Python 3.9 or newer.

## Set up credentials

You need three values from your Unsent deployment. Sign in to the dashboard as an administrator and open the **API Docs** tab, which fills in your real keys, or use the secrets you deployed:

| Environment variable | Value |
|---|---|
| `UNSENT_BASE_URL` | Your deployment URL, e.g. `https://unsent.example.com` |
| `UNSENT_API_KEY` | The `API_KEY` secret |
| `UNSENT_API_SECRET` | The `API_SECRET` secret |

Empty variables count as unset. Or pass them explicitly (explicit options win over the environment):

```python
import os
from unsent import Unsent

unsent = Unsent(
    base_url="https://unsent.example.com",
    api_key=os.environ["MY_KEY"],
    api_secret=os.environ["MY_SECRET"],
)
```

`api_secret` signs requests. It is required unless your server runs with `SECURITY_MODE=api-key-only`, and it is safe to pass in every mode: the SDK works with `api-key-only`, `signed` and `full` servers without any configuration.

`Unsent.from_env(mapping)` builds a client from any mapping instead of the process environment, e.g. `Unsent.from_env(os.environ)` or a dictionary of secrets.

> **Keep these on the server.** Anyone holding the API secret can send email as you. The SDK never prints them: `repr()`, exceptions, their `__cause__` chains and log lines all keep them out of sight.

Credentials must be printable ASCII (leading and trailing whitespace is trimmed); anything else is an `UnsentConfigError`. `base_url` must be `https://` (`http://` is accepted only for `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`) and must not embed credentials.

## Sending email

```python
from unsent import attachment_from_file

result = unsent.send(
    from_={"email": "support@acme.com", "name": "Acme Support"},  # optional; must be a configured sender
    to=["a@example.com", "b@example.com"],
    cc="manager@example.com",
    bcc=["audit@example.com"],
    subject="Your order has shipped",
    html="<p>It is on its way.</p>",
    text="It is on its way.",             # optional plain-text version
    attachments=[attachment_from_file("./invoice.pdf")],
    provider_id="resend_marketing",       # optional: force a specific provider
    idempotency_key="order-8492:shipped", # optional, see below
)
# result.id, result.status ("queued"), result.idempotent_replay, result.target_provider
```

`from` is spelled `from_` because `from` is a Python keyword. `unsent.emails.send(...)` is the same method as `unsent.send(...)`.

| Argument | Type | Notes |
|---|---|---|
| `to` | `str \| Sequence[str]` | Required. Up to 100 addresses per field, each containing `@`, no line breaks. |
| `cc`, `bcc` | `str \| Sequence[str]` | Optional. |
| `subject` | `str` | Required, up to 1000 characters. |
| `html` / `text` | `str` | Provide at least one. A text-only send gets an HTML body derived from the text automatically (the API requires HTML). |
| `from_` | `str \| Mapping` | `"Name <a@b.co>"`, `"a@b.co"` or `{"email": ..., "name": ...}`. Omit to use the client's `default_from` / your default provider. |
| `provider_id` | `str` | Route through one provider. Falls back to `default_provider_id`. |
| `attachments` | `Sequence[Attachment \| Mapping]` | Up to 20. See below. |
| `idempotency_key` | `str \| bool \| None` | `None` means "generate one"; `False` disables idempotency (and retries); see below. |
| `timeout` | `float` | Per-attempt timeout in seconds, overriding the client default (30). |
| `max_retries` | `int` | 0-10, overriding the client default (3). |
| `cancel` | `CancelToken` | Abort the call, including between retries. |

Everything is validated **before any network I/O**; invalid input raises `UnsentValidationError` and nothing is sent. The whole request body is limited to 3 MiB (`payload_too_large`).

`send()` returns as soon as Unsent has **accepted** the email (HTTP 202). Delivery happens in the background, with automatic failover across your providers.

### Waiting for delivery

```python
result = unsent.send(to="customer@example.com", subject="Invoice", html="<p>Attached.</p>")
email = unsent.emails.wait(result.id, timeout=60, interval=1)  # polls until final

if email.status == "sent":
    print("delivered via", email.provider_used)
else:
    print("failed:", email.error, email.failover_history)
```

`wait` returns once the email is `sent`, or `failed` after the service has used up its delivery attempts (`MAX_DELIVERY_ATTEMPTS`, 3). A permanent failure is a normal return value, not an exception. The poll interval starts at `interval` and grows by 1.5x up to 5 s; `timeout` (default 60 s) raises `UnsentTimeoutError`.

### Attachments

```python
from unsent import Attachment, attachment_from_file

invoice = attachment_from_file("./invoice.pdf")  # filename and MIME type from the path

unsent.send(
    to="customer@example.com", subject="Invoice", html="<p>Attached.</p>",
    attachments=[
        invoice,
        Attachment(filename="report.csv", content=csv_bytes, content_type="text/csv"),  # raw bytes
        {"filename": "photo.jpg", "content": open("photo.jpg", "rb"), "content_type": "image/jpeg"},  # file object
        {"filename": "pre.bin", "content": "AAECAw=="},  # already base64
        {"filename": "notes.txt", "content": b"plain text"},  # bytes are encoded for you
    ],
)
```

A `content` that is `str` is treated as **already base64-encoded** (and validated). Pass `bytes`, `bytearray`, `memoryview` or a binary file object and the SDK encodes it. Plain `dict`s with the same keys (`filename`, `content`, `content_type` / `mime_type`) work too.

The service stores the body and attachments together in one database row, so keep the total under about **1.4 MB of raw attachment data**. Larger emails are rejected with a `413 payload_too_large`.

### Idempotency and retries

Network blips and 5xx responses are retried up to `max_retries` times (default 3) with exponential backoff (500 ms doubling to 8 s, jittered), honoring `Retry-After` (seconds or HTTP date, capped at 60 s). Retries are safe because every send carries an idempotency key:

- By default the SDK generates a UUID per `send()` call and reuses it across that call's retries. A request that actually succeeded but whose response was lost is recognised on retry (`result.idempotent_replay == True`).
- Pass your **own** key (e.g. `order-8492:shipped`) to also deduplicate across calls, processes and your own job retries. The same key with the same message returns the original email (kept for 24 hours by default); the same key with a *different* message raises `UnsentConflictError` with `existing_email_id`.
- Pass `idempotency_key=False` to opt out. The SDK then never retries that send.

Keys are 1 to 255 printable ASCII characters without spaces.

What is retried: network errors, per-attempt timeouts, HTTP 408, 425, 429 and 5xx (except 501, 505 and `server_misconfigured`). Never retried: other 4xx, redirects, cancellation. Every attempt gets a fresh timestamp and nonce.

The SDK also corrects a skewed local clock: on a `timestamp_skew` response it learns the server time (from the `Date` header, or `GET /api/health`), stores the offset for later signatures and retries immediately, once per call.

### Cancellation

```python
from unsent import CancelToken, UnsentConnectionError

token = CancelToken()
# ... from another thread or a signal handler:
token.cancel()

try:
    unsent.send(to="a@b.co", subject="s", text="t", cancel=token)
except UnsentConnectionError as err:  # code == "aborted"
    ...
```

Cancelling closes the in-flight socket, so the abort is prompt instead of waiting for the server.

## Inspecting emails

```python
email = unsent.emails.get(1234)  # includes attachment content (base64); email.attachments[0].to_bytes()
page = unsent.emails.list(status="failed", search="invoice", from_="2026-01-01", limit=50)
# page.emails, page.total, page.has_more

status = unsent.status()  # QueueStatus; also verifies your credentials
health = unsent.health()  # public liveness probe (does not verify credentials)
```

`list` filters: `limit` 1-200, `offset` ≥ 0, `status` one of `queued | sending | sent | failed`, `search` (matches subject, recipients, sender, provider, body and error text), `from_` / `to` (a `date`/`datetime` or `YYYY-MM-DD`, UTC day bounds) and `sort` one of `updated_at_desc | updated_at_asc | created_at_desc | created_at_asc | attempts_desc`. The status and sort values are validated client-side.

### Iterating

`iterate` fetches pages as needed, oldest first (so mail sent while you iterate does not shift pages):

```python
for email in unsent.emails.iterate(status="failed"):
    print(email.id, email.subject)
```

### Async

`AsyncUnsent` mirrors the sync client exactly — await every call, and `iterate` is an async iterator:

```python
import asyncio
from unsent import AsyncUnsent

async def main():
    async with AsyncUnsent() as unsent:          # or await unsent.aclose()
        result = await unsent.send(to="a@b.co", subject="Hi", text="Hello")
        email = await unsent.emails.wait(result.id, timeout=30)
        async for row in unsent.emails.iterate(status="failed"):
            print(row.id)

asyncio.run(main())
```

The stdlib transport is blocking, so each HTTP attempt runs in a worker thread. Cancellation is still real: cancelling the awaiting task (or `asyncio.timeout` / `wait_for`) closes the in-flight socket, and `asyncio.CancelledError` always propagates unchanged.

Times are `datetime` objects in UTC. Fields the API can leave empty (`text_body`, `provider_used`, `error`, ...) are `None`.

Provider management (adding SMTP/Resend/SendGrid credentials) and deleting emails need an admin dashboard session and are intentionally not exposed through API keys.

## Django

```python
# settings.py
EMAIL_BACKEND = "unsent.django.UnsentEmailBackend"
UNSENT_BASE_URL = "https://unsent.example.com"
UNSENT_API_KEY = "..."
UNSENT_API_SECRET = "..."
# optional
UNSENT_TIMEOUT = 30
UNSENT_MAX_RETRIES = 3
UNSENT_DEFAULT_PROVIDER_ID = None
UNSENT_OMIT_FROM = False   # True: never send a "from"; the service's default provider decides
```

Then `send_mail()`, `EmailMessage` and `EmailMultiAlternatives` work unchanged:

```python
from django.core.mail import EmailMultiAlternatives, send_mail

send_mail("Subject", "Plain body", "from@acme.com", ["to@example.com"])

msg = EmailMultiAlternatives("Receipt", "Plain body", "support@acme.com", ["to@example.com"])
msg.attach_alternative("<h1>Receipt</h1>", "text/html")
msg.attach("invoice.pdf", pdf_bytes, "application/pdf")
msg.send()
```

Mapped: to/cc/bcc, the HTML and plain-text parts, attachments (tuples, MIME objects and file objects), `from_email`, and `fail_silently`. Per-message `extra_headers` `X-Unsent-Idempotency-Key` and `X-Unsent-Provider-Id` set the idempotency key and provider. After a successful send the `SendEmailResult` is on `message.unsent_result`. Errors propagate as `UnsentError` subclasses; configuration problems as Django's `ImproperlyConfigured`.

Django 6.1+ `MAILERS` work too: `"OPTIONS": {"base_url": ..., "api_key": ..., "api_secret": ...}`.

## FastAPI

```python
from fastapi import FastAPI
from unsent.fastapi import UnsentDep, lifespan

app = FastAPI(lifespan=lifespan())   # reads UNSENT_BASE_URL / UNSENT_API_KEY / UNSENT_API_SECRET

@app.post("/welcome")
async def welcome(email: str, unsent: UnsentDep):
    result = await unsent.send(to=email, subject="Welcome", text="Hi!")
    return {"id": result.id}
```

`lifespan()` creates one `AsyncUnsent`, stores it on `app.state.unsent` and closes it on shutdown. Use `unsent_lifespan(app)` inside your own lifespan instead. `add_exception_handlers(app)` maps `UnsentError` to JSON responses (422 validation, 409 idempotency conflicts, 504 timeouts, 502 otherwise).

## Flask

```python
from flask import Flask, request
from unsent import Unsent

app = Flask(__name__)
unsent = Unsent()  # module level: one client, shared (thread-safe)

@app.post("/welcome")
def welcome():
    email = request.form["email"]
    result = unsent.send(to=email, subject="Welcome", text="Hi!",
                         idempotency_key=f"welcome:{email}")
    return {"id": result.id}, 202
```

## Background jobs

Use a stable key so your own queue redeliveries are deduplicated too:

```python
unsent.send(to=user.email, subject="Your invoice", html=invoice_html,
            idempotency_key=f"invoice-{invoice_id}:email")
```

## Error handling

Every failure is an `UnsentError` subclass, each carrying a stable `code`. Branch on the type or code, not on the message.

```python
from unsent import UnsentAPIError, UnsentConflictError, UnsentValidationError

try:
    unsent.send(to="a@b.co", subject="s", text="t")
except UnsentValidationError:      # bad arguments, nothing was sent
    raise
except UnsentConflictError as err: # err.existing_email_id
    ...
except UnsentAPIError as err:      # err.status, err.code, err.reason, err.hint, err.body
    ...
```

| Exception | When | Typical `code` |
|---|---|---|
| `UnsentConfigError` | Bad client options (nothing was sent) | `invalid_config` |
| `UnsentValidationError` | Bad arguments caught before sending | `validation_error`, `invalid_idempotency_key`, `payload_too_large` |
| `UnsentAuthenticationError` (401) | Wrong key or secret, clock skew | `invalid_api_key`, `invalid_signature`, `missing_signature`, `timestamp_skew` |
| `UnsentRequestError` (400, 413) | The server rejected the request | `validation_error`, `unauthorized_sender`, `payload_too_large` |
| `UnsentConflictError` (409) | Idempotency key reused with different content | `idempotency_key_conflict` |
| `UnsentNotFoundError` (404) | Unknown email id | `not_found` |
| `UnsentPermissionError` (403) | Endpoint needs an admin session | `forbidden` |
| `UnsentRateLimitError` (429) | Rate limited upstream | `rate_limited` |
| `UnsentServerError` (5xx) | Server failure (already retried) | `internal_error`, `server_misconfigured` |
| `UnsentTimeoutError` | A request or `wait` timed out | `timeout` |
| `UnsentConnectionError` | No HTTP response (DNS, TLS, reset); also `aborted` | `connection_error`, `aborted` |

All of them expose `code`, `reason`, `hint` and `cause`; `UnsentAPIError` adds `status`, `body` and `existing_email_id`. Messages include a fix hint where the SDK knows one, for example "Check that api_secret matches the API_SECRET secret of your Unsent deployment".

## Client options

```python
Unsent(
    base_url=None,              # default: $UNSENT_BASE_URL
    api_key=None,               # default: $UNSENT_API_KEY
    api_secret=None,            # default: $UNSENT_API_SECRET
    default_from=None,          # used when send() has no from_
    default_provider_id=None,   # used when send() has no provider_id
    timeout=None,               # per attempt, seconds (default 30)
    max_retries=None,           # 0-10 (default 3)
    transport=None,             # custom sync Transport (tests, proxies, instrumentation)
)
```

The sync client is thread-safe: create one and share it. It is also a context manager. `AsyncUnsent` accepts the same options plus an `AsyncTransport`.

**Tests.** Inject a transport instead of hitting the network:

```python
from unsent import TransportResponse

class Fake:
    def __init__(self):
        self.requests = []

    def send(self, request):
        self.requests.append(request)
        return TransportResponse(
            status=202,
            headers={"content-type": "application/json"},
            body=b'{"id":1,"status":"queued"}',
        )

fake = Fake()
client = Unsent(base_url="https://unsent.test", api_key="k", transport=fake)
```

A transport must honor `request.timeout`, must **not follow redirects**, and should stop promptly when `request.cancel` is cancelled.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `invalid_api_key` | `api_key` must equal the server's `API_KEY`. Check for stray whitespace or a different environment's key. |
| `invalid_signature` | `api_secret` must equal the server's `API_SECRET`. |
| `timestamp_skew` with a secret set | Your clock is off by more than 3 minutes. The SDK corrects for this automatically; if it still fails, sync your clock (NTP). |
| `timestamp_skew` / `missing_signature` without a secret | The server requires signed requests. Set `UNSENT_API_SECRET`. |
| `unauthorized_sender` | The `from_` address is not an active provider in the dashboard. Add it there, or omit `from_`. |
| `invalid_response` | `base_url` is not pointing at an Unsent deployment (got HTML instead of JSON). |
| `unexpected_redirect` | The URL redirects (http to https, or a trailing path). Set `base_url` to the final URL; the SDK never follows redirects because that would forward your API key to another host. |
| `Could not reach ...` | DNS, TLS or network problem. The original exception is on `err.__cause__`. |
| `payload_too_large` | The request exceeds 3 MiB, or (server-side) body plus attachments exceed about 1.9 MB encoded. |
| `UnsentConfigError: base_url uses plain http://` | Use `https://`; plain http is only allowed for localhost. |

## Compatibility

Python 3.9 or newer, standard library only. The Django and FastAPI helpers are optional extras; importing `unsent` itself never imports Django or FastAPI. Fully type-annotated (`py.typed`).

## Development

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest -q                      # unit, fuzz, security, Django/FastAPI integrations (live tests skipped)
mypy --strict src/unsent       # types

# live end-to-end tests against a local worker + SMTP sink (from the repository root)
eval "$(scripts/e2e-server.sh start 8811)"
pytest tests/e2e -q
scripts/e2e-server.sh stop 8811
```
