# Sending ActionMailer mail through Unsent (Rails)

Add the gem and switch the delivery method. Everything an ActionMailer mail normally carries — from with a
display name, to/cc/bcc, subject, the HTML and plain-text parts, attachments — is translated into one
`POST /api/send` call.

```ruby
# Gemfile
gem 'unsent-sdk'
```

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

With an empty settings Hash the `UNSENT_*` environment variables are used:

```ruby
config.action_mailer.unsent_settings = {}
```

`unsent_settings` accepts every `Unsent::Client` option (`base_url`, `api_key`, `api_secret`, `default_from`,
`default_provider_id`, `timeout`, `max_retries`, `transport`, `clock`, `env`) plus `client:` to hand over a
ready-made client. Clients are cached per settings Hash, so the learned clock offset survives between mails.
An unknown setting key raises `Unsent::ConfigError` at boot, not at send time.

A mailer then needs no Unsent-specific code:

```ruby
class UserMailer < ApplicationMailer
  default from: 'Acme Support <support@acme.com>'

  def welcome(user)
    @user = user
    mail(to: user.email, subject: 'Welcome to Acme')
  end

  def invoice(user, invoice)
    attachments["invoice-#{invoice.number}.pdf"] = invoice.pdf_bytes
    attachments['terms.txt'] = { mime_type: 'text/plain', content: File.binread(Rails.root.join('terms.txt')) }
    mail(to: user.email, cc: 'billing@acme.com', bcc: 'audit@acme.com', subject: "Invoice #{invoice.number}")
  end
end
```

## Per-message provider and idempotency key

The Unsent API routes through one provider and de-duplicates by idempotency key. Both are per-message headers,
because they usually depend on the mail, not on the environment:

```ruby
class UserMailer < ApplicationMailer
  def receipt(order)
    headers 'provider_id' => 'resend_transactional'            # or X-Provider-Id / X-Unsent-Provider-Id
    headers 'X-Idempotency-Key' => "order-#{order.id}:receipt" # or Idempotency-Key / X-Unsent-Idempotency-Key
    mail(to: order.email, subject: "Your receipt for order #{order.id}")
  end
end
```

`provider_id` must be a provider configured in your dashboard. The key makes a re-sent mail (a job retried by
Sidekiq, a double-clicked button) return the original email instead of creating a second one; a *different*
message under the same key raises `Unsent::ConflictError` (`existing_email_id` names the original). Without the
header the SDK generates a fresh UUID per delivery, so retries of that one send are still safe.

## What is and is not translated

| Mail content | Unsent |
|---|---|
| `from` with a display name | `from: { email:, name: }` |
| `to` / `cc` / `bcc` | the same lists |
| subject | `subject` (up to 1000 characters) |
| `text/html` + `text/plain` parts (single part, `multipart/alternative`, or inside `multipart/mixed`) | `html` + `text` |
| attachments, inline ones included | `attachments` (as regular attachments; max 20, ~1.4 MB) |
| `provider_id`, `X-Idempotency-Key` headers | `provider_id`, `idempotency_key` |
| reply-to, custom headers, recipient display names, calendars | dropped — the Unsent API has no field for them |

A text-only mail gets the HTML body derived from the text automatically, exactly like `send_email`.

## Errors

`deliver!` (and therefore `deliver`/`deliver_now`) raises the SDK error, so `raise_delivery_errors = true` gets you
`Unsent::AuthenticationError`, `Unsent::RequestError`, `Unsent::RateLimitError`, ... straight from the mailer.
Rescue `Unsent::Error` to catch every failure:

```ruby
begin
  UserMailer.welcome(user).deliver_now
rescue Unsent::ValidationError => e
  # bad arguments, nothing was sent
rescue Unsent::Error => e
  Rails.logger.warn("unsent #{e.code}: #{e.message}") # credentials are redacted automatically
end
```

`deliver_later` works unchanged (ActionMailer wraps the same delivery method in its Active Job). Because the SDK's
own retries are already idempotent, an Active Job retry is only a problem if the job runs twice *and* the mail has no
`X-Idempotency-Key`; give transactional mail a stable key and job redeliveries are deduplicated too.

## Outside Rails

The delivery method also works with the plain `mail` gem:

```ruby
require 'mail'
require 'unsent'

Mail.defaults do
  delivery_method Unsent::DeliveryMethod,
                  base_url: ENV.fetch('UNSENT_BASE_URL'),
                  api_key: ENV.fetch('UNSENT_API_KEY'),
                  api_secret: ENV['UNSENT_API_SECRET']
end

Mail.deliver do
  from    'support@acme.com'
  to      'customer@example.com'
  subject 'Hello from mail'
  body    'Sent through Unsent.'
end
```

## Tests

Point the delivery method at a client with a stub transport, so no network is involved:

```ruby
# test/test_helper.rb
requests = []
transport = lambda do |request|
  requests << request
  Unsent::Transport::Response.new(status: 202, body: '{"id":1,"status":"queued"}')
end

ActionMailer::Base.delivery_method = :unsent
ActionMailer::Base.unsent_settings = {
  client: Unsent::Client.new(base_url: 'https://unsent.test', api_key: 'k', transport: transport)
}
```
