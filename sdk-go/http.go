package unsent

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	mrand "math/rand"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	maxBackoff         = 8 * time.Second
	baseBackoff        = 500 * time.Millisecond
	maxRetryAfter      = 60 * time.Second
	minClockCorrection = 30 * time.Second
	maxResponseBytes   = 32 << 20
	minScrubLen        = 8
)

type httpClient struct {
	baseURL    string
	host       string
	apiKey     string
	apiSecret  string
	timeout    time.Duration
	maxRetries int
	client     *http.Client

	// clockOffsetMs is the server clock minus the local clock, learned from a timestamp_skew response.
	clockOffsetMs atomic.Int64

	// Test hooks (see export_test.go).
	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration) error
	rnd   func() float64
}

type callOp struct {
	method     string
	path       string
	query      url.Values
	body       []byte
	sign       bool
	noAuth     bool
	retrySafe  bool
	timeout    time.Duration
	maxRetries int
}

type callResult struct {
	status int
	header http.Header
	data   any
}

// Format implements fmt.Formatter so credentials never leak through fmt.
func (h *httpClient) Format(f fmt.State, _ rune) { _, _ = fmt.Fprint(f, "unsent.httpClient") }

func noRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

func defaultSleep(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *httpClient) scrub(s string) string {
	for _, sec := range []string{h.apiSecret, h.apiKey} {
		if len(sec) >= minScrubLen {
			s = strings.ReplaceAll(s, sec, "[redacted]")
		}
	}
	return s
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", &BaseError{Code: "entropy_unavailable", Message: "could not read secure random bytes", Cause: err}
	}
	return hex.EncodeToString(b), nil
}

func newUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", &BaseError{Code: "entropy_unavailable", Message: "could not read secure random bytes", Cause: err}
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], nil
}

// signRequest is HMAC-SHA256(secret, timestamp "\n" nonce "\n" sha256hex(body)) as lowercase hex.
func signRequest(secret, timestamp, nonce string, body []byte) string {
	sum := sha256.Sum256(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "\n" + nonce + "\n" + hex.EncodeToString(sum[:])))
	return hex.EncodeToString(mac.Sum(nil))
}

func parseRetryAfter(header string, now time.Time) time.Duration {
	header = strings.TrimSpace(header)
	if header == "" {
		return 0
	}
	if secs, err := strconv.ParseFloat(header, 64); err == nil && !math.IsNaN(secs) && !math.IsInf(secs, 0) && secs >= 0 {
		return minDur(time.Duration(math.Min(secs, 1e6)*float64(time.Second)), maxRetryAfter)
	}
	if t, err := http.ParseTime(header); err == nil {
		d := t.Sub(now)
		if d < 0 {
			d = 0
		}
		return minDur(d, maxRetryAfter)
	}
	return 0
}

func minDur(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func isRetryableStatus(e *APIError) bool {
	if e.Code == "server_misconfigured" {
		return false
	}
	s := e.Status
	return s == 408 || s == 425 || s == 429 || (s >= 500 && s != 501 && s != 505)
}

func (h *httpClient) backoff(attempt int) time.Duration {
	if attempt > 20 {
		attempt = 20
	}
	exp := baseBackoff << uint(attempt)
	if exp > maxBackoff || exp <= 0 {
		exp = maxBackoff
	}
	r := h.rnd
	if r == nil {
		r = mrand.Float64
	}
	return time.Duration(float64(exp)/2 + r()*float64(exp)/2)
}

func (h *httpClient) nowFn() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

func (h *httpClient) sleepFn(ctx context.Context, d time.Duration) error {
	if h.sleep != nil {
		return h.sleep(ctx, d)
	}
	return defaultSleep(ctx, d)
}

// call performs a request with retries, clock-skew correction and cancellation.
func (h *httpClient) call(ctx context.Context, op *callOp) (*callResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	attempt := 0
	clockCorrected := false
	for {
		if ctx.Err() != nil {
			return nil, abortedError(ctx)
		}
		res, err := h.attempt(ctx, op, op.timeout)
		if err == nil {
			return res, nil
		}
		if ctx.Err() != nil {
			return nil, abortedError(ctx)
		}
		var apiErr *APIError
		var connErr *ConnectionError
		isAPI := errors.As(err, &apiErr)
		isConn := errors.As(err, &connErr)
		if !isAPI && !isConn {
			return nil, err // non-retryable SDK error (redirect, invalid_response, ...)
		}

		// A skewed local clock fails signature checks before the nonce is consumed, so one
		// corrected retry is free and always safe.
		if !clockCorrected && isAPI && apiErr.Code == "timestamp_skew" && h.apiSecret != "" {
			clockCorrected = true
			if h.syncClock(ctx, apiErr) {
				continue
			}
			if ctx.Err() != nil {
				return nil, abortedError(ctx)
			}
		}

		var delay time.Duration
		retry := false
		if attempt < op.maxRetries && op.retrySafe {
			if isConn && connErr.Code != "aborted" {
				retry, delay = true, h.backoff(attempt)
			} else if isAPI && isRetryableStatus(apiErr) {
				retry, delay = true, h.backoff(attempt)
				if apiErr.RetryAfter > delay {
					delay = apiErr.RetryAfter
				}
			}
		}
		if !retry {
			return nil, err
		}
		attempt++
		if serr := h.sleepFn(ctx, delay); serr != nil {
			return nil, abortedError(ctx)
		}
	}
}

// syncClock learns the server clock from the error's Date header or, failing that, GET /api/health.
func (h *httpClient) syncClock(ctx context.Context, apiErr *APIError) bool {
	var serverMs, localMs int64
	if !apiErr.ServerTime.IsZero() {
		serverMs = apiErr.ServerTime.UnixMilli()
		localMs = h.nowFn().UnixMilli()
	} else {
		before := h.nowFn().UnixMilli()
		res, err := h.attempt(ctx, &callOp{method: "GET", path: "/api/health", noAuth: true}, minDur(h.timeout, 5*time.Second))
		after := h.nowFn().UnixMilli()
		if err != nil {
			return false
		}
		m := asMap(res.data)
		f, ok := m["timestamp"].(float64)
		if !ok || math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > 1e15 {
			return false
		}
		serverMs = int64(f)
		localMs = (before + after) / 2
	}
	offset := serverMs - localMs
	if time.Duration(absInt64(offset))*time.Millisecond < minClockCorrection {
		// The local clock is fine now. If we were compensating for an earlier skew, drop the stale offset.
		if h.clockOffsetMs.Load() == 0 {
			return false
		}
		h.clockOffsetMs.Store(0)
		return true
	}
	h.clockOffsetMs.Store(offset)
	return true
}

func absInt64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

// safeCause drops an underlying error whose text contains a credential, keeping only its scrubbed text.
func (h *httpClient) safeCause(err error) error {
	if err == nil {
		return nil
	}
	if msg := err.Error(); h.scrub(msg) != msg {
		return errors.New(h.scrub(msg))
	}
	return err
}

func (h *httpClient) classifyTransport(ctx, actx context.Context, op *callOp, timeout time.Duration, err error, reading bool) error {
	err = h.safeCause(err)
	if ctx.Err() != nil {
		return abortedError(ctx)
	}
	timedOut := actx.Err() != nil
	if !timedOut {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			timedOut = true
		}
	}
	if timedOut {
		return timeoutError(fmt.Sprintf("Request to %s timed out after %s", op.path, timeout), err)
	}
	if reading {
		return &ConnectionError{BaseError{Code: "connection_error", Message: "Connection dropped while reading the response from " + op.path, Cause: err}}
	}
	detail := err
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		detail = ue.Err
	}
	msg := fmt.Sprintf("Could not reach %s: %s", h.host, truncateRunes(h.scrub(sanitizeText(detail.Error())), 300))
	return &ConnectionError{BaseError{Code: "connection_error", Message: msg, Cause: err}}
}

func (h *httpClient) attempt(ctx context.Context, op *callOp, timeout time.Duration) (*callResult, error) {
	target := h.baseURL + op.path
	if len(op.query) > 0 {
		target += "?" + op.query.Encode()
	}
	actx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var body io.Reader
	if op.body != nil {
		body = bytes.NewReader(op.body)
	}
	req, err := http.NewRequestWithContext(actx, op.method, target, body)
	if err != nil {
		return nil, &BaseError{Code: "invalid_request", Message: "could not build the request: " + truncateRunes(h.scrub(sanitizeText(err.Error())), 200)}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "unsent-sdk-go/"+Version)
	if !op.noAuth {
		req.Header.Set("X-API-Key", h.apiKey)
	}
	if op.body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if op.sign && h.apiSecret != "" {
		// Fresh timestamp + nonce on every attempt: the server rejects reused nonces.
		ts := strconv.FormatInt((h.nowFn().UnixMilli()+h.clockOffsetMs.Load())/1000, 10)
		nonce, nerr := randomHex(16)
		if nerr != nil {
			return nil, nerr
		}
		req.Header.Set("X-Timestamp", ts)
		req.Header.Set("X-Nonce", nonce)
		req.Header.Set("X-Signature", "sha256="+signRequest(h.apiSecret, ts, nonce, op.body))
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, h.classifyTransport(ctx, actx, op, timeout, err, false)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		loc := ""
		if l := resp.Header.Get("Location"); l != "" {
			loc = " to " + truncateRunes(h.scrub(sanitizeText(l)), 200)
		}
		hint := ""
		if strings.HasPrefix(h.baseURL, "http://") {
			hint = " (use https://)"
		}
		return nil, &BaseError{
			Code: "unexpected_redirect",
			Message: fmt.Sprintf("%s was redirected%s. The SDK does not follow redirects because that would send your API key to another host. Set BaseURL to the final URL%s.",
				op.path, loc, hint),
		}
	}
	if resp.ContentLength > maxResponseBytes {
		return nil, &BaseError{Code: "response_too_large", Message: fmt.Sprintf("The response from %s is larger than %d MiB", op.path, maxResponseBytes>>20)}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, h.classifyTransport(ctx, actx, op, timeout, err, true)
	}
	if len(data) > maxResponseBytes {
		return nil, &BaseError{Code: "response_too_large", Message: fmt.Sprintf("The response from %s is larger than %d MiB", op.path, maxResponseBytes>>20)}
	}

	var parsed any = string(data)
	isJSON := false
	if len(data) > 0 {
		var v any
		if json.Unmarshal(data, &v) == nil {
			parsed, isJSON = v, true
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var serverTime time.Time
		if d := resp.Header.Get("Date"); d != "" {
			if t, perr := http.ParseTime(d); perr == nil {
				serverTime = t
			}
		}
		body := parsed
		if !isJSON {
			body = string(data)
		}
		return nil, apiErrorFromResponse(resp.StatusCode, body, apiCtx{
			hasSecret:  h.apiSecret != "",
			retryAfter: parseRetryAfter(resp.Header.Get("Retry-After"), h.nowFn()),
			serverTime: serverTime,
			statusText: http.StatusText(resp.StatusCode),
			scrub:      h.scrub,
		})
	}
	if !isJSON {
		return nil, &BaseError{
			Code:    "invalid_response",
			Message: fmt.Sprintf("Unexpected non-JSON response from %s (HTTP %d). Is BaseURL pointing at your Unsent deployment?", op.path, resp.StatusCode),
		}
	}
	return &callResult{status: resp.StatusCode, header: resp.Header, data: parsed}, nil
}
