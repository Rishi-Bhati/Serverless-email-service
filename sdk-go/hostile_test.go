package unsent_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func hostileClient(t *testing.T, h http.HandlerFunc, mods ...optFn) (*unsent.Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	clearEnv(t)
	o := unsent.Options{BaseURL: srv.URL, APIKey: "k", APISecret: "s", Timeout: 2 * time.Second, MaxRetries: unsent.Int(0)}
	for _, m := range mods {
		m(&o)
	}
	c, err := unsent.New(o)
	if err != nil {
		t.Fatal(err)
	}
	return c, srv
}

func callAll(c *unsent.Client) []error {
	var errs []error
	add := func(err error) { errs = append(errs, err) }
	_, err := c.Send(bg, msg)
	add(err)
	_, err = c.Status(bg)
	add(err)
	_, err = c.Health(bg)
	add(err)
	_, err = c.Emails.Get(bg, 1)
	add(err)
	_, err = c.Emails.List(bg, nil)
	add(err)
	return errs
}

func mustBeSDKError(t *testing.T, what string, errs []error) {
	t.Helper()
	for i, err := range errs {
		if err != nil && !unsent.IsUnsentError(err) {
			t.Errorf("%s call %d returned a non-SDK error %T: %v", what, i, err, err)
		}
	}
}

func TestHostileBodies(t *testing.T) {
	bodies := []string{
		"", "null", "[]", "{}", "5", `"x"`, "true", "{", `{"a":`, "\x00\x01\x02", "\xff\xfe\xfd", strings.Repeat("[", 100_000),
		strings.Repeat(`{"a":`, 50_000), `{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}},"id":1,"status":"queued"}`,
		`{"id":"abc","status":{"a":1}}`, `{"id":1e999}`, `{"id":-1}`, `{"id":9e18,"status":"sent"}`, `{"emails":"nope","total":"x"}`,
		`{"emails":[1,"a",null,[],{"to":5,"attachments":{"a":1},"cc":"x","created_at":"zzz","failover_history":{"a":1}}],"total":1e30,"offset":-5}`,
		`{"email":{"id":[1],"to":{"a":1},"attachments":[{"content":5},null,{"size":"x"}],"created_at":1e308}}`,
		`{"queued":"1","sending":[],"sent":null,"failed":1e400}`, `{"timestamp":"now","status":5}`,
		`{"error":{"nested":true},"code":["x"],"reason":5}`, `{"error":"` + strings.Repeat("A", 1<<20) + `"}`,
	}
	for i, b := range bodies {
		for _, status := range []int{200, 202, 400, 401, 404, 409, 429, 500, 503} {
			b, status := b, status
			c, _ := hostileClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				io.WriteString(w, b)
			})
			errs := callAll(c)
			mustBeSDKError(t, fmt.Sprintf("body %d status %d", i, status), errs)
		}
	}
}

func TestHostileHeaders(t *testing.T) {
	c, _ := hostileClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "99999999999999999999999999")
		w.Header().Add("Date", "not a date")
		w.WriteHeader(503)
		io.WriteString(w, `{"error":"x"}`)
	}, withOpts(func(o *unsent.Options) { o.MaxRetries = unsent.Int(0) }))
	start := time.Now()
	errs := callAll(c)
	mustBeSDKError(t, "headers", errs)
	if time.Since(start) > 5*time.Second {
		t.Fatal("too slow")
	}
	a := asAPI(t, errs[0])
	if a.RetryAfter != 60*time.Second {
		t.Fatalf("giant Retry-After must be capped at 60s, got %v", a.RetryAfter)
	}
}

func TestGiantRetryAfterIsCappedOnTheRetryPath(t *testing.T) {
	e := setup(t, func(_ *rec, n int) (*http.Response, error) {
		if n == 1 {
			return apiErr(503, "x", "x", "", "Retry-After", "86400"), nil
		}
		return accepted(1), nil
	})
	if _, err := e.C.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	if s := e.Clock.Sleeps(); len(s) != 1 || s[0] != 60*time.Second {
		t.Fatalf("sleeps %v", s)
	}
}

func TestNeverEndingBodyIsCapped(t *testing.T) {
	c, _ := hostileClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		chunk := bytes.Repeat([]byte("a"), 1<<20)
		for {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}, withOpts(func(o *unsent.Options) { o.Timeout = 20 * time.Second }))
	start := time.Now()
	_, err := c.Status(bg)
	if unsent.CodeOf(err) != "response_too_large" {
		t.Fatalf("%v", err)
	}
	if time.Since(start) > 15*time.Second {
		t.Fatal("slow")
	}
}

func TestAnnouncedHugeBodyRejectedUpFront(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				buf := make([]byte, 4096)
				conn.Read(buf)
				fmt.Fprint(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 40000000\r\n\r\n{")
				time.Sleep(3 * time.Second) // never sends the rest
			}()
		}
	}()
	clearEnv(t)
	c, _ := unsent.New(unsent.Options{BaseURL: "http://" + ln.Addr().String(), APIKey: "k", Timeout: 5 * time.Second, MaxRetries: unsent.Int(0)})
	start := time.Now()
	_, err = c.Status(bg)
	if unsent.CodeOf(err) != "response_too_large" || time.Since(start) > 2*time.Second {
		t.Fatalf("%v after %v", err, time.Since(start))
	}
}

func TestGzipBombIsCapped(t *testing.T) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zero := make([]byte, 1<<20)
	for i := 0; i < 80; i++ {
		zw.Write(zero)
	}
	zw.Close()
	c, _ := hostileClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Type", "application/json")
		w.Write(buf.Bytes())
	})
	_, err := c.Status(bg)
	if unsent.CodeOf(err) != "response_too_large" {
		t.Fatalf("%v", err)
	}
}

func TestTricklingBodyHitsTheTimeout(t *testing.T) {
	c, _ := hostileClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		fl := w.(http.Flusher)
		for i := 0; i < 100; i++ {
			if _, err := io.WriteString(w, " "); err != nil {
				return
			}
			fl.Flush()
			time.Sleep(50 * time.Millisecond)
		}
	}, withOpts(func(o *unsent.Options) { o.Timeout = 300 * time.Millisecond }))
	start := time.Now()
	_, err := c.Status(bg)
	if !unsent.IsTimeout(err) || time.Since(start) > 3*time.Second {
		t.Fatalf("%v after %v", err, time.Since(start))
	}
}

func TestTruncatedBodyIsAConnectionErrorAndRetried(t *testing.T) {
	var calls int
	c, _ := hostileClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Header().Set("Content-Length", "100")
			io.WriteString(w, `{"queued":`)
			return // handler returns with a short body: connection is torn down
		}
		io.WriteString(w, `{"queued":1,"sending":0,"sent":0,"failed":0}`)
	}, withOpts(func(o *unsent.Options) { o.MaxRetries = unsent.Int(2) }))
	c.SetSleep(func(ctx context.Context, d time.Duration) error { return ctx.Err() })
	s, err := c.Status(bg)
	if err != nil || s.Queued != 1 || calls != 2 {
		t.Fatalf("%v %v calls=%d", err, s, calls)
	}
}

func TestServerThatDropsTheConnection(t *testing.T) {
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
			c.Close()
		}
	}()
	clearEnv(t)
	c, _ := unsent.New(unsent.Options{BaseURL: "http://" + ln.Addr().String(), APIKey: "k", APISecret: "s", MaxRetries: unsent.Int(0)})
	mustBeSDKError(t, "dropped", callAll(c))
	for _, err := range callAll(c) {
		if !unsent.IsConnection(err) {
			t.Fatalf("%v", err)
		}
	}
}

// ---- seeded junk into every public method ---------------------------------------------------

func junkString(r *rand.Rand) string {
	pool := []string{
		"", " ", "\t", "\r\n", "\x00", "a", "a@b.co", "A <a@b.co>", `"A, B" <a@b.co>`, "<>", "<a@b>", "@", "a@", "@b",
		"a@b.co\r\nBcc: x@y.z", "ünïcödé@exämple.com", "日本語@例え.jp", "😀@😀.tld", "\xff\xfe", "a\xc3", "‮", " ",
		"nil", "null", "undefined", "__proto__", "constructor", "../../etc/passwd", "%00", "%0d%0a", "{{7*7}}", "' OR 1=1 --", "<script>alert(1)</script>",
		"QQ==", "QQ=", "====", "A===", "aGVsbG8=", "aGVs\nbG8=", "12345678901234567890", "-1", "1e999", "NaN", "0x10",
		"https://x.test", "Name <", "> <", "\"\"", "\"\" <>", strings.Repeat("a", 300), strings.Repeat("é", 200), strings.Repeat("😀", 200),
	}
	switch r.Intn(10) {
	case 0:
		return strings.Repeat(pool[r.Intn(len(pool))], r.Intn(5000)+1)
	case 1:
		b := make([]byte, r.Intn(64))
		r.Read(b)
		return string(b)
	case 2:
		return pool[r.Intn(len(pool))] + pool[r.Intn(len(pool))]
	}
	return pool[r.Intn(len(pool))]
}

func junkList(r *rand.Rand) []string {
	switch r.Intn(6) {
	case 0:
		return nil
	case 1:
		return []string{}
	case 2:
		n := r.Intn(130)
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("u%d@x.co", i)
		}
		return out
	}
	out := make([]string, r.Intn(4)+1)
	for i := range out {
		out[i] = junkString(r)
	}
	return out
}

func junkInt(r *rand.Rand) int {
	pool := []int{0, 1, -1, 2, 100, 200, 201, 1 << 31, -(1 << 31), int(^uint(0) >> 1), -int(^uint(0)>>1) - 1}
	if r.Intn(2) == 0 {
		return pool[r.Intn(len(pool))]
	}
	return r.Intn(400) - 100
}

func junkAttachment(r *rand.Rand) unsent.Attachment {
	a := unsent.Attachment{Filename: junkString(r), ContentType: junkString(r)}
	switch r.Intn(5) {
	case 0:
		a.Content = []byte(junkString(r))
	case 1:
		a.Base64 = junkString(r)
	case 2:
		a.Reader = strings.NewReader(junkString(r))
	case 3:
		a.Content, a.Base64 = []byte("x"), "QQ=="
	}
	return a
}

// checkWire asserts invariants of anything that reaches the network.
func checkWire(t *testing.T, e *testEnv) {
	for _, c := range e.M.Calls() {
		if c.URL.Path != "/api/send" {
			continue
		}
		if ok, code := verifySigned(c, e.Clock.Now(), nil); !ok {
			t.Fatalf("bad signature on a sent request: %s", code)
		}
		if c.JSON == nil {
			t.Fatalf("body is not a JSON object: %q", c.Body)
		}
		for _, f := range []string{"to", "cc", "bcc"} {
			if arr, ok := c.JSON[f].([]any); ok {
				for _, a := range arr {
					if s, _ := a.(string); strings.ContainsAny(s, "\r\n\x00") || !strings.Contains(s, "@") {
						t.Fatalf("unvalidated recipient %q", s)
					}
				}
			}
		}
		if s, _ := c.JSON["subject"].(string); strings.TrimSpace(s) == "" || len(c.Body) > 3<<20 {
			t.Fatalf("invalid subject / oversized body")
		}
		for k, v := range c.JSON {
			if v == nil {
				t.Fatalf("null field %s", k)
			}
		}
	}
}

func TestSeededJunkIntoEveryPublicMethod(t *testing.T) {
	r := rand.New(rand.NewSource(20260601))
	e := setup(t, okHandler(1))
	e.C.SetRand(func() float64 { return 0 })
	check := func(what string, err error) {
		t.Helper()
		if err != nil && !unsent.IsUnsentError(err) {
			t.Fatalf("%s returned a non-SDK error %T: %v", what, err, err)
		}
	}
	ctx := bg
	for i := 0; i < 4000; i++ {
		p := unsent.SendParams{
			From:       unsent.Address{Email: junkString(r), Name: junkString(r)},
			To:         junkList(r),
			CC:         junkList(r),
			BCC:        junkList(r),
			Subject:    junkString(r),
			HTML:       junkString(r),
			Text:       junkString(r),
			ProviderID: junkString(r),
		}
		if r.Intn(2) == 0 {
			p.From = unsent.Address{}
		}
		if r.Intn(3) == 0 {
			p.To = []string{"ok@x.co"}
			p.Subject = "s"
			if r.Intn(2) == 0 {
				p.HTML = "<p>h</p>"
			}
		}
		if r.Intn(3) == 0 {
			p.IdempotencyKey = junkString(r)
		}
		p.NoIdempotency = r.Intn(10) == 0
		for n := r.Intn(4); n > 0; n-- {
			p.Attachments = append(p.Attachments, junkAttachment(r))
		}
		if r.Intn(40) == 0 {
			for n := 0; n < 25; n++ {
				p.Attachments = append(p.Attachments, junkAttachment(r))
			}
		}
		_, err := e.C.Send(ctx, p, junkCallOpts(r)...)
		check("Send", err)

		_, err = e.C.Emails.Get(ctx, int64(junkInt(r))*int64(junkInt(r)+1))
		check("Get", err)

		lp := &unsent.ListParams{
			Limit: junkInt(r), Offset: junkInt(r), Status: unsent.EmailStatus(junkString(r)), Search: junkString(r),
			From: junkString(r), To: junkString(r), Sort: unsent.Sort(junkString(r)),
		}
		if r.Intn(4) == 0 {
			lp = nil
		}
		_, err = e.C.Emails.List(ctx, lp, junkCallOpts(r)...)
		check("List", err)
		it := e.C.Emails.Iterate(ctx, lp, junkCallOpts(r)...)
		for k := 0; k < 3 && it.Next(ctx); k++ {
		}
		check("Iterate", it.Err())

		_, err = unsent.ParseAddress(junkString(r))
		check("ParseAddress", err)
		_, err = e.C.Status(ctx, junkCallOpts(r)...)
		check("Status", err)
		_, err = e.C.Health(ctx, junkCallOpts(r)...)
		check("Health", err)
	}
	checkWire(t, e)
	if e.M.N() == 0 {
		t.Fatal("junk generator never produced a valid request; widen it")
	}
}

func junkCallOpts(r *rand.Rand) []unsent.CallOption {
	var o []unsent.CallOption
	switch r.Intn(6) {
	case 0:
		o = append(o, unsent.WithTimeout(time.Duration(junkInt(r))*time.Millisecond))
	case 1:
		o = append(o, unsent.WithMaxRetries(junkInt(r)))
	case 2:
		o = append(o, nil)
	}
	return o
}

func TestSeededJunkWait(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	e := setup(t, waitHandler(map[string]any{"status": "queued", "attempts": 0}))
	for i := 0; i < 300; i++ {
		w := &unsent.WaitOptions{Timeout: time.Duration(r.Intn(20000)-2000) * time.Millisecond, Interval: time.Duration(r.Intn(8000)-1000) * time.Millisecond}
		_, err := e.C.Emails.Wait(bg, int64(r.Intn(5)), w)
		if err == nil || !unsent.IsUnsentError(err) {
			t.Fatalf("%v", err)
		}
	}
}

func TestSeededJunkConstruction(t *testing.T) {
	r := rand.New(rand.NewSource(99))
	clearEnv(t)
	for i := 0; i < 4000; i++ {
		o := unsent.Options{
			BaseURL: junkString(r), APIKey: junkString(r), APISecret: junkString(r),
			DefaultFrom: unsent.Address{Email: junkString(r), Name: junkString(r)}, DefaultProviderID: junkString(r),
			Timeout: time.Duration(junkInt(r)), Transport: okRT(),
		}
		if r.Intn(2) == 0 {
			o.MaxRetries = unsent.Int(junkInt(r))
		}
		if r.Intn(3) == 0 {
			o.BaseURL = "https://" + junkString(r)
		}
		if r.Intn(4) == 0 {
			o.APIKey = "key"
		}
		c, err := unsent.New(o)
		if err != nil {
			if !unsent.IsConfig(err) {
				t.Fatalf("construction returned %T: %v", err, err)
			}
			continue
		}
		_ = c.String()
	}
}

// random JSON documents as server responses
func randJSON(r *rand.Rand, depth int) any {
	keys := []string{"emails", "email", "id", "status", "to", "cc", "bcc", "attachments", "failover_history", "total", "offset", "limit",
		"__proto__", "constructor", "timestamp", "queued", "sent", "text_body", "html_body", "body", "created_at", "content", "size",
		"idempotent_replay", "error", "code", "reason", "provider", "mimeType", "filename", "attempts", "message"}
	switch r.Intn(9) {
	case 0:
		return nil
	case 1:
		return r.Intn(2) == 0
	case 2:
		return []float64{0, 1, -1, 1e308, -1e308, 9e18, 1.5, 4294967296}[r.Intn(8)]
	case 3:
		return junkString(r)
	case 4, 5:
		if depth > 4 {
			return nil
		}
		n := r.Intn(4)
		a := make([]any, n)
		for i := range a {
			a[i] = randJSON(r, depth+1)
		}
		return a
	}
	if depth > 4 {
		return "x"
	}
	m := map[string]any{}
	for n := r.Intn(8); n > 0; n-- {
		m[keys[r.Intn(len(keys))]] = randJSON(r, depth+1)
	}
	return m
}

func TestSeededRandomServerJSON(t *testing.T) {
	r := rand.New(rand.NewSource(424242))
	var cur any
	var status int
	e := setup(t, func(*rec, int) (*http.Response, error) { return jsonResp(status, cur), nil }, withOpts(noRetry))
	statuses := []int{200, 200, 200, 202, 400, 401, 404, 409, 429, 500}
	for i := 0; i < 1200; i++ {
		cur, status = randJSON(r, 0), statuses[r.Intn(len(statuses))]
		mustBeSDKError(t, "json", func() []error {
			var errs []error
			_, err := e.C.Send(bg, msg)
			errs = append(errs, err)
			_, err = e.C.Status(bg)
			errs = append(errs, err)
			_, err = e.C.Health(bg)
			errs = append(errs, err)
			_, err = e.C.Emails.Get(bg, 1)
			errs = append(errs, err)
			_, err = e.C.Emails.List(bg, nil)
			errs = append(errs, err)
			it := e.C.Emails.Iterate(bg, nil)
			for k := 0; k < 3 && it.Next(bg); k++ {
			}
			errs = append(errs, it.Err())
			return errs
		}())
	}
}
