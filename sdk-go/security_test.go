package unsent_test

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

const (
	leakKey    = "LEAK-CHECK-API-KEY-8f3a91"
	leakSecret = "LEAK-CHECK-API-SECRET-77c1d2"
)

// everything we can print about an error
func dumpErr(err error) string {
	s := err.Error() + fmt.Sprintf("|%v|%+v|%#v|%s", err, err, err, err)
	var b *unsent.BaseError
	if errors.As(err, &b) {
		s += b.Code + b.Message + b.Reason + b.Hint
		if b.Cause != nil {
			s += b.Cause.Error() + fmt.Sprintf("%#v", b.Cause)
		}
	}
	var a *unsent.APIError
	if errors.As(err, &a) {
		s += fmt.Sprintf("%#v", a.Body)
	}
	return s
}

func assertNoLeak(t *testing.T, what, s string) {
	t.Helper()
	for _, sec := range []string{leakKey, leakSecret} {
		if strings.Contains(s, sec) {
			t.Fatalf("%s leaks %q: %s", what, sec, s)
		}
	}
}

func TestNoSecretInAnyErrorEvenWhenTheServerEchoesIt(t *testing.T) {
	echo := leakKey + " / " + leakSecret
	bodies := []func(*rec) *http.Response{
		func(*rec) *http.Response { return apiErr(401, "invalid_api_key", "Bad "+echo, "reason "+echo) },
		func(*rec) *http.Response { return resp(500, "<html>"+echo+"</html>") },
		func(*rec) *http.Response {
			return jsonResp(400, map[string]any{"error": "x", "code": "validation_error", "details": []any{map[string]any{echo: echo}}})
		},
		func(r *rec) *http.Response { return resp(302, "", "Location", "https://evil.test/?k="+leakKey) },
		func(*rec) *http.Response { return resp(200, "not json "+echo) },
	}
	for i, b := range bodies {
		b := b
		e := setup(t, func(r *rec, _ int) (*http.Response, error) { return b(r), nil }, withOpts(func(o *unsent.Options) {
			o.APIKey, o.APISecret, o.MaxRetries = leakKey, leakSecret, unsent.Int(0)
		}))
		for name, call := range map[string]func() error{
			"send":   func() error { _, err := e.C.Send(bg, msg); return err },
			"status": func() error { _, err := e.C.Status(bg); return err },
			"get":    func() error { _, err := e.C.Emails.Get(bg, 1); return err },
		} {
			if err := call(); err != nil {
				assertNoLeak(t, fmt.Sprintf("body %d %s", i, name), dumpErr(err))
			}
		}
	}
}

func TestNoSecretInTransportErrors(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return nil, fmt.Errorf("proxy rejected %s with %s", leakKey, leakSecret)
	}, withOpts(func(o *unsent.Options) { o.APIKey, o.APISecret, o.MaxRetries = leakKey, leakSecret, unsent.Int(0) }))
	_, err := e.C.Send(bg, msg)
	if err == nil {
		t.Fatal("expected error")
	}
	assertNoLeak(t, "transport error", dumpErr(err))
}

func TestNoSecretInFormattedClientOrValidationErrors(t *testing.T) {
	e := setup(t, okHandler(1), withOpts(func(o *unsent.Options) { o.APIKey, o.APISecret = leakKey, leakSecret }))
	assertNoLeak(t, "client", fmt.Sprintf("%v %+v %#v %s", e.C, e.C, e.C, e.C))
	p := msg
	p.Subject = ""
	_, err := e.C.Send(bg, p)
	assertNoLeak(t, "validation", dumpErr(err))
	_, err = unsent.New(unsent.Options{BaseURL: "http://remote.example", APIKey: leakKey, APISecret: leakSecret})
	assertNoLeak(t, "config", dumpErr(err))
	_, err = unsent.New(unsent.Options{BaseURL: testBase, APIKey: leakKey + "\n\x01é", APISecret: leakSecret})
	assertNoLeak(t, "bad credentials", dumpErr(err))
}

func TestSecretOnlyInTheDocumentedHeaders(t *testing.T) {
	e := setup(t, okHandler(1), withOpts(func(o *unsent.Options) { o.APIKey, o.APISecret = leakKey, leakSecret }))
	_, _ = e.C.Send(bg, msg)
	r := e.M.Calls()[0]
	for k, vs := range r.Header {
		for _, v := range vs {
			if strings.Contains(v, leakSecret) {
				t.Fatalf("secret in header %s", k)
			}
			if strings.Contains(v, leakKey) && k != "X-Api-Key" {
				t.Fatalf("key in header %s", k)
			}
		}
	}
	if strings.Contains(string(r.Body), leakKey) || strings.Contains(string(r.Body), leakSecret) || strings.Contains(r.URL.String(), leakKey) {
		t.Fatal("credentials in body or URL")
	}
}

// rawHeaders listens, answers every request with a valid response and records the raw header block.
func rawServer(t *testing.T, handler func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, func() []http.Header) {
	t.Helper()
	var mu sync.Mutex
	var hs []http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hs = append(hs, r.Header.Clone())
		mu.Unlock()
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []http.Header { mu.Lock(); defer mu.Unlock(); return append([]http.Header(nil), hs...) }
}

func TestNoHeaderInjection(t *testing.T) {
	srv, got := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(202)
		fmt.Fprint(w, `{"id":1,"status":"queued"}`)
	})
	clearEnv(t)
	c, err := unsent.New(unsent.Options{BaseURL: srv.URL, APIKey: "k", APISecret: "s"})
	if err != nil {
		t.Fatal(err)
	}
	hostile := "x\r\nBcc: evil@x.co\r\nX-Evil: 1"
	attempts := []unsent.SendParams{
		{To: []string{"a@b.co"}, Subject: hostile, HTML: hostile, Text: hostile},
		{To: []string{"a@b.co"}, Subject: "s", HTML: "h", From: unsent.Address{Email: "a@b.co", Name: hostile}},
		{To: []string{"a@b.co" + hostile}, Subject: "s", HTML: "h"},
		{To: []string{"a@b.co"}, Subject: "s", HTML: "h", IdempotencyKey: "k\r\nX-Evil: 1"},
		{To: []string{"a@b.co"}, Subject: "s", HTML: "h", ProviderID: hostile},
		{To: []string{"a@b.co"}, Subject: "s", HTML: "h", Attachments: []unsent.Attachment{{Filename: hostile, Content: []byte("x"), ContentType: "a/b\r\nX-Evil: 1"}}},
	}
	for _, p := range attempts {
		_, _ = c.Send(bg, p)
	}
	for _, h := range got() {
		for k := range h {
			if strings.HasPrefix(strings.ToLower(k), "x-evil") || strings.EqualFold(k, "bcc") {
				t.Fatalf("injected header %q", k)
			}
		}
	}
	if len(got()) == 0 {
		t.Fatal("the hostile-but-valid subject/body send should have gone out")
	}
}

func TestRedirectsAreNeverFollowed(t *testing.T) {
	var hits atomic.Int32
	var leaked atomic.Value
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		leaked.Store(r.Header.Get("X-Api-Key"))
		fmt.Fprint(w, `{"queued":1}`)
	}))
	defer target.Close()
	redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer redir.Close()
	clearEnv(t)
	for name, o := range map[string]unsent.Options{
		"default client":      {BaseURL: redir.URL, APIKey: "secret-key", APISecret: "s"},
		"user http.Client":    {BaseURL: redir.URL, APIKey: "secret-key", APISecret: "s", HTTPClient: &http.Client{}},
		"user client w/ jar":  {BaseURL: redir.URL, APIKey: "secret-key", APISecret: "s", HTTPClient: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return nil }}},
		"user transport only": {BaseURL: redir.URL, APIKey: "secret-key", Transport: http.DefaultTransport},
	} {
		c, err := unsent.New(o)
		if err != nil {
			t.Fatal(err)
		}
		_, err1 := c.Status(bg)
		_, err2 := c.Send(bg, msg)
		for _, err := range []error{err1, err2} {
			if unsent.CodeOf(err) != "unexpected_redirect" {
				t.Fatalf("%s: %v", name, err)
			}
		}
		if hits.Load() != 0 {
			t.Fatalf("%s: redirect target was contacted (key=%v)", name, leaked.Load())
		}
	}
}

func TestPlainHTTPToRemoteHostsRejected(t *testing.T) {
	clearEnv(t)
	for _, u := range []string{"http://example.com", "http://10.0.0.1", "http://192.168.1.5:8787", "http://[2001:db8::1]", "http://unsent.localhost.evil.com", "http://0.0.0.0", "http://localhost.", "http://[::ffff:127.0.0.1]", "http://127.1"} {
		if _, err := unsent.New(unsent.Options{BaseURL: u, APIKey: "k"}); err == nil {
			t.Errorf("%s accepted", u)
		}
	}
}

func TestPathologicalInputsFinishQuickly(t *testing.T) {
	huge := strings.Repeat("<", 100_000)
	cases := map[string]string{
		"angles":   huge,
		"quotes":   strings.Repeat(`"`, 100_000),
		"mixed":    strings.Repeat(`"a<`, 40_000),
		"spaces":   strings.Repeat(" ", 100_000) + "x",
		"at":       strings.Repeat("a@", 50_000),
		"nearname": `"` + strings.Repeat("a", 100_000) + `" <` + strings.Repeat("b", 100_000),
		"b64":      strings.Repeat("A", 99_999) + "!",
		"b64ws":    strings.Repeat("A \n", 33_333) + "=",
		"b64pad":   strings.Repeat("=", 100_000),
	}
	e := setup(t, okHandler(1))
	for name, in := range cases {
		start := time.Now()
		_, _ = unsent.ParseAddress(in)
		_, _ = e.C.Send(bg, unsent.SendParams{From: unsent.Addr(in), To: []string{in}, Subject: "s", HTML: "h"})
		_, _ = e.C.Send(bg, unsent.SendParams{To: []string{"a@b.co"}, Subject: in, HTML: "h", Attachments: []unsent.Attachment{{Filename: "a", Base64: in}}})
		unsent.NormalizeBase64(in)
		_, _, _ = unsent.NormalizeBaseURL("https://" + in)
		if d := time.Since(start); d > time.Second {
			t.Errorf("%s took %v", name, d)
		}
	}
}

// A stalled TCP peer that accepts and never answers must not hang the client past its timeout.
func TestSilentPeerTimesOut(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { _, _ = bufio.NewReader(c).Discard(1 << 20); c.Close() }()
		}
	}()
	clearEnv(t)
	c, _ := unsent.New(unsent.Options{BaseURL: "http://" + ln.Addr().String(), APIKey: "k", Timeout: 150 * time.Millisecond, MaxRetries: unsent.Int(0)})
	start := time.Now()
	_, err = c.Status(bg)
	if !unsent.IsTimeout(err) || time.Since(start) > 3*time.Second {
		t.Fatalf("%v after %v", err, time.Since(start))
	}
}
