# unsent (Ruby)

Official Ruby SDK for your self-hosted [Unsent](../README.md) email service.

- **A few lines to send.** No HMAC code, nonces, timestamps or base64 to write yourself.
- **Safe retries.** Every send carries an idempotency key, so network errors and 5xx responses are retried automatically without ever sending the same email twice.
- **Zero dependencies.** Standard library only, Ruby 3.1+. Thread-safe.
- **Rails-ready.** An ActionMailer delivery method, so existing mailers work unchanged.

```ruby
require 'unsent'

client = Unsent::Client.new # reads UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET

client.send_email(
  to: 'customer@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello</h1><p>Your account is ready.</p>'
)
```

## Install

```ruby
# Gemfile
gem 'unsent-sdk'
```

```bash
gem install unsent-sdk     # or: bundle add unsent-sdk
```

The gem is `unsent-sdk`; the require name is `unsent`. Ruby 3.1 or newer.

## Set up credentials

You need three values from your Unsent deployment. Sign in to the dashboard as an administrator and open the **API Docs** tab, which fills in your real keys, or use the secrets you deployed:

| Environment variable | Value |
|---|---|
| `UNSENT_BASE_URL` | Your deployment URL, e.g. `https://unsent.example.com` |
| `UNSENT_API_KEY` | The `API_KEY` secret |
| `UNSENT_API_SECRET` | The `API_SECRET` secret |

Empty variables count as unset. Or pass them explicitly (explicit options win over the environment):

```ruby
client = Unsent::Client.new(
  base_url: 'https://unsent.example.com',
  api_key: ENV.fetch('MY_KEY'),
  api_secret: ENV.fetch('MY_SECRET')
)
```

`api_secret` signs requests. It is required unless your server runs with `SECURITY_MODE=api-key-only`, and it is safe to pass in every mode: the SDK works with `api-key-only`, `signed` and `full` servers without any configuration.

`Unsent::Client.from_env(env)` builds a client from any `#[]`-like object instead of `ENV`, e.g. `Unsent::Client.from_env(Rails.application.credentials)`.

> **Keep these on the server.** Anyone holding the API secret can send email as you. The SDK never prints them: `inspect`, `to_s`, `pp`, `puts`, `to_json` and error messages all keep them out of sight.

Credentials must be printable ASCII (leading and trailing whitespace is trimmed); anything else is an `Unsent::ConfigError`. `base_url` must be `https://` (`http://` is accepted only for `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`) and must not embed credentials.

## Sending email

```ruby
result = client.send_email(
  from: 'Acme Support <support@acme.com>',   # optional; must be a sender configured in your dashboard
  to: ['a@example.com', 'b@example.com'],
  cc: 'manager@example.com',
  bcc: ['audit@example.com'],
  subject: 'Your order has shipped',
  html: '<p>It is on its way.</p>',
  text: 'It is on its way.',                 # optional plain-text version
  provider_id: 'resend_marketing',           # optional: force a specific provider
  idempotency_key: 'order-8492:shipped'      # optional, see below
)
# result.id, result.status ("queued"), result.idempotent_replay?, result.target_provider
```

`client.emails.send_email(...)` is the same method. `client.deliver(...)` is an alias.

| Option | Type | Notes |
|---|---|---|
| `to` | `String, Array<String>` | Required. Up to 100 addresses per field, each containing `@`, no line breaks. |
| `cc`, `bcc` | `String, Array<String>` | Optional. |
| `subject` | `String` | Required, up to 1000 characters. |
| `html` / `text` | `String` | Provide at least one. A text-only send gets an HTML body derived from the text automatically (the API requires HTML). |
| `from` | `String, Hash` | `"Name <a@b.co>"`, `"a@b.co"` or `{ email:, name: }`. Omit to use the client's `default_from` / your default provider. |
| `provider_id` | `String` | Route through one provider. Falls back to `default_provider_id`. |
| `attachments` | `Array<Hash>` | Up to 20. See below. |
| `idempotency_key` | `String, false` | `nil` means "generate one"; `false` disables idempotency (and retries); see below. |
| `timeout` | `Numeric` | Per-attempt timeout in seconds, overriding the client default (30). |
| `max_retries` | `Integer` | 0-10, overriding the client default (3). |
| `cancel` | `Unsent::CancelToken` | Abort the call, including between retries. |

Everything is validated **before any network I/O**; invalid input raises `Unsent::ValidationError` and nothing is sent. The whole request body is limited to 3 MiB (`payload_too_large`).

`send_email` returns as soon as Unsent has **accepted** the email (HTTP 202). Delivery happens in the background, with automatic failover across your providers.

### Waiting for delivery

```ruby
result = client.send_email(to: 'customer@example.com', subject: 'Invoice', html: '<p>Attached.</p>')
email = client.emails.wait(result.id, timeout: 60, interval: 1) # polls until final

if email.sent?
  puts "delivered via #{email.provider_used}"
else
  puts "failed: #{email.error} #{email.failover_history}"
end
```

`wait` returns once the email is `sent`, or `failed` after the service has used up its delivery attempts (`Unsent::MAX_DELIVERY_ATTEMPTS`, 3). A permanent failure is a normal return value, not an exception. The poll interval starts at `interval` (default 1 s) and grows by 1.5x up to 5 s; `timeout` (default 60 s) raises `Unsent::TimeoutError`.

The result responds to `sent?`, `queued?`, `sending?`, `failed?` and `final?`.

### Attachments

```ruby
invoice = Unsent::Attachment.from_file('./invoice.pdf') # name and MIME type from the path

client.send_email(
  to: 'customer@example.com', subject: 'Invoice', html: '<p>Attached.</p>',
  attachments: [
    invoice,
    { filename: 'report.csv', content: csv_bytes, content_type: 'text/csv' },  # binary String: raw bytes
    { filename: 'photo.jpg', content: File.open('photo.jpg', 'rb') },          # any IO-like object
    { filename: 'pre.bin', content: 'AAECAw==' },                              # UTF-8 String: already base64
  ]
)
```

`content` is one of:

- a **binary** `String` (`ASCII-8BIT`, e.g. from `File.binread`, `String#b`, or a decoded mail part) — raw bytes, encoded for you;
- any other `String` — treated as **already base64-encoded** and validated;
- an IO-like object responding to `read` (`File`, `StringIO`, `Tempfile`, ...) — its remaining bytes.

The service stores the body and attachments together in one database row, so keep the total under about **1.4 MB of raw attachment data**. Larger emails are rejected with a `413 payload_too_large`.

### Idempotency and retries

Network blips and 5xx responses are retried up to `max_retries` times (default 3) with exponential backoff (500 ms doubling to 8 s, jittered), honoring `Retry-After` (seconds or HTTP date, capped at 60 s). Retries are safe because every send carries an idempotency key:

- By default the SDK generates a UUID per `send_email` call and reuses it across that call's retries. A request that actually succeeded but whose response was lost is recognised on retry (`result.idempotent_replay?`).
- Pass your **own** key (e.g. `'order-8492:shipped'`) to also deduplicate across calls, processes and your own job retries. The same key with the same message returns the original email (kept for 24 hours by default); the same key with a *different* message raises `Unsent::ConflictError` with `existing_email_id`.
- Pass `idempotency_key: false` to opt out. The SDK then never retries that send.

Keys are 1 to 255 printable ASCII characters without spaces.

What is retried: network errors, per-attempt timeouts, HTTP 408, 425, 429 and 5xx (except 501, 505 and `server_misconfigured`). Never retried: other 4xx, redirects, cancellation. Every attempt gets a fresh timestamp and nonce.

The SDK also corrects a skewed local clock: on a `timestamp_skew` response it learns the server time (from the `Date` header, or `GET /api/health`), stores the offset for later signatures and retries immediately, once per call.

### Cancellation

```ruby
token = Unsent::CancelToken.new

Thread.new do
  sleep 0.5
  token.cancel # from any thread, a signal handler, a job timeout...
end

begin
  client.send_email(to: 'a@b.co', subject: 's', text: 't', cancel: token)
rescue Unsent::ConnectionError => e # e.code == 'aborted'
  puts 'gave up early'
end
```

Cancelling closes the in-flight socket, so the abort is prompt instead of waiting for the server.

## Inspecting emails

```ruby
email = client.emails.get(1234) # includes attachment content (base64); email.attachments[0].data
page  = client.emails.list(status: :failed, search: 'invoice', from: Date.new(2026, 1, 1), limit: 50)
# page.emails, page.total, page.has_more?, page.each { |e| ... }

status = client.status # QueueStatus(queued:, sending:, sent:, failed:); also verifies your credentials
health = client.health # public liveness probe (does not verify credentials); health.ok?
```

`list` filters: `limit` 1-200, `offset` >= 0, `status` one of `:queued, :sending, :sent, :failed`, `search` (matches subject, recipients, sender, provider, body and error text, up to 500 characters), `from` / `to` (a `Date`/`Time`/`DateTime` or `YYYY-MM-DD`, UTC day bounds) and `sort` one of `updated_at_desc, updated_at_asc, created_at_desc, created_at_asc, attempts_desc`. Status and sort are validated client-side; symbols are accepted.

### Iterating

`each` fetches pages as needed, oldest first (so mail sent while you iterate does not shift pages). Without a block it returns a lazy `Enumerator`:

```ruby
client.emails.each(status: :failed).first(10)

client.emails.each(search: 'invoice') { |email| puts "#{email.id} #{email.subject}" }
```

`client.emails.iterate` is an alias.

Times are `Time` objects in UTC. Fields the API can leave empty (`text_body`, `provider_used`, `error`, ...) are `nil`.

Provider management (adding SMTP/Resend/SendGrid credentials) and deleting emails need an admin dashboard session and are intentionally not exposed through API keys.

## Rails (ActionMailer)

Register the delivery method and all your existing mailers work unchanged:

```ruby
# config/environments/production.rb
config.action_mailer.delivery_method = :unsent
config.action_mailer.unsent_settings = {
  base_url: ENV.fetch('UNSENT_BASE_URL'),
  api_key: ENV.fetch('UNSENT_API_KEY'),
  api_secret: ENV.fetch('UNSENT_API_SECRET') # omit for an api-key-only server
}
config.action_mailer.raise_delivery_errors = true
```

With an empty settings Hash the `UNSENT_*` environment variables are used. The settings accept every `Unsent::Client` option, plus `client:` to hand over a ready-made `Unsent::Client`.

```ruby
class UserMailer < ApplicationMailer
  def welcome(user)
    mail(to: user.email, from: 'Acme Support <support@acme.com>', subject: 'Welcome!') do |format|
      format.text { render plain: 'Hello!' }
      format.html { render html: '<h1>Hello!</h1>'.html_safe }
    end
  end
end
```

What is mapped: from (with display name), to / cc / bcc, subject, the HTML and plain-text parts (single part or `multipart/alternative`, also inside `multipart/mixed`) and attachments (inline ones too, sent as regular attachments).

Per-message headers select a provider and an idempotency key:

```ruby
headers['X-Idempotency-Key'] = "welcome:#{user.id}"
headers['provider_id'] = 'resend_marketing'
```

`X-Provider-Id` / `X-Unsent-Provider-Id` and `Idempotency-Key` / `X-Unsent-Idempotency-Key` work too. Everything else (reply-to, arbitrary custom headers, recipient display names) is not supported by the Unsent API and is dropped.

See [`examples/rails_action_mailer.md`](examples/rails_action_mailer.md) for the full recipe.

## Recipes

**Sinatra** · [examples/sinatra.rb](examples/sinatra.rb)

```ruby
require 'sinatra/base'
require 'unsent'

class App < Sinatra::Base
  CLIENT = Unsent::Client.new # one client for the process: thread-safe

  post '/signup' do
    email = params['email'].to_s
    CLIENT.send_email(to: email, subject: 'Welcome', html: '<p>Hi!</p>',
                      idempotency_key: "welcome:#{email}")
    status 202
  end
end
```

**Plain service object.** Build one client at boot and inject it:

```ruby
class WelcomeMailer
  def initialize(client = Unsent::Client.new)
    @client = client
  end

  def call(user)
    @client.send_email(to: user.email, subject: 'Welcome', html: '<p>Hi!</p>',
                       idempotency_key: "welcome:#{user.id}")
  end
end
```

**Background jobs (Sidekiq, ActiveJob, ...).** Use a stable key so redeliveries are deduplicated too:

```ruby
client.send_email(to: user.email, subject: 'Your invoice', html: invoice_html,
                  idempotency_key: "invoice-#{invoice.id}:email")
```

**Tests.** Inject a transport instead of hitting the network:

```ruby
fake = Class.new do
  attr_reader :requests

  def initialize = @requests = []

  def call(request)
    @requests << request
    Unsent::Transport::Response.new(status: 202, headers: { 'Content-Type' => 'application/json' },
                                    body: '{"id":1,"status":"queued"}')
  end
end.new

client = Unsent::Client.new(base_url: 'https://unsent.test', api_key: 'k', transport: fake)
```

A transport responds to `call(request)` and returns an `Unsent::Transport::Response` (`status`, `headers`, `body`). It must honor the request's timeout and must **not follow redirects**.

**Local development.** `http://localhost` and `http://127.0.0.1` base URLs are allowed for `wrangler dev`; any other `http://` URL is rejected so your key never travels in plain text.

## Error handling

Every failure is an `Unsent::Error` subclass, each carrying a stable `code`. Branch on the type or code, not on the message.

```ruby
begin
  client.send_email(to: 'a@b.co', subject: 's', text: 't')
rescue Unsent::ValidationError              # bad arguments, nothing was sent
  raise
rescue Unsent::ConflictError => e           # e.existing_email_id
  puts "already sent as ##{e.existing_email_id}"
rescue Unsent::APIError => e                # e.status, e.code, e.reason, e.hint, e.body
  puts "#{e.status} #{e.code}: #{e.message}"
rescue Unsent::Error => e                   # everything else the SDK raises
  puts "#{e.code} #{e.message}"
end
```

| Class | When | Typical `code` |
|---|---|---|
| `Unsent::ConfigError` | Bad client options (nothing was sent) | `invalid_config` |
| `Unsent::ValidationError` | Bad arguments caught before sending | `validation_error`, `invalid_idempotency_key`, `payload_too_large` |
| `Unsent::AuthenticationError` (401) | Wrong key or secret, clock skew | `invalid_api_key`, `invalid_signature`, `missing_signature`, `timestamp_skew` |
| `Unsent::RequestError` (400, 413) | The server rejected the request | `validation_error`, `unauthorized_sender`, `payload_too_large` |
| `Unsent::ConflictError` (409) | Idempotency key reused with different content | `idempotency_key_conflict` |
| `Unsent::NotFoundError` (404) | Unknown email id | `not_found` |
| `Unsent::PermissionError` (403) | Endpoint needs an admin session | `forbidden` |
| `Unsent::RateLimitError` (429) | Rate limited upstream | `rate_limited` |
| `Unsent::ServerError` (5xx) | Server failure (already retried) | `internal_error`, `server_misconfigured` |
| `Unsent::TimeoutError` | A request or `wait` timed out | `timeout` |
| `Unsent::ConnectionError` | No HTTP response (DNS, TLS, reset); also `aborted` | `connection_error`, `aborted` |

`Unsent::Error` exposes `code`, `reason`, `hint` and `to_h`; `Unsent::APIError` adds `status`, `body`, `existing_email_id`, `retry_after` and `server_time`. Messages include a fix hint where the SDK knows one, for example "Check that api_secret matches the API_SECRET secret of your Unsent deployment". `rescue Unsent::Error` catches every SDK failure.

## Client options

```ruby
Unsent::Client.new(
  base_url: nil,              # default: ENV['UNSENT_BASE_URL']
  api_key: nil,               # default: ENV['UNSENT_API_KEY']
  api_secret: nil,            # default: ENV['UNSENT_API_SECRET']
  default_from: nil,          # used when send_email has no from:
  default_provider_id: nil,   # used when send_email has no provider_id:
  timeout: nil,               # per attempt, seconds (default 30)
  max_retries: nil,           # 0-10 (default 3)
  transport: nil,             # custom transport (tests, proxies, instrumentation)
  clock: nil,                 # custom clock (testing)
  env: nil                    # where to read the UNSENT_* variables from (default ENV)
)
```

An `Unsent::Client` is frozen and thread-safe: create one and share it. Per-call overrides (`timeout:`, `max_retries:`, `cancel:`) are accepted by every method.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `invalid_api_key` | `api_key` must equal the server's `API_KEY`. Check for stray whitespace or a different environment's key. |
| `invalid_signature` | `api_secret` must equal the server's `API_SECRET`. |
| `timestamp_skew` with a secret set | Your clock is off by more than 3 minutes. The SDK corrects for this automatically; if it still fails, sync your clock (NTP). |
| `timestamp_skew` / `missing_signature` without a secret | The server requires signed requests. Set `UNSENT_API_SECRET`. |
| `unauthorized_sender` | The `from` address is not an active provider in the dashboard. Add it there, or omit `from`. |
| `invalid_response` | `base_url` is not pointing at an Unsent deployment (got HTML instead of JSON). |
| `unexpected_redirect` | The URL redirects (http to https, or a trailing path). Set `base_url` to the final URL; the SDK never follows redirects because that would forward your API key to another host. |
| `ConnectionError` on every call | DNS, TLS or network problem. The underlying exception is the error's `cause`. |
| `payload_too_large` | The request exceeds 3 MiB, or (server-side) body plus attachments exceed about 1.9 MB encoded. |
| `ConfigError: base_url uses plain http://` | Use `https://`; plain http is only allowed for localhost. |

## Compatibility

Ruby 3.1 or newer, no runtime dependencies. The ActionMailer delivery method is registered automatically when ActionMailer is loaded; the gem itself never requires Rails.

## Development

```bash
bundle install

rake                      # unit + fuzz + security + ActionMailer (end-to-end skipped without a server)
rake test:unit            # one suite at a time: test:fuzz, test:security, test:actionmailer, test:e2e
rake rbs                  # validate the sig/ signatures

# live end-to-end tests against a local worker + SMTP sink (from the repository root)
eval "$(scripts/e2e-server.sh start 8813)"
rake test:e2e
scripts/e2e-server.sh stop 8813
```
