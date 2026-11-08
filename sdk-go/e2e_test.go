package unsent_test

// Live end-to-end tests against a real Unsent worker (`wrangler dev`, SECURITY_MODE=full):
//
//	eval "$(scripts/e2e-server.sh start 8812)"   # exports UNSENT_E2E_* variables
//	go test -run E2E -v ./...
//
// They are skipped unless UNSENT_E2E_BASE_URL is set.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

type e2eEnv struct{ base, key, secret, from string }

func e2e(t *testing.T) e2eEnv {
	t.Helper()
	e := e2eEnv{os.Getenv("UNSENT_E2E_BASE_URL"), os.Getenv("UNSENT_E2E_API_KEY"), os.Getenv("UNSENT_E2E_API_SECRET"), os.Getenv("UNSENT_E2E_FROM")}
	if e.base == "" {
		t.Skip("UNSENT_E2E_BASE_URL not set")
	}
	return e
}

func (e e2eEnv) client(t *testing.T, mods ...optFn) *unsent.Client {
	t.Helper()
	clearEnv(t)
	o := unsent.Options{BaseURL: e.base, APIKey: e.key, APISecret: e.secret, DefaultFrom: unsent.Addr(e.from)}
	for _, m := range mods {
		m(&o)
	}
	c, err := unsent.New(o)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func uid() string { return fmt.Sprintf("%08x", rand.Uint32()) }

func TestE2EHealthAndStatus(t *testing.T) {
	c := e2e(t).client(t)
	h, err := c.Health(bg)
	if err != nil || h.Status != "ok" {
		t.Fatalf("%v %+v", err, h)
	}
	if _, err := c.Status(bg); err != nil {
		t.Fatal(err)
	}
}

func TestE2ETextOnlyDelivered(t *testing.T) {
	c := e2e(t).client(t)
	tag := uid()
	res, err := c.Send(bg, unsent.SendParams{To: []string{"rcpt-" + tag + "@example.com"}, Subject: "e2e text " + tag, Text: "Plain *text* <ok>"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != unsent.StatusQueued || res.IdempotentReplay {
		t.Fatalf("%+v", res)
	}
	em, err := c.Emails.Wait(bg, res.ID, &unsent.WaitOptions{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, em.Status, unsent.StatusSent, "status")
	eq(t, em.To, []string{"rcpt-" + tag + "@example.com"}, "to")
	eq(t, em.TextBody, "Plain *text* <ok>", "text")
	contains(t, em.HTMLBody, "Plain *text* &lt;ok&gt;")
	eq(t, em.IdempotencyKey, res.IdempotencyKey, "key")
}

func TestE2EFullMessageRoundTrip(t *testing.T) {
	env := e2e(t)
	c := env.client(t)
	tag := uid()
	raw := make([]byte, 256)
	for i := range raw {
		raw[i] = byte(i)
	}
	res, err := c.Send(bg, unsent.SendParams{
		From: unsent.Address{Email: env.from, Name: "E2E Sender"},
		To:   []string{"a-" + tag + "@example.com", "b-" + tag + "@example.com"},
		CC:   []string{"c-" + tag + "@example.com"}, BCC: []string{"d-" + tag + "@example.com"},
		Subject: "e2e full " + tag + " Grüße 🎉 日本語", HTML: "<h1>" + tag + " 🎉</h1>", Text: "text " + tag + " ünï",
		Attachments: []unsent.Attachment{
			{Filename: "bytes.bin", Content: raw, ContentType: "application/octet-stream"},
			{Filename: "hello.txt", Base64: "aGVsbG8=", ContentType: "text/plain"},
			{Filename: "reader.txt", Reader: bytes.NewReader([]byte("from a reader")), ContentType: "text/plain"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	em, err := c.Emails.Wait(bg, res.ID, &unsent.WaitOptions{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, em.Status, unsent.StatusSent, "status")
	eq(t, em.FromName, "E2E Sender", "from name")
	eq(t, em.CC, []string{"c-" + tag + "@example.com"}, "cc")
	eq(t, em.BCC, []string{"d-" + tag + "@example.com"}, "bcc")
	eq(t, em.TextBody, "text "+tag+" ünï", "text")
	eq(t, em.Subject, "e2e full "+tag+" Grüße 🎉 日本語", "subject")
	eq(t, em.HTMLBody, "<h1>"+tag+" 🎉</h1>", "html")
	if len(em.Attachments) != 3 {
		t.Fatalf("attachments %d", len(em.Attachments))
	}
	eq(t, []any{em.Attachments[0].Filename, em.Attachments[0].Size, em.Attachments[0].MimeType}, []any{"bytes.bin", 256, "application/octet-stream"}, "att0")
	eq(t, []any{em.Attachments[1].Filename, em.Attachments[1].Size}, []any{"hello.txt", 5}, "att1")
	got, err := em.Attachments[0].DecodeContent()
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatalf("binary attachment did not round-trip: %v", err)
	}
	got, _ = em.Attachments[2].DecodeContent()
	eq(t, string(got), "from a reader", "reader attachment")

	page, err := c.Emails.List(bg, &unsent.ListParams{Search: tag})
	if err != nil {
		t.Fatal(err)
	}
	var found *unsent.Email
	for i := range page.Emails {
		if page.Emails[i].ID == res.ID {
			found = &page.Emails[i]
		}
	}
	if found == nil {
		t.Fatal("email not in list")
	}
	eq(t, found.Attachments, []unsent.AttachmentInfo{
		{Filename: "bytes.bin", MimeType: "application/octet-stream", Size: 256},
		{Filename: "hello.txt", MimeType: "text/plain", Size: 5},
		{Filename: "reader.txt", MimeType: "text/plain", Size: 13},
	}, "list attachment metadata")
}

func TestE2EIdempotentReplayAndConflict(t *testing.T) {
	c := e2e(t).client(t)
	p := unsent.SendParams{To: []string{"idem@example.com"}, Subject: "idem", Text: "same", IdempotencyKey: "e2e-" + uid()}
	first, err := c.Send(bg, p)
	if err != nil {
		t.Fatal(err)
	}
	again, err := c.Send(bg, p)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, []any{again.ID, again.IdempotentReplay, again.IdempotencyKey}, []any{first.ID, true, p.IdempotencyKey}, "replay")
	p.Text = "different"
	_, err = c.Send(bg, p)
	a := asAPI(t, err)
	if !unsent.IsConflict(err) || a.Code != "idempotency_key_conflict" || a.ExistingEmailID != first.ID {
		t.Fatalf("%v %+v", err, a)
	}
}

func TestE2EParallelSameKeyCreatesOneEmail(t *testing.T) {
	c := e2e(t).client(t)
	key := "e2e-par-" + uid()
	var wg sync.WaitGroup
	results := make([]*unsent.SendResult, 6)
	errs := make([]error, 6)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = c.Send(bg, unsent.SendParams{To: []string{"par@example.com"}, Subject: "par", Text: "x", IdempotencyKey: key})
		}(i)
	}
	wg.Wait()
	ids, fresh := map[int64]bool{}, 0
	for i, r := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		ids[r.ID] = true
		if !r.IdempotentReplay {
			fresh++
		}
	}
	eq(t, len(ids), 1, "distinct ids")
	eq(t, fresh, 1, "non-replays")
}

func TestE2EConcurrentSignedSends(t *testing.T) {
	c := e2e(t).client(t)
	var wg sync.WaitGroup
	ids := make([]int64, 25)
	errs := make([]error, 25)
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r, err := c.Send(bg, unsent.SendParams{To: []string{"burst@example.com"}, Subject: fmt.Sprintf("burst %d", i), Text: "x"})
			errs[i] = err
			if r != nil {
				ids[i] = r.ID
			}
		}(i)
	}
	wg.Wait()
	seen := map[int64]bool{}
	for i := range ids {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		seen[ids[i]] = true
	}
	eq(t, len(seen), 25, "distinct ids")
}

func TestE2ESkewedClockIsCorrected(t *testing.T) {
	c := e2e(t).client(t)
	c.SetClock(func() time.Time { return time.Now().Add(-10 * time.Minute) })
	res, err := c.Send(bg, unsent.SendParams{To: []string{"skew@example.com"}, Subject: "skew", Text: "x"})
	if err != nil || res.ID < 1 {
		t.Fatalf("%v", err)
	}
	if off := c.ClockOffset(); off < 9*time.Minute || off > 11*time.Minute {
		t.Fatalf("offset %v", off)
	}
	// and a fast clock
	c2 := e2e(t).client(t)
	c2.SetClock(func() time.Time { return time.Now().Add(2 * time.Hour) })
	if _, err := c2.Send(bg, unsent.SendParams{To: []string{"skew@example.com"}, Subject: "skew2", Text: "x"}); err != nil {
		t.Fatal(err)
	}
}

func TestE2EBadCredentials(t *testing.T) {
	env := e2e(t)
	send := unsent.SendParams{To: []string{"a@example.com"}, Subject: "s", Text: "t"}
	noRetries := withOpts(noRetry)

	_, err := env.client(t, noRetries, withOpts(func(o *unsent.Options) { o.APISecret = "wrong-secret" })).Send(bg, send)
	a := asAPI(t, err)
	eq(t, a.Code, "invalid_signature", "bad secret")
	contains(t, a.Hint, "APISecret")

	bad := env.client(t, noRetries, withOpts(func(o *unsent.Options) { o.APIKey = "nope" }))
	_, err = bad.Send(bg, send)
	eq(t, asAPI(t, err).Code, "invalid_api_key", "bad key (send)")
	_, err = bad.Status(bg)
	a = asAPI(t, err)
	if !unsent.IsAuthentication(err) || a.Status != 401 {
		t.Fatal(err)
	}
	contains(t, a.Hint, "APIKey")

	_, err = env.client(t, noRetries, withOpts(func(o *unsent.Options) { o.APISecret = "" })).Send(bg, send)
	a = asAPI(t, err)
	if !unsent.IsAuthentication(err) {
		t.Fatal(err)
	}
	contains(t, a.Hint, "signed requests")
	if a.Code != "timestamp_skew" && a.Code != "missing_signature" {
		t.Fatalf("code %q", a.Code)
	}
}

func TestE2EUnauthorizedSenderAndNotFound(t *testing.T) {
	c := e2e(t).client(t)
	_, err := c.Send(bg, unsent.SendParams{From: unsent.Addr("stranger@evil.test"), To: []string{"a@example.com"}, Subject: "s", Text: "t"})
	a := asAPI(t, err)
	if !unsent.IsRequest(err) || a.Code != "unauthorized_sender" {
		t.Fatalf("%v", err)
	}
	_, err = c.Emails.Get(bg, 99_999_999)
	if !unsent.IsNotFound(err) {
		t.Fatalf("%v", err)
	}
}

func TestE2EIterate(t *testing.T) {
	c := e2e(t).client(t)
	// make sure there is something to page through
	for i := 0; i < 3; i++ {
		if _, err := c.Send(bg, unsent.SendParams{To: []string{"iter@example.com"}, Subject: "iter", Text: "x"}); err != nil {
			t.Fatal(err)
		}
	}
	var ids []int64
	it := c.Emails.Iterate(bg, &unsent.ListParams{Limit: 7})
	for it.Next(bg) {
		ids = append(ids, it.Email().ID)
	}
	if it.Err() != nil {
		t.Fatal(it.Err())
	}
	if len(ids) < 3 {
		t.Fatalf("only %d emails", len(ids))
	}
	seen := map[int64]bool{}
	for i, id := range ids {
		if seen[id] || (i > 0 && id < ids[i-1]) {
			t.Fatalf("ids not unique/ascending: %v", ids)
		}
		seen[id] = true
	}
}

func TestE2EWaitReachesSent(t *testing.T) {
	c := e2e(t).client(t)
	res, err := c.Send(bg, unsent.SendParams{To: []string{"wait@example.com"}, Subject: "wait", Text: "x"})
	if err != nil {
		t.Fatal(err)
	}
	em, err := c.Emails.Wait(bg, res.ID, &unsent.WaitOptions{Timeout: 30 * time.Second, Interval: 200 * time.Millisecond})
	if err != nil || em.Status != unsent.StatusSent {
		t.Fatalf("%v %+v", err, em)
	}
	// cancellation of a wait on a real server
	ctx, cancel := context.WithCancel(bg)
	cancel()
	if _, err := c.Emails.Wait(ctx, res.ID, nil); !unsent.IsAborted(err) {
		t.Fatalf("%v", err)
	}
}

// A proxy that forwards the first /api/send to the worker (so the email is queued) and then kills the
// connection before replying. The SDK must retry with the same key and end up with exactly one email.
func TestE2ELostResponseDoesNotDuplicate(t *testing.T) {
	env := e2e(t)
	var killed atomic.Bool
	var sends atomic.Int32
	fwd := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		req, _ := http.NewRequest(r.Method, env.base+r.URL.RequestURI(), bytes.NewReader(body))
		for k, vs := range r.Header {
			if k == "Content-Length" || k == "Accept-Encoding" {
				continue
			}
			for _, v := range vs {
				req.Header.Add(k, v)
			}
		}
		res, err := fwd.Do(req)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		defer res.Body.Close()
		if r.URL.Path == "/api/send" {
			sends.Add(1)
			if killed.CompareAndSwap(false, true) {
				io.Copy(io.Discard, res.Body)
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					conn.Close()
				}
				return
			}
		}
		for k, vs := range res.Header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(res.StatusCode)
		io.Copy(w, res.Body)
	}))
	defer proxy.Close()

	c := env.client(t, withOpts(func(o *unsent.Options) { o.BaseURL = proxy.URL }))
	tag := uid()
	res, err := c.Send(bg, unsent.SendParams{To: []string{"lost-" + tag + "@example.com"}, Subject: "lost response " + tag, Text: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IdempotentReplay {
		t.Fatalf("expected the retry to be an idempotent replay: %+v", res)
	}
	eq(t, sends.Load(), 2, "send attempts through the proxy")
	direct := env.client(t)
	page, err := direct.Emails.List(bg, &unsent.ListParams{Search: tag})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, page.Total, 1, "emails with this tag")
	eq(t, page.Emails[0].ID, res.ID, "id")
}

func TestE2ESendWithoutIdempotency(t *testing.T) {
	c := e2e(t).client(t)
	res, err := c.Send(bg, unsent.SendParams{To: []string{"nokey@example.com"}, Subject: "nokey", Text: "x", NoIdempotency: true})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, res.IdempotencyKey, "", "key")
	em, err := c.Emails.Get(bg, res.ID)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, em.IdempotencyKey, "", "stored key")
}
