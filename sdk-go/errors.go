package unsent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// BaseError is the common part of every error returned by this package. Use errors.As with a
// *BaseError target to catch any SDK error, or the Is* helpers / Err* sentinels to test for a kind.
// The error returned for an unfollowed redirect, a non-JSON response or an oversized response is a
// plain *BaseError with code "unexpected_redirect", "invalid_response" or "response_too_large".
type BaseError struct {
	// Code is a stable machine-readable code such as "invalid_api_key", "validation_error" or "timeout".
	Code string
	// Message is the human-readable description. It never contains the API key or secret.
	Message string
	// Reason is extra detail from the server (the API "reason" field), when present.
	Reason string
	// Hint is a short suggestion for fixing the problem, when the SDK knows one.
	Hint string
	// Cause is the underlying error, if any.
	Cause error
}

func (e *BaseError) Error() string { return e.Message }
func (e *BaseError) Unwrap() error { return e.Cause }

// ConfigError reports invalid client options. Nothing was sent.
type ConfigError struct{ BaseError }

// ValidationError reports an invalid argument that was caught before any network I/O.
type ValidationError struct{ BaseError }

// ConnectionError reports that no HTTP response was obtained: DNS/TLS/reset, a per-attempt timeout
// (code "timeout"), a wait() deadline (code "timeout"), or caller cancellation (code "aborted").
type ConnectionError struct{ BaseError }

// Timeout reports whether this is a timeout (net.Error compatible).
func (e *ConnectionError) Timeout() bool { return e.Code == "timeout" }

// APIError is an error response from the server.
type APIError struct {
	BaseError
	// Status is the HTTP status code.
	Status int
	// Body is the parsed JSON error body, or the raw text when the body was not JSON.
	Body any
	// ExistingEmailID is the "id" of the conflicting email on idempotency conflicts (409); 0 if absent.
	ExistingEmailID int64
	// RetryAfter is the delay requested by the server via Retry-After (0 if none).
	RetryAfter time.Duration
	// ServerTime is the server time from the response Date header (zero if absent).
	ServerTime time.Time
}

// Sentinels for errors.Is.
var (
	ErrConfig         = errors.New("unsent: configuration error")
	ErrValidation     = errors.New("unsent: validation error")
	ErrConnection     = errors.New("unsent: connection error")
	ErrTimeout        = errors.New("unsent: timeout")
	ErrAborted        = errors.New("unsent: aborted")
	ErrAPI            = errors.New("unsent: API error")
	ErrAuthentication = errors.New("unsent: authentication error (401)")
	ErrPermission     = errors.New("unsent: permission error (403)")
	ErrNotFound       = errors.New("unsent: not found (404)")
	ErrConflict       = errors.New("unsent: conflict (409)")
	ErrRateLimit      = errors.New("unsent: rate limited (429)")
	ErrRequest        = errors.New("unsent: request rejected (400/413)")
	ErrServer         = errors.New("unsent: server error (5xx)")
)

func (e *ConfigError) As(t any) bool     { return asBase(t, &e.BaseError) }
func (e *ValidationError) As(t any) bool { return asBase(t, &e.BaseError) }
func (e *ConnectionError) As(t any) bool { return asBase(t, &e.BaseError) }
func (e *APIError) As(t any) bool        { return asBase(t, &e.BaseError) }

func asBase(target any, b *BaseError) bool {
	if p, ok := target.(**BaseError); ok {
		*p = b
		return true
	}
	return false
}

func (e *ConfigError) Is(t error) bool     { return t == ErrConfig }
func (e *ValidationError) Is(t error) bool { return t == ErrValidation }
func (e *ConnectionError) Is(t error) bool {
	return t == ErrConnection || (t == ErrTimeout && e.Code == "timeout") || (t == ErrAborted && e.Code == "aborted")
}
func (e *APIError) Is(t error) bool {
	switch t {
	case ErrAPI:
		return true
	case ErrAuthentication:
		return e.Status == 401
	case ErrPermission:
		return e.Status == 403
	case ErrNotFound:
		return e.Status == 404
	case ErrConflict:
		return e.Status == 409
	case ErrRateLimit:
		return e.Status == 429
	case ErrRequest:
		return e.Status == 400 || e.Status == 413
	case ErrServer:
		return e.Status >= 500
	}
	return false
}

// IsAuthentication reports whether err is a 401 API error.
func IsAuthentication(err error) bool { return errors.Is(err, ErrAuthentication) }

// IsPermission reports whether err is a 403 API error.
func IsPermission(err error) bool { return errors.Is(err, ErrPermission) }

// IsNotFound reports whether err is a 404 API error.
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

// IsConflict reports whether err is a 409 API error (idempotency key reused with a different message).
func IsConflict(err error) bool { return errors.Is(err, ErrConflict) }

// IsRateLimit reports whether err is a 429 API error.
func IsRateLimit(err error) bool { return errors.Is(err, ErrRateLimit) }

// IsRequest reports whether err is a 400 or 413 API error.
func IsRequest(err error) bool { return errors.Is(err, ErrRequest) }

// IsServer reports whether err is a 5xx API error.
func IsServer(err error) bool { return errors.Is(err, ErrServer) }

// IsTimeout reports whether err is a request or wait() timeout.
func IsTimeout(err error) bool { return errors.Is(err, ErrTimeout) }

// IsAborted reports whether the call was cancelled through its context.
func IsAborted(err error) bool { return errors.Is(err, ErrAborted) }

// IsConnection reports whether err is a connection-level failure (including timeouts and aborts).
func IsConnection(err error) bool { return errors.Is(err, ErrConnection) }

// IsValidation reports whether err is a client-side validation error.
func IsValidation(err error) bool { return errors.Is(err, ErrValidation) }

// IsConfig reports whether err is a client configuration error.
func IsConfig(err error) bool { return errors.Is(err, ErrConfig) }

// IsUnsentError reports whether err (or an error it wraps) originates from this package.
func IsUnsentError(err error) bool {
	var b *BaseError
	return errors.As(err, &b)
}

// CodeOf returns the stable error code of an SDK error, or "" for other errors.
func CodeOf(err error) string {
	var b *BaseError
	if errors.As(err, &b) {
		return b.Code
	}
	return ""
}

func newConfigErr(msg string) *ConfigError {
	return &ConfigError{BaseError{Code: "invalid_config", Message: msg}}
}

func newValidationErr(msg string) *ValidationError {
	return &ValidationError{BaseError{Code: "validation_error", Message: msg}}
}

func newValidationCode(msg, code string) *ValidationError {
	return &ValidationError{BaseError{Code: code, Message: msg}}
}

func abortedError(ctx context.Context) *ConnectionError {
	var cause error
	if ctx != nil {
		cause = ctx.Err()
	}
	return &ConnectionError{BaseError{Code: "aborted", Message: "The request was aborted", Cause: cause}}
}

func timeoutError(msg string, cause error) *ConnectionError {
	return &ConnectionError{BaseError{Code: "timeout", Message: msg, Cause: cause}}
}

var hints = map[string]string{
	"invalid_api_key":      "Check that APIKey matches the API_KEY secret of your Unsent deployment.",
	"unauthorized":         "Check that APIKey matches the API_KEY secret of your Unsent deployment.",
	"invalid_signature":    "Check that APISecret matches the API_SECRET secret of your Unsent deployment (no extra whitespace).",
	"missing_signature":    "The server requires signed requests. Pass APISecret (UNSENT_API_SECRET) to the client.",
	"nonce_reused":         "A nonce was replayed. This should not happen with the SDK; check for proxies that duplicate requests.",
	"server_misconfigured": "The Unsent server is missing configuration (API_KEY, API_SECRET, SECURITY_MODE or IDEMPOTENCY_TTL_HOURS). See the server logs.",
	"unauthorized_sender":  `The "from" address or ProviderID is not an active provider. Configure it in the dashboard, or omit "from" to use the default provider.`,
	"forbidden":            "This endpoint needs an admin dashboard session; API keys cannot call it.",
}

const needSecretHint = "The server requires signed requests. Pass APISecret (UNSENT_API_SECRET) to the client."

func validCode(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-' || c == '.' || c == ':') {
			return false
		}
	}
	return true
}

// sanitizeText makes untrusted text safe for messages: valid UTF-8, no control characters.
func sanitizeText(s string) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "?")
	}
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0) {
			return ' '
		}
		return r
	}, s)
}

func truncateRunes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	i := 0
	for j := range s {
		if i == n {
			return s[:j]
		}
		i++
	}
	return s
}

type apiCtx struct {
	hasSecret  bool
	retryAfter time.Duration
	serverTime time.Time
	statusText string
	scrub      func(string) string
}

func apiErrorFromResponse(status int, body any, c apiCtx) *APIError {
	scrub := c.scrub
	if scrub == nil {
		scrub = func(s string) string { return s }
	}
	obj, _ := body.(map[string]any)
	code := ""
	if s, ok := obj["code"].(string); ok && validCode(s) {
		code = s
	}
	if code == "" {
		if status >= 500 {
			code = "internal_error"
		} else {
			code = fmt.Sprintf("http_%d", status)
		}
	}
	baseMessage := ""
	if s, ok := obj["error"].(string); ok && strings.TrimSpace(s) != "" {
		baseMessage = s
	} else if s, ok := body.(string); ok && strings.TrimSpace(s) != "" {
		baseMessage = truncateRunes(strings.TrimSpace(s), 200)
	} else if c.statusText != "" {
		baseMessage = c.statusText
	} else {
		baseMessage = fmt.Sprintf("HTTP %d", status)
	}
	baseMessage = truncateRunes(scrub(sanitizeText(baseMessage)), 500)
	reason := ""
	if s, ok := obj["reason"].(string); ok {
		reason = truncateRunes(scrub(sanitizeText(s)), 500)
	}

	hint := hints[code]
	if code == "timestamp_skew" {
		if c.hasSecret {
			hint = "Your system clock differs from the server by more than 3 minutes. Sync it (NTP)."
		} else {
			hint = needSecretHint
		}
	} else if code == "invalid_nonce" && !c.hasSecret {
		hint = needSecretHint
	}

	msg := baseMessage
	if reason != "" && !strings.Contains(baseMessage, reason) {
		msg += ": " + reason
	}
	if hint != "" {
		msg += " (" + hint + ")"
	}

	var existing int64
	if f, ok := obj["id"].(float64); ok && f >= 1 && f <= 1<<53 && f == float64(int64(f)) {
		existing = int64(f)
	}
	return &APIError{
		BaseError:       BaseError{Code: code, Message: msg, Reason: reason, Hint: hint},
		Status:          status,
		Body:            redactValue(body, scrub),
		ExistingEmailID: existing,
		RetryAfter:      c.retryAfter,
		ServerTime:      c.serverTime,
	}
}

func redactValue(v any, scrub func(string) string) any {
	switch t := v.(type) {
	case string:
		return scrub(t)
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = redactValue(x, scrub)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, x := range t {
			out[scrub(k)] = redactValue(x, scrub)
		}
		return out
	}
	return v
}
