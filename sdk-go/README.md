# unsent (Go)

Official Go SDK for your self-hosted [Unsent](../README.md) email service.

- **A few lines to send.** No HMAC code, nonces, timestamps or base64 to write yourself.
- **Safe retries.** Every send carries an idempotency key, so network errors and 5xx responses are retried automatically without ever sending the same email twice.
- **Standard library only.** No dependencies; Go 1.21+.
- **Idiomatic.** `context.Context` on every call, typed errors for `errors.As` / `errors.Is`, safe for concurrent use, injectable `http.RoundTripper` for tests.

```go
package main

import (
	"context"
	"log"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func main() {
	client, err := unsent.NewFromEnv() // UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET
	if err != nil {
		log.Fatal(err)
	}
	res, err := client.Send(context.Background(), unsent.SendParams{
		To:      []string{"customer@example.com"},
		Subject: "Welcome!",
		HTML:    "<h1>Hello</h1><p>Your account is ready.</p>",
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Println("queued as", res.ID)
}
```

## Install

```bash
go get github.com/Rishi-Bhati/Serverless-email-service/sdk-go
```

The package name is `unsent`; the examples import it as `unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"`.

## Set up credentials

You need three values from your Unsent deployment. Sign in to the dashboard as an administrator and open the **API Docs** tab, which fills in your real keys, or use the secrets you deployed:

| Environment variable | Value |
|---|---|
| `UNSENT_BASE_URL` | Your deployment URL, e.g. `https://unsent.example.com` |
| `UNSENT_API_KEY` | The `API_KEY` secret |
| `UNSENT_API_SECRET` | The `API_SECRET` secret |

Empty variables count as unset. Or pass them explicitly (explicit options win over the environment):

```go
client, err := unsent.New(unsent.Options{
	BaseURL:   "https://unsent.example.com",
	APIKey:    os.Getenv("MY_KEY"),
	APISecret: os.Getenv("MY_SECRET"),
})
```

`APISecret` is used to sign requests. It is required unless your server runs with `SECURITY_MODE=api-key-only`, and it is safe to pass in every mode: the SDK works with `api-key-only`, `signed` and `full` servers without any configuration.

> **Keep these on the server.** Anyone holding the API secret can send email as you. The SDK never prints them: `fmt` (`%v`, `%+v`, `%#v`), `encoding/json`, error messages and error fields all redact credentials.

Credentials must be printable ASCII (leading and trailing whitespace is trimmed); anything else is a `*ConfigError`. `BaseURL` must be `https://` (`http://` is accepted only for `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`) and must not embed credentials.

## Sending email

```go
res, err := client.Emails.Send(ctx, unsent.SendParams{
	From:       unsent.Addr("Acme Support <support@acme.com>"), // optional; must be a sender configured in your dashboard
	To:         []string{"a@example.com", "b@example.com"},
	CC:         []string{"manager@example.com"},
	BCC:        []string{"audit@example.com"},
	Subject:    "Your order has shipped",
	HTML:       "<p>It is on its way.</p>",
	Text:       "It is on its way.",             // optional plain-text version
	ProviderID: "resend_marketing",              // optional: force a specific provider
	IdempotencyKey: "order-8492:shipped",        // optional, see below
})
// res.ID, res.Status ("queued"), res.IdempotentReplay, res.TargetProvider
```

`client.Send(...)` is a shortcut for `client.Emails.Send(...)`.

| Field | Type | Notes |
|---|---|---|
| `To` | `[]string` | Required. Up to 100 addresses per field, each containing `@`, no line breaks. |
| `CC`, `BCC` | `[]string` | Optional. |
| `Subject` | `string` | Required, up to 1000 characters. |
| `HTML` / `Text` | `string` | Provide at least one. A text-only send gets an HTML body derived from the text automatically (the API requires HTML). |
| `From` | `unsent.Address` | `unsent.Addr("Name <a@b.com>")` is parsed for you, or set `Address{Email, Name}`. Omit to use `Options.DefaultFrom` / your default provider. |
| `ProviderID` | `string` | Route through one provider. Falls back to `Options.DefaultProviderID`. |
| `Attachments` | `[]unsent.Attachment` | Up to 20. See below. |
| `IdempotencyKey` | `string` | See below. Empty means "generate one". |
| `NoIdempotency` | `bool` | Send without a key. The send is then never retried. |

Everything is validated **before any network I/O**; invalid input returns a `*ValidationError` and nothing is sent. The whole request body is limited to 3 MiB (`payload_too_large`).

`Send` returns as soon as Unsent has **accepted** the email (HTTP 202). Delivery happens in the background, with automatic failover across your providers.

Per-call options go last: `client.Send(ctx, params, unsent.WithTimeout(5*time.Second), unsent.WithMaxRetries(0))`. They are accepted by every method.

### Waiting for delivery

```go
res, _ := client.Send(ctx, params)
email, err := client.Emails.Wait(ctx, res.ID, nil) // polls until final, 60 s timeout by default
if err != nil { /* lookup failed, ctx cancelled, or timed out (unsent.IsTimeout) */ }

if email.Status == unsent.StatusSent {
	fmt.Println("delivered via", email.ProviderUsed)
} else {
	fmt.Println("failed:", email.Error, email.FailoverHistory)
}
```

`Wait` returns once the email is `sent`, or `failed` after the service has used up its delivery attempts (`unsent.MaxDeliveryAttempts`). A permanent failure is a normal return value, not an error. Tune it with `&unsent.WaitOptions{Timeout: 2*time.Minute, Interval: 500*time.Millisecond}` (the interval grows by 1.5x up to 5 s). Cancelling `ctx` stops it immediately with an `aborted` error.

### Attachments

```go
invoice, err := unsent.AttachmentFromFile("./invoice.pdf") // name and MIME type from the path

client.Send(ctx, unsent.SendParams{
	To: []string{"customer@example.com"}, Subject: "Invoice", HTML: "<p>Attached.</p>",
	Attachments: []unsent.Attachment{
		invoice,
		{Filename: "report.csv", Content: csvBytes, ContentType: "text/csv"},    // raw bytes
		{Filename: "photo.jpg", Reader: file},                                    // any io.Reader (an *os.File supplies its own name)
		{Filename: "pre.bin", Base64: "AAECAw=="},                                // already base64
	},
})
```

Set exactly one of `Content`, `Reader` or `Base64`. A `Base64` string must be valid padded standard base64 (whitespace is ignored); to attach text or binary data pass `Content` instead. Readers are read fully, bounded by the request limit.

The service stores the body and attachments together in one database row, so keep the total under about **1.4 MB of raw attachment data**. Larger emails are rejected with a `413 payload_too_large`.

### Idempotency and retries

Network blips and 5xx responses are retried up to `MaxRetries` times (default 3) with exponential backoff (500 ms doubling to 8 s, jittered), honoring `Retry-After` (seconds or HTTP date, capped at 60 s). Retries are safe because every send carries an idempotency key:

- By default the SDK generates a UUID per `Send` call and reuses it across that call's retries. A request that actually succeeded but whose response was lost is recognised on retry (`res.IdempotentReplay == true`).
- Pass your **own** key (e.g. `order-8492:shipped`) to also deduplicate across calls, processes and your own job retries. The same key with the same message returns the original email (kept for 24 hours by default); the same key with a *different* message returns a conflict (`unsent.IsConflict(err)`, `apiErr.ExistingEmailID`).
- Set `NoIdempotency: true` to opt out. The SDK then never retries that send.

Keys are 1 to 255 printable ASCII characters without spaces.

What is retried: network errors, per-attempt timeouts, HTTP 408, 425, 429 and 5xx (except 501, 505 and `server_misconfigured`). Never retried: other 4xx, redirects, cancellation. Every attempt gets a fresh timestamp and nonce.

The SDK also corrects a skewed local clock: on a `timestamp_skew` response it learns the server time (from the `Date` header, or `GET /api/health`), stores the offset for later signatures and retries immediately, once per call.

## Inspecting emails

```go
email, err := client.Emails.Get(ctx, 1234) // includes attachment content (base64); email.Attachments[0].DecodeContent()

page, err := client.Emails.List(ctx, &unsent.ListParams{
	Status: unsent.StatusFailed,
	Search: "invoice",
	From:   "2026-01-01", // YYYY-MM-DD (UTC); or FromTime / ToTime
	Limit:  50,
})
// page.Emails, page.Total, page.HasMore

st, err := client.Status(ctx) // {Queued, Sending, Sent, Failed}; also verifies your credentials
h, err := client.Health(ctx)  // public liveness probe (does not verify credentials)
```

### Iterating

`Iterate` returns an `*Iterator` that fetches pages as needed, oldest first (so mail sent while you iterate does not shift pages):

```go
it := client.Emails.Iterate(ctx, &unsent.ListParams{Status: unsent.StatusFailed})
for it.Next(ctx) {
	e := it.Email()
	fmt.Println(e.ID, e.Subject)
}
if err := it.Err(); err != nil { /* ... */ }
```

A callback form, `client.Emails.Each(ctx, params, func(e unsent.Email) error { ... })`, stops at the first error you return. On Go 1.23+ there is also a range-over-func form:

```go
for e, err := range client.Emails.All(ctx, nil) {
	if err != nil { return err }
	fmt.Println(e.ID)
}
```

Times are `time.Time` in UTC. Strings that the API can leave empty (`TextBody`, `ProviderUsed`, `Error`, ...) are `""` when absent; `CC` and `BCC` are `nil` when absent. `TextBody` is empty when the API only echoed the HTML body.

Provider management (adding SMTP/Resend/SendGrid credentials) and deleting emails need an admin dashboard session and are intentionally not exposed through API keys.

## Error handling

Every failure is one of the SDK's error types, each carrying a stable `Code`. Branch on the type or code, not on the message.

```go
res, err := client.Send(ctx, params)
var api *unsent.APIError
switch {
case err == nil:
case unsent.IsValidation(err):     // bad arguments, nothing was sent
case unsent.IsAuthentication(err): // errors.As(err, &api): api.Code, api.Hint
case unsent.IsConflict(err):       // errors.As(err, &api): api.ExistingEmailID
case unsent.IsTimeout(err), unsent.IsAborted(err), unsent.IsConnection(err):
case errors.As(err, &api):         // api.Status, api.Code, api.Reason, api.Body
}
```

| Type | `errors.Is` sentinel / helper | When | Typical `Code` |
|---|---|---|---|
| `*ConfigError` | `ErrConfig` / `IsConfig` | Bad client options (nothing was sent) | `invalid_config` |
| `*ValidationError` | `ErrValidation` / `IsValidation` | Bad arguments caught before sending | `validation_error`, `invalid_idempotency_key`, `payload_too_large` |
| `*APIError` 401 | `ErrAuthentication` / `IsAuthentication` | Wrong key or secret, clock skew | `invalid_api_key`, `invalid_signature`, `missing_signature`, `timestamp_skew` |
| `*APIError` 400, 413 | `ErrRequest` / `IsRequest` | The server rejected the request | `validation_error`, `unauthorized_sender`, `payload_too_large` |
| `*APIError` 409 | `ErrConflict` / `IsConflict` | Idempotency key reused with different content | `idempotency_key_conflict` |
| `*APIError` 404 | `ErrNotFound` / `IsNotFound` | Unknown email id | `not_found` |
| `*APIError` 403 | `ErrPermission` / `IsPermission` | Endpoint needs an admin session | `forbidden` |
| `*APIError` 429 | `ErrRateLimit` / `IsRateLimit` | Rate limited upstream | `rate_limited` |
| `*APIError` 5xx | `ErrServer` / `IsServer` | Server failure (already retried) | `internal_error`, `server_misconfigured` |
| `*ConnectionError` | `ErrTimeout` / `IsTimeout` | A request or `Wait` timed out | `timeout` |
| `*ConnectionError` | `ErrAborted` / `IsAborted` | The context was cancelled (`errors.Is(err, context.Canceled)` also works) | `aborted` |
| `*ConnectionError` | `ErrConnection` / `IsConnection` | No HTTP response (DNS, TLS, reset); also true for the two above | `connection_error` |
| `*BaseError` | | A redirect was refused, the body was not JSON, or it was larger than 32 MiB | `unexpected_redirect`, `invalid_response`, `response_too_large` |

All of them can be caught with `var b *unsent.BaseError; errors.As(err, &b)` (fields `Code`, `Message`, `Reason`, `Hint`, `Cause`), or `unsent.CodeOf(err)`. `APIError` adds `Status`, `Body` (parsed JSON or text), `ExistingEmailID`, `RetryAfter` and `ServerTime`. Messages include a fix hint where the SDK knows one, for example "Check that APISecret matches the API_SECRET secret of your Unsent deployment".

## Recipes

**net/http handler** · [examples/nethttp](examples/nethttp/main.go)

```go
var client *unsent.Client // built once at startup with unsent.NewFromEnv(); shared by all handlers (concurrency-safe)

func signup(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	res, err := client.Send(r.Context(), unsent.SendParams{ // r.Context() cancels retries if the caller disconnects
		To: []string{email}, Subject: "Welcome", HTML: "<p>Hi!</p>",
		IdempotencyKey: "welcome:" + email,
	})
	if unsent.IsValidation(err) {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		log.Printf("send failed: %v", err) // never contains your credentials
		http.Error(w, "could not send", http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, `{"id":%d}`, res.ID)
}
```

**Gin / Echo / chi.** They hand you the standard `*http.Request`, so the handler body is the same: use `c.Request.Context()` (Gin) or `c.Request().Context()` (Echo) as the context. A Gin-style handler is just the function above with `func(c *gin.Context)` around it; the SDK itself has no framework dependency.

**Background jobs.** Use a stable key so your own queue redeliveries are deduplicated too: `IdempotencyKey: fmt.Sprintf("invoice-%d:receipt", invoiceID)`.

**Tests.** Inject a `RoundTripper` (or a whole `*http.Client`) instead of hitting the network:

```go
type fake struct{ got *http.Request }

func (f *fake) RoundTrip(r *http.Request) (*http.Response, error) {
	f.got = r
	return &http.Response{
		StatusCode: 202, Header: http.Header{}, Request: r,
		Body: io.NopCloser(strings.NewReader(`{"id":1,"status":"queued"}`)),
	}, nil
}

client, _ := unsent.New(unsent.Options{BaseURL: "https://unsent.test", APIKey: "k", Transport: &fake{}})
```

An injected `http.Client` is copied and its redirect policy replaced, so redirects are never followed whatever you pass. A custom `RoundTripper` must honour `req.Context()` as the `http.RoundTripper` contract requires.

**Local development.** `http://localhost` and `http://127.0.0.1` base URLs are allowed for `wrangler dev`; any other `http://` URL is rejected so your key never travels in plain text.

## Client options

```go
unsent.New(unsent.Options{
	BaseURL:           "...",             // default: $UNSENT_BASE_URL
	APIKey:            "...",             // default: $UNSENT_API_KEY
	APISecret:         "...",             // default: $UNSENT_API_SECRET
	DefaultFrom:       unsent.Addr("..."), // used when Send has no From
	DefaultProviderID: "...",             // used when Send has no ProviderID
	Timeout:           30 * time.Second,  // per attempt (0 = default)
	MaxRetries:        unsent.Int(3),     // nil = 3; unsent.Int(0) disables retries; max 10
	HTTPClient:        nil,               // custom *http.Client (copied; redirects always refused)
	Transport:         nil,               // or just a custom http.RoundTripper
})
```

Per-call: `unsent.WithTimeout(d)` and `unsent.WithMaxRetries(n)`.

A `*unsent.Client` is safe for concurrent use; create one and reuse it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `invalid_api_key` | `APIKey` must equal the server's `API_KEY`. Check for stray whitespace or a different environment's key. |
| `invalid_signature` | `APISecret` must equal the server's `API_SECRET`. |
| `timestamp_skew` with a secret set | Your clock is off by more than 3 minutes. The SDK corrects for this automatically; if it still fails, sync your clock (NTP). |
| `timestamp_skew` / `missing_signature` without a secret | The server requires signed requests. Set `UNSENT_API_SECRET`. |
| `unauthorized_sender` | The `From` address is not an active provider in the dashboard. Add it there, or omit `From`. |
| `invalid_response` | `BaseURL` is not pointing at an Unsent deployment (got HTML instead of JSON). |
| `unexpected_redirect` | The URL redirects (http to https, or a trailing path). Set `BaseURL` to the final URL; the SDK never follows redirects because that would forward your API key to another host. |
| `Could not reach ...` | DNS, TLS or network problem. The cause is in `errors.Unwrap(err)`. |
| `payload_too_large` | The request exceeds 3 MiB, or (server-side) body plus attachments exceed about 1.9 MB encoded. |
| `config error: BaseURL uses plain http://` | Use `https://`; plain http is only allowed for localhost. |

## Compatibility

Go 1.21 or newer, standard library only. `Emails.All` (range-over-func) is compiled on Go 1.23+.

## Development

```bash
go vet ./...
go test -race -count=1 ./...                       # unit, fuzz seeds, hostile server, security (e2e skipped)
go test -run '^$' -fuzz '^FuzzParseAddress$' -fuzztime=10s .   # also: FuzzNormalizeBase64, FuzzIdempotencyKey, FuzzOptions, FuzzSendParams, FuzzRetryAfter, FuzzMapResponses

# live end-to-end tests against a local worker + SMTP sink (from the repository root)
eval "$(scripts/e2e-server.sh start 8812)"
(cd sdk-go && go test -race -count=1 -run E2E -v ./...)
scripts/e2e-server.sh stop 8812
```
