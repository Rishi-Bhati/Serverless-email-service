package unsent

import (
	"io"
	"net/http"
	"time"
)

// MaxDeliveryAttempts is the number of delivery attempts after which the service stops retrying a failed email.
const MaxDeliveryAttempts = 3

// Address is an email address with an optional display name.
//
// For convenience Address{Email: "Acme <a@acme.com>"} (or Addr("Acme <a@acme.com>")) is parsed into
// its name and address when Name is empty. The zero Address means "not set".
type Address struct {
	Email string
	Name  string
}

// Addr returns an Address from a bare "a@b.co" or "Name <a@b.co>" string. It is validated when used.
func Addr(s string) Address { return Address{Email: s} }

// String formats the address as `Name <email>` (or just the email).
func (a Address) String() string {
	if a.Name == "" {
		return a.Email
	}
	return a.Name + " <" + a.Email + ">"
}

// Attachment is a file to attach. Provide exactly one of Content, Reader or Base64.
type Attachment struct {
	// Filename shown to the recipient. If empty and Reader is an *os.File (or has a Name method), its base name is used.
	Filename string
	// Content is the raw file bytes; the SDK base64-encodes them.
	Content []byte
	// Reader supplies the raw file bytes; it is read fully (bounded by the 3 MiB request limit).
	Reader io.Reader
	// Base64 is already base64-encoded content (whitespace is ignored). Padded standard base64 only.
	Base64 string
	// ContentType is the MIME type, e.g. "application/pdf". Optional.
	ContentType string
}

// EmailStatus is the delivery state of an email.
type EmailStatus string

// Delivery states.
const (
	StatusQueued  EmailStatus = "queued"
	StatusSending EmailStatus = "sending"
	StatusSent    EmailStatus = "sent"
	StatusFailed  EmailStatus = "failed"
)

// Sort is a list ordering.
type Sort string

// Orderings accepted by the list endpoint.
const (
	SortUpdatedAtDesc Sort = "updated_at_desc"
	SortUpdatedAtAsc  Sort = "updated_at_asc"
	SortCreatedAtDesc Sort = "created_at_desc"
	SortCreatedAtAsc  Sort = "created_at_asc"
	SortAttemptsDesc  Sort = "attempts_desc"
)

// SendParams describes one email.
type SendParams struct {
	// From is the sender; it must match a provider configured in your dashboard. Omit to use
	// Options.DefaultFrom or the default provider.
	From Address
	// To is required (up to 100 addresses per field). CC and BCC are optional.
	To  []string
	CC  []string
	BCC []string
	// Subject is required (at most 1000 characters).
	Subject string
	// HTML and Text: provide at least one. A text-only send gets an HTML body derived from the text.
	HTML string
	Text string
	// Attachments: up to 20.
	Attachments []Attachment
	// ProviderID forces a specific provider. Falls back to Options.DefaultProviderID.
	ProviderID string
	// IdempotencyKey makes retries safe. Empty means a random UUID is generated per call and reused
	// across that call's retries. 1-255 printable ASCII characters without spaces.
	IdempotencyKey string
	// NoIdempotency disables idempotency entirely: no key is sent and the send is never retried.
	NoIdempotency bool
}

// SendResult is the outcome of an accepted send.
type SendResult struct {
	// ID is the email ID for Get/Wait.
	ID int64
	// Status is "queued" for a new email, or the current status for an idempotent replay.
	Status EmailStatus
	// IdempotencyKey is the key used ("" if NoIdempotency was set).
	IdempotencyKey string
	// IdempotentReplay is true when the key matched an email already queued; no new email was created.
	IdempotentReplay bool
	// TargetProvider is the provider name the server targeted, or "Automatic Priority / Default".
	TargetProvider string
	Message        string
}

// FailoverAttempt is a provider that failed before another one succeeded.
type FailoverAttempt struct {
	Provider  string
	Type      string
	Error     string
	Timestamp time.Time
}

// AttachmentInfo is attachment metadata.
type AttachmentInfo struct {
	Filename string
	// MimeType is "" when unknown.
	MimeType string
	// Size is the decoded size in bytes.
	Size int64
}

// AttachmentContent is an attachment with its base64 content (detail responses only).
type AttachmentContent struct {
	AttachmentInfo
	// Content is the base64-encoded content; use DecodeContent for the raw bytes.
	Content string
}

// EmailFields are the fields shared by list and detail responses. Empty strings mean "not set".
type EmailFields struct {
	ID      int64
	Status  EmailStatus
	To      []string
	CC      []string // nil when absent
	BCC     []string // nil when absent
	Subject string
	// HTMLBody is the HTML body.
	HTMLBody string
	// TextBody is "" when the email was sent without a plain-text alternative.
	TextBody   string
	FromEmail  string
	FromName   string
	ProviderID string // provider requested at send time
	// ProviderUsed is the name of the provider that delivered it.
	ProviderUsed    string
	FailoverHistory []FailoverAttempt
	IdempotencyKey  string
	Attempts        int
	// Error is the last delivery error.
	Error     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Email is an email as returned by List/Iterate (attachment metadata only).
type Email struct {
	EmailFields
	Attachments []AttachmentInfo
}

// EmailDetail is an email as returned by Get/Wait (attachments include content).
type EmailDetail struct {
	EmailFields
	Attachments []AttachmentContent
}

// ListParams filters and pages a listing. The zero value lists the newest-updated 100 emails.
type ListParams struct {
	// Limit is 1-200 (0 = server default 100).
	Limit  int
	Offset int
	Status EmailStatus
	// Search matches subject, recipients, sender, provider, body and error text.
	Search string
	// From and To are inclusive UTC days as YYYY-MM-DD. FromTime/ToTime are alternatives (the UTC day is used).
	From     string
	To       string
	FromTime time.Time
	ToTime   time.Time
	Sort     Sort
}

// ListResult is one page of emails.
type ListResult struct {
	Emails  []Email
	Total   int
	Limit   int
	Offset  int
	HasMore bool
}

// WaitOptions tunes Emails.Wait.
type WaitOptions struct {
	// Timeout is the overall deadline (default 60s).
	Timeout time.Duration
	// Interval is the first poll interval (default 1s, minimum 100ms); it grows by 1.5x up to 5s.
	Interval time.Duration
}

// QueueStatus holds the queue counters.
type QueueStatus struct {
	Queued  int
	Sending int
	Sent    int
	Failed  int
}

// Health is the public liveness probe result.
type Health struct {
	Status    string
	Runtime   string
	D1        string
	Timestamp time.Time
}

// Options configures a Client. Empty fields fall back to the UNSENT_* environment variables.
type Options struct {
	// BaseURL of your deployment, e.g. https://unsent.example.com (env UNSENT_BASE_URL).
	BaseURL string
	// APIKey is the deployment's API_KEY (env UNSENT_API_KEY).
	APIKey string
	// APISecret is the deployment's API_SECRET, used to HMAC-sign sends (env UNSENT_API_SECRET).
	// Required unless the server runs with SECURITY_MODE=api-key-only; safe to pass in every mode.
	APISecret string
	// DefaultFrom is used when a send has no From.
	DefaultFrom Address
	// DefaultProviderID is used when a send has no ProviderID.
	DefaultProviderID string
	// Timeout is the per-attempt timeout (default 30s).
	Timeout time.Duration
	// MaxRetries is the number of retries after the first attempt, 0-10 (nil = default 3). Use Int(0) to disable.
	MaxRetries *int
	// HTTPClient is a custom client (tests, proxies). It is copied and its redirect policy replaced:
	// redirects are never followed.
	HTTPClient *http.Client
	// Transport is a custom RoundTripper; shorthand for an http.Client that uses it. Do not combine with HTTPClient.
	Transport http.RoundTripper
}

// Int returns a pointer to n, for Options.MaxRetries.
func Int(n int) *int { return &n }
