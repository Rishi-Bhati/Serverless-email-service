package unsent_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

const (
	testBase   = "https://unsent.test"
	testKey    = "test-api-key"
	testSecret = "test-api-secret"
)

var t0 = time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

type rec struct {
	Method string
	URL    *url.URL
	Header http.Header
	Body   []byte
	JSON   map[string]any
	Ctx    context.Context
}

type handlerFn func(r *rec, n int) (*http.Response, error)

type mockRT struct {
	mu    sync.Mutex
	calls []*rec
	h     handlerFn
}

func (m *mockRT) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
		req.Body.Close()
	}
	r := &rec{Method: req.Method, URL: req.URL, Header: req.Header.Clone(), Body: body, Ctx: req.Context()}
	if len(body) > 0 {
		_ = json.Unmarshal(body, &r.JSON)
	}
	m.mu.Lock()
	m.calls = append(m.calls, r)
	n := len(m.calls)
	m.mu.Unlock()
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	resp, err := m.h(r, n)
	if resp != nil {
		resp.Request = req
	}
	return resp, err
}

func (m *mockRT) Calls() []*rec {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]*rec(nil), m.calls...)
}

func (m *mockRT) N() int { return len(m.Calls()) }

func (m *mockRT) Paths() []string {
	var out []string
	for _, c := range m.Calls() {
		out = append(out, c.URL.Path)
	}
	return out
}

func hang(r *rec) (*http.Response, error) {
	<-r.Ctx.Done()
	return nil, r.Ctx.Err()
}

func resp(status int, body string, hdr ...string) *http.Response {
	h := http.Header{}
	for i := 0; i+1 < len(hdr); i += 2 {
		h.Set(hdr[i], hdr[i+1])
	}
	return &http.Response{
		StatusCode: status, Status: strconv.Itoa(status) + " " + http.StatusText(status),
		Header: h, Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body)),
	}
}

func jsonResp(status int, v any, hdr ...string) *http.Response {
	b, _ := json.Marshal(v)
	return resp(status, string(b), append([]string{"Content-Type", "application/json"}, hdr...)...)
}

func accepted(id int, extra ...map[string]any) *http.Response {
	m := map[string]any{
		"success": true, "id": id, "status": "queued", "idempotent_replay": false,
		"message": "Email successfully queued for sending", "targetProvider": "Automatic Priority / Default",
	}
	for _, e := range extra {
		for k, v := range e {
			m[k] = v
		}
	}
	return jsonResp(202, m)
}

func apiErr(status int, code, errText, reason string, hdr ...string) *http.Response {
	m := map[string]any{"error": errText, "code": code}
	if reason != "" {
		m["reason"] = reason
	}
	return jsonResp(status, m, hdr...)
}

// fakeClock is a virtual clock whose sleeps return immediately but advance time.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	sleeps []time.Duration
}

func newFakeClock() *fakeClock { return &fakeClock{now: t0} }

func (f *fakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

func (f *fakeClock) Sleep(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f.mu.Lock()
	f.sleeps = append(f.sleeps, d)
	f.now = f.now.Add(d)
	f.mu.Unlock()
	return nil
}

func (f *fakeClock) Sleeps() []time.Duration {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]time.Duration(nil), f.sleeps...)
}

type testEnv struct {
	C     *unsent.Client
	M     *mockRT
	Clock *fakeClock
}

type optFn func(*unsent.Options)

func withOpts(f func(*unsent.Options)) optFn { return f }

// clearEnv makes sure the process environment does not leak into construction.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{"UNSENT_BASE_URL", "UNSENT_API_KEY", "UNSENT_API_SECRET"} {
		t.Setenv(k, "")
	}
}

// setup builds a signed client over a mock transport with a fake clock/sleeper.
func setup(t *testing.T, h handlerFn, mods ...optFn) *testEnv {
	t.Helper()
	clearEnv(t)
	m := &mockRT{h: h}
	o := unsent.Options{BaseURL: testBase, APIKey: testKey, APISecret: testSecret, Transport: m}
	for _, f := range mods {
		f(&o)
	}
	c, err := unsent.New(o)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	fc := newFakeClock()
	c.SetClock(fc.Now)
	c.SetSleep(fc.Sleep)
	return &testEnv{C: c, M: m, Clock: fc}
}

func okHandler(id int) handlerFn {
	return func(*rec, int) (*http.Response, error) { return accepted(id), nil }
}

var msg = unsent.SendParams{To: []string{"a@b.co"}, Subject: "s", HTML: "h"}

var nonceRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,128}$`)

// verifySigned is an independent re-implementation of the server's checks (src/auth.ts, `full` mode,
// no routing headers) on top of the raw wire bytes.
func verifySigned(r *rec, now time.Time, used map[string]bool) (bool, string) {
	if r.Header.Get("X-API-Key") != testKey {
		return false, "invalid_api_key"
	}
	ts := r.Header.Get("X-Timestamp")
	tsn, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || strings.TrimLeft(ts, "0123456789") != "" {
		return false, "timestamp_skew"
	}
	d := float64(now.UnixMilli())/1000 - float64(tsn)
	if d > 180 || d < -180 {
		return false, "timestamp_skew"
	}
	nonce := r.Header.Get("X-Nonce")
	if !nonceRE.MatchString(nonce) {
		return false, "invalid_nonce"
	}
	sig := strings.ToLower(strings.TrimPrefix(r.Header.Get("X-Signature"), "sha256="))
	bh := sha256.Sum256(r.Body)
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(ts + "\n" + nonce + "\n" + hex.EncodeToString(bh[:])))
	if sig != hex.EncodeToString(mac.Sum(nil)) {
		return false, "invalid_signature"
	}
	if used != nil {
		if used[nonce] {
			return false, "nonce_reused"
		}
		used[nonce] = true
	}
	if r.Header.Get("X-Provider-Id") != "" || r.Header.Get("X-Sender-Email") != "" || r.Header.Get("Idempotency-Key") != "" {
		return false, "invalid_signature"
	}
	return true, ""
}

func mustErr[T any](t *testing.T, v T, err error) error {
	t.Helper()
	if err == nil {
		t.Fatalf("expected an error, got %#v", v)
	}
	return err
}

func asAPI(t *testing.T, err error) *unsent.APIError {
	t.Helper()
	var a *unsent.APIError
	if !errors.As(err, &a) {
		t.Fatalf("want *APIError, got %T: %v", err, err)
	}
	return a
}

func asBase(t *testing.T, err error) *unsent.BaseError {
	t.Helper()
	var b *unsent.BaseError
	if !errors.As(err, &b) {
		t.Fatalf("want an SDK error, got %T: %v", err, err)
	}
	return b
}

func eq(t *testing.T, got, want any, what string) {
	t.Helper()
	gb, _ := json.Marshal(got)
	wb, _ := json.Marshal(want)
	if !bytes.Equal(gb, wb) {
		t.Fatalf("%s: got %s, want %s", what, gb, wb)
	}
}

func contains(t *testing.T, s, sub string) {
	t.Helper()
	if !strings.Contains(s, sub) {
		t.Fatalf("%q does not contain %q", s, sub)
	}
}

func matches(t *testing.T, s, re string) {
	t.Helper()
	if !regexp.MustCompile(re).MatchString(s) {
		t.Fatalf("%q does not match /%s/", s, re)
	}
}

func errorsAs[T error](err error, target *T) bool { return errors.As(err, target) }
