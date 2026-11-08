package unsent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultTimeout    = 30 * time.Second
	defaultMaxRetries = 3
	maxMaxRetries     = 10
)

// Client is the Unsent client. It is safe for concurrent use by multiple goroutines.
type Client struct {
	// Emails sends and inspects emails.
	Emails *Emails
	h      *httpClient
}

func clean(s string) string { return strings.TrimSpace(s) }

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func printableASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

// validHost rejects authorities net/url accepts but no real host can be: a hostname still containing ':'
// (an unbracketed IPv6 literal or a stray colon), or bytes that are illegal in a host name.
func validHost(u *url.URL) bool {
	host := u.Hostname()
	if host == "" {
		return false
	}
	// A ':' is only legal inside a bracketed IPv6 literal, which net/url keeps in u.Host as "[::1]".
	bracketed := strings.HasPrefix(u.Host, "[")
	for i := 0; i < len(host); i++ {
		b := host[i]
		if b == ':' && !bracketed {
			return false
		}
		ok := b == '-' || b == '.' || b == '_' || b == ':' || b == '%' ||
			(b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
		if !ok {
			return false
		}
	}
	return true
}

// normalizeBaseURL trims, validates and canonicalises a base URL: query/fragment dropped, trailing
// slashes removed, path prefix kept. https is required except for loopback hosts.
func normalizeBaseURL(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return "", "", newConfigErr("BaseURL is not a valid URL. Expected something like https://unsent.example.com")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", "", newConfigErr(fmt.Sprintf("BaseURL must start with https:// (got %s://)", truncateRunes(sanitizeText(scheme), 20)))
	}
	if u.Opaque != "" || u.Hostname() == "" {
		return "", "", newConfigErr("BaseURL is not a valid URL. Expected something like https://unsent.example.com")
	}
	if u.User != nil {
		return "", "", newConfigErr("BaseURL must not contain credentials; pass APIKey/APISecret instead.")
	}
	// net/url is lenient about malformed authorities: "https://::" parses with Hostname() == ":" and Host "::".
	// A real host is a DNS label, an IPv4 address or a bracketed IPv6 address, so anything containing ':' outside
	// brackets, or any other illegal host byte, is refused here rather than producing a nonsense URL later.
	if !validHost(u) {
		return "", "", newConfigErr("BaseURL is not a valid URL. Expected something like https://unsent.example.com")
	}
	host := strings.ToLower(u.Hostname())
	loopback := host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasSuffix(host, ".localhost")
	if scheme == "http" && !loopback {
		return "", "", newConfigErr("BaseURL uses plain http://, which would send your API key unencrypted. Use https:// (http:// is only allowed for localhost).")
	}
	hostport := strings.TrimSuffix(strings.ToLower(u.Host), ":") // "host:" means no port
	path := strings.TrimRight(u.EscapedPath(), "/")
	return scheme + "://" + hostport + path, u.Host, nil
}

// New creates a Client. Empty option fields fall back to the UNSENT_BASE_URL, UNSENT_API_KEY and
// UNSENT_API_SECRET environment variables (empty variables count as unset).
func New(opts Options) (*Client, error) {
	baseRaw := firstNonEmpty(clean(opts.BaseURL), clean(os.Getenv("UNSENT_BASE_URL")))
	apiKey := firstNonEmpty(clean(opts.APIKey), clean(os.Getenv("UNSENT_API_KEY")))
	apiSecret := firstNonEmpty(clean(opts.APISecret), clean(os.Getenv("UNSENT_API_SECRET")))

	if baseRaw == "" {
		return nil, newConfigErr("Missing BaseURL. Pass Options.BaseURL or set UNSENT_BASE_URL (e.g. https://unsent.example.com).")
	}
	if apiKey == "" {
		return nil, newConfigErr("Missing APIKey. Pass Options.APIKey or set UNSENT_API_KEY (the API_KEY of your deployment).")
	}
	if !printableASCII(apiKey) {
		return nil, newConfigErr("APIKey must contain only printable ASCII characters (no line breaks, control or non-ASCII characters).")
	}
	if !printableASCII(apiSecret) {
		return nil, newConfigErr("APISecret must contain only printable ASCII characters (no line breaks, control or non-ASCII characters).")
	}

	if opts.Timeout < 0 {
		return nil, newConfigErr("Timeout must be a positive duration (0 selects the 30s default)")
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	maxRetries := defaultMaxRetries
	if opts.MaxRetries != nil {
		maxRetries = *opts.MaxRetries
		if maxRetries < 0 || maxRetries > maxMaxRetries {
			return nil, newConfigErr("MaxRetries must be an integer from 0 to 10")
		}
	}

	baseURL, host, err := normalizeBaseURL(baseRaw)
	if err != nil {
		return nil, err
	}

	if opts.HTTPClient != nil && opts.Transport != nil {
		return nil, newConfigErr("Set only one of Options.HTTPClient and Options.Transport")
	}
	var hc *http.Client
	switch {
	case opts.HTTPClient != nil:
		cp := *opts.HTTPClient
		cp.CheckRedirect = noRedirect
		hc = &cp
	case opts.Transport != nil:
		hc = &http.Client{Transport: opts.Transport, CheckRedirect: noRedirect}
	default:
		var tr http.RoundTripper
		if dt, ok := http.DefaultTransport.(*http.Transport); ok {
			tr = dt.Clone()
		} else {
			tr = &http.Transport{Proxy: http.ProxyFromEnvironment}
		}
		hc = &http.Client{Transport: tr, CheckRedirect: noRedirect}
	}

	if _, err := resolveFrom(opts.DefaultFrom, "DefaultFrom"); err != nil {
		return nil, newConfigErr(err.Error())
	}
	if opts.DefaultProviderID != "" {
		if err := validateProviderID(opts.DefaultProviderID); err != nil {
			return nil, newConfigErr("DefaultProviderID: " + err.Error())
		}
	}

	h := &httpClient{
		baseURL:    baseURL,
		host:       host,
		apiKey:     apiKey,
		apiSecret:  apiSecret,
		timeout:    timeout,
		maxRetries: maxRetries,
		client:     hc,
	}
	c := &Client{h: h}
	c.Emails = &Emails{h: h, defaultFrom: opts.DefaultFrom, defaultProvider: opts.DefaultProviderID}
	return c, nil
}

// NewFromEnv creates a Client from UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET.
// Optional overrides (for example DefaultFrom or Timeout) may be passed; their non-empty fields win.
func NewFromEnv(overrides ...Options) (*Client, error) {
	var o Options
	if len(overrides) > 0 {
		o = overrides[0]
	}
	return New(o)
}

// Send is a shortcut for c.Emails.Send.
func (c *Client) Send(ctx context.Context, p SendParams, opts ...CallOption) (*SendResult, error) {
	return c.Emails.Send(ctx, p, opts...)
}

// Status returns the queue counters. It is also a cheap way to verify your credentials.
func (c *Client) Status(ctx context.Context, opts ...CallOption) (*QueueStatus, error) {
	cfg, err := c.h.callConfig(opts)
	if err != nil {
		return nil, err
	}
	res, err := c.h.call(ctx, &callOp{method: "GET", path: "/api/status", retrySafe: true, timeout: cfg.timeout, maxRetries: cfg.maxRetries})
	if err != nil {
		return nil, err
	}
	m := asMap(res.data)
	if m == nil {
		return nil, invalidShape("/api/status")
	}
	return &QueueStatus{Queued: toInt(m["queued"]), Sending: toInt(m["sending"]), Sent: toInt(m["sent"]), Failed: toInt(m["failed"])}, nil
}

// Health is the public liveness probe. It needs no credentials, so it does not verify them; use Status for that.
func (c *Client) Health(ctx context.Context, opts ...CallOption) (*Health, error) {
	cfg, err := c.h.callConfig(opts)
	if err != nil {
		return nil, err
	}
	res, err := c.h.call(ctx, &callOp{method: "GET", path: "/api/health", noAuth: true, retrySafe: true, timeout: cfg.timeout, maxRetries: cfg.maxRetries})
	if err != nil {
		return nil, err
	}
	m := asMap(res.data)
	if m == nil {
		return nil, invalidShape("/api/health")
	}
	ts := time.Now().UTC()
	if f, ok := toFloat(m["timestamp"]); ok && f != 0 {
		ts = toTime(m["timestamp"])
	}
	return &Health{Status: str(m["status"]), Runtime: str(m["runtime"]), D1: str(m["d1"]), Timestamp: ts}, nil
}

func invalidShape(path string) error {
	return &BaseError{Code: "invalid_response", Message: fmt.Sprintf("Unexpected response shape from %s. Is BaseURL pointing at your Unsent deployment?", path)}
}

// String returns a description that never includes credentials.
func (c *Client) String() string {
	if c == nil || c.h == nil {
		return "unsent.Client(nil)"
	}
	return fmt.Sprintf("unsent.Client{baseURL: %s, signing: %t}", c.h.baseURL, c.h.apiSecret != "")
}

// GoString implements fmt.GoStringer without exposing credentials.
func (c *Client) GoString() string { return c.String() }

// Format implements fmt.Formatter so no verb (%v, %+v, %#v, %s) can print credentials.
func (c *Client) Format(f fmt.State, _ rune) { _, _ = fmt.Fprint(f, c.String()) }

// MarshalJSON never serialises credentials.
func (c *Client) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }

func (o Options) redacted() string {
	mask := func(s string) string {
		if s == "" {
			return `""`
		}
		return "[redacted]"
	}
	return fmt.Sprintf("unsent.Options{BaseURL: %q, APIKey: %s, APISecret: %s, DefaultFrom: %q, DefaultProviderID: %q, Timeout: %s}",
		o.BaseURL, mask(o.APIKey), mask(o.APISecret), o.DefaultFrom.String(), o.DefaultProviderID, o.Timeout)
}

// String returns a description with APIKey and APISecret redacted.
func (o Options) String() string { return o.redacted() }

// GoString implements fmt.GoStringer with credentials redacted.
func (o Options) GoString() string { return o.redacted() }

// Format implements fmt.Formatter so credentials are never printed.
func (o Options) Format(f fmt.State, _ rune) { _, _ = fmt.Fprint(f, o.redacted()) }

// MarshalJSON serialises Options with credentials redacted.
func (o Options) MarshalJSON() ([]byte, error) {
	mask := func(s string) string {
		if s == "" {
			return ""
		}
		return "[redacted]"
	}
	return json.Marshal(map[string]any{
		"baseURL": o.BaseURL, "apiKey": mask(o.APIKey), "apiSecret": mask(o.APISecret),
		"defaultFrom": o.DefaultFrom.String(), "defaultProviderID": o.DefaultProviderID,
	})
}

// --- per-call options -------------------------------------------------------

type callCfg struct {
	timeout    time.Duration
	maxRetries int
}

// CallOption customises a single call (timeout, retries).
type CallOption func(*callCfg) error

// WithTimeout sets the per-attempt timeout for this call. It must be positive.
func WithTimeout(d time.Duration) CallOption {
	return func(c *callCfg) error {
		if d <= 0 {
			return newValidationErr("timeout must be a positive duration")
		}
		c.timeout = d
		return nil
	}
}

// WithMaxRetries sets the maximum number of retries for this call (0-10; 0 disables retries).
func WithMaxRetries(n int) CallOption {
	return func(c *callCfg) error {
		if n < 0 || n > maxMaxRetries {
			return newValidationErr("max retries must be an integer from 0 to 10")
		}
		c.maxRetries = n
		return nil
	}
}

func (h *httpClient) callConfig(opts []CallOption) (callCfg, error) {
	cfg := callCfg{timeout: h.timeout, maxRetries: h.maxRetries}
	for _, o := range opts {
		if o == nil {
			continue
		}
		if err := o(&cfg); err != nil {
			return cfg, err
		}
	}
	return cfg, nil
}
