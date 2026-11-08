package unsent_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

var bg = context.Background()

func TestSendIsSignedAndAccepted(t *testing.T) {
	e := setup(t, okHandler(1))
	res, err := e.C.Send(bg, unsent.SendParams{From: unsent.Addr("me@x.co"), To: []string{"a@b.co"}, Subject: "Hello", HTML: "<p>Hi</p>", Text: "Hi"})
	if err != nil {
		t.Fatal(err)
	}
	r := e.M.Calls()[0]
	eq(t, r.Method, "POST", "method")
	eq(t, r.URL.Path, "/api/send", "path")
	eq(t, r.Header.Get("Content-Type"), "application/json", "content-type")
	eq(t, r.Header.Get("Accept"), "application/json", "accept")
	matches(t, r.Header.Get("User-Agent"), `^unsent-sdk-go/\d+\.\d+\.\d+$`)
	if ok, code := verifySigned(r, e.Clock.Now(), nil); !ok {
		t.Fatalf("signature rejected: %s", code)
	}
	if res.ID != 1 || res.Status != unsent.StatusQueued || res.IdempotentReplay {
		t.Fatalf("result %+v", res)
	}
}

func TestSignatureKnownAnswer(t *testing.T) {
	// Computed with Python's hmac/hashlib, independent of this module.
	body := []byte(`{"to":["a@b.co"],"subject":"Grüße","html":"<p>hi</p>"}`)
	got := unsent.SignRequest("test-api-secret", "1780000000", "0123456789abcdef0123456789abcdef", body)
	eq(t, got, "fb90cea97082b10bc7751f665740b03a842053b249cf88d75ceb8288426ec3fa", "signature")
}

func TestNoRoutingOrIdempotencyHeaders(t *testing.T) {
	e := setup(t, okHandler(1))
	if _, err := e.C.Send(bg, unsent.SendParams{From: unsent.Addr("me@x.co"), To: []string{"a@b.co"}, Subject: "s", HTML: "h", ProviderID: "p1"}); err != nil {
		t.Fatal(err)
	}
	r := e.M.Calls()[0]
	for _, h := range []string{"X-Provider-Id", "X-Sender-Email", "Idempotency-Key"} {
		if r.Header.Get(h) != "" {
			t.Fatalf("%s must not be sent", h)
		}
	}
	eq(t, r.JSON["provider_id"], "p1", "provider_id")
	eq(t, r.JSON["from"], map[string]any{"email": "me@x.co"}, "from")
}

func TestSignsUnicodeAndLargeBodiesByteExactly(t *testing.T) {
	e := setup(t, okHandler(1))
	html := strings.Repeat("<p>日本語 — \"quotes\" \\ \n 😀 <&></p>", 5000)
	if _, err := e.C.Send(bg, unsent.SendParams{To: []string{"a@b.co"}, Subject: "Grüße 🎉", HTML: html}); err != nil {
		t.Fatal(err)
	}
	r := e.M.Calls()[0]
	if ok, code := verifySigned(r, e.Clock.Now(), nil); !ok {
		t.Fatal(code)
	}
	if !bytes.Contains(r.Body, []byte("<&>")) {
		t.Fatal("HTML characters should not be escaped on the wire")
	}
	if r.JSON["html"] != html {
		t.Fatal("html did not round-trip")
	}
}

func TestFreshNonceEveryCall(t *testing.T) {
	e := setup(t, okHandler(1))
	used := map[string]bool{}
	for i := 0; i < 20; i++ {
		if _, err := e.C.Send(bg, msg); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range e.M.Calls() {
		if ok, code := verifySigned(c, e.Clock.Now(), used); !ok {
			t.Fatal(code)
		}
	}
	eq(t, len(used), 20, "distinct nonces")
}

func TestNoSecretMeansNoSignature(t *testing.T) {
	m := &mockRT{h: okHandler(1)}
	clearEnv(t)
	c, err := unsent.New(unsent.Options{BaseURL: testBase, APIKey: testKey, Transport: m})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	h := m.Calls()[0].Header
	eq(t, h.Get("X-API-Key"), testKey, "key")
	for _, k := range []string{"X-Signature", "X-Nonce", "X-Timestamp"} {
		if h.Get(k) != "" {
			t.Fatalf("%s sent without a secret", k)
		}
	}
}

func TestFromParsing(t *testing.T) {
	e := setup(t, okHandler(1))
	froms := []unsent.Address{
		unsent.Addr("Acme Support <help@acme.co>"),
		{Email: "help@acme.co", Name: "Acme"},
		unsent.Addr(`"Doe, Jane" <j@acme.co>`),
		unsent.Addr("  plain@acme.co "),
		unsent.Addr("<only@acme.co>"),
	}
	for _, f := range froms {
		p := msg
		p.From = f
		if _, err := e.C.Send(bg, p); err != nil {
			t.Fatal(err)
		}
	}
	want := []map[string]any{
		{"email": "help@acme.co", "name": "Acme Support"},
		{"email": "help@acme.co", "name": "Acme"},
		{"email": "j@acme.co", "name": "Doe, Jane"},
		{"email": "plain@acme.co"},
		{"email": "only@acme.co"},
	}
	for i, c := range e.M.Calls() {
		eq(t, c.JSON["from"], want[i], fmt.Sprintf("from #%d", i))
	}
}

func TestDefaultsAndOverrides(t *testing.T) {
	e := setup(t, okHandler(1), withOpts(func(o *unsent.Options) {
		o.DefaultFrom = unsent.Addr("default@x.co")
		o.DefaultProviderID = "prov-a"
	}))
	_, _ = e.C.Send(bg, msg)
	p := msg
	p.From, p.ProviderID = unsent.Addr("other@x.co"), "prov-b"
	_, _ = e.C.Send(bg, p)
	c := e.M.Calls()
	eq(t, c[0].JSON["from"], map[string]any{"email": "default@x.co"}, "default from")
	eq(t, c[0].JSON["provider_id"], "prov-a", "default provider")
	eq(t, c[1].JSON["from"], map[string]any{"email": "other@x.co"}, "override from")
	eq(t, c[1].JSON["provider_id"], "prov-b", "override provider")
}

func TestTextOnlyDerivesEscapedHTML(t *testing.T) {
	e := setup(t, okHandler(1))
	if _, err := e.C.Send(bg, unsent.SendParams{To: []string{"a@b.co"}, Subject: "s", Text: "Line 1\n<b>& \"x\" 'y'</b>"}); err != nil {
		t.Fatal(err)
	}
	j := e.M.Calls()[0].JSON
	eq(t, j["text"], "Line 1\n<b>& \"x\" 'y'</b>", "text")
	eq(t, j["html"], `<div style="white-space:pre-wrap">Line 1`+"\n"+`&lt;b&gt;&amp; &quot;x&quot; &#39;y&#39;&lt;/b&gt;</div>`, "html")
}

func TestRecipientsAndOmittedFields(t *testing.T) {
	e := setup(t, okHandler(1))
	_, err := e.C.Send(bg, unsent.SendParams{To: []string{"a@b.co", " c@d.co ", "  "}, CC: []string{"e@f.co"}, BCC: []string{}, Subject: "s", HTML: "h"})
	if err != nil {
		t.Fatal(err)
	}
	j := e.M.Calls()[0].JSON
	eq(t, j["to"], []string{"a@b.co", "c@d.co"}, "to")
	eq(t, j["cc"], []string{"e@f.co"}, "cc")
	for _, k := range []string{"bcc", "attachments", "from", "provider_id", "text"} {
		if _, ok := j[k]; ok {
			t.Fatalf("%q should be omitted", k)
		}
	}
	for k, v := range j {
		if v == nil {
			t.Fatalf("%q is null", k)
		}
	}
}

type namedReader struct {
	*strings.Reader
	name string
}

func (n namedReader) Name() string { return "/some/dir/" + n.name }

func TestAttachmentEncoding(t *testing.T) {
	e := setup(t, okHandler(1))
	big := bytes.Repeat([]byte{7}, 100_000)
	_, err := e.C.Send(bg, unsent.SendParams{To: []string{"a@b.co"}, Subject: "s", HTML: "h", Attachments: []unsent.Attachment{
		{Filename: "a.txt", Content: []byte("hello"), ContentType: "text/plain"},
		{Filename: "b.bin", Content: []byte{0, 255, 16}},
		{Filename: "c.txt", Base64: "aGVs\nbG8=\n"},
		{Reader: namedReader{strings.NewReader("file-body"), "d.txt"}, ContentType: "text/plain"},
		{Filename: "e.bin", Content: big},
		{Filename: " f\r\n.txt ", Reader: strings.NewReader("x")},
	}})
	if err != nil {
		t.Fatal(err)
	}
	a := e.M.Calls()[0].JSON["attachments"].([]any)
	get := func(i int) map[string]any { return a[i].(map[string]any) }
	eq(t, get(0), map[string]any{"filename": "a.txt", "content": "aGVsbG8=", "mimeType": "text/plain"}, "a")
	eq(t, get(1)["content"], base64.StdEncoding.EncodeToString([]byte{0, 255, 16}), "b")
	eq(t, get(2), map[string]any{"filename": "c.txt", "content": "aGVsbG8="}, "c")
	eq(t, get(3), map[string]any{"filename": "d.txt", "content": base64.StdEncoding.EncodeToString([]byte("file-body")), "mimeType": "text/plain"}, "d")
	eq(t, get(4)["content"], base64.StdEncoding.EncodeToString(big), "e")
	eq(t, get(5)["filename"], "f.txt", "f")
}

func TestResultMappingForReplay(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"success": true, "id": 9, "status": "sent", "idempotency_key": "k-1", "idempotent_replay": true, "message": "m", "targetProvider": "SES"}, "Idempotent-Replayed", "true"), nil
	})
	p := msg
	p.IdempotencyKey = "k-1"
	res, err := e.C.Send(bg, p)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, *res, unsent.SendResult{ID: 9, Status: unsent.StatusSent, IdempotencyKey: "k-1", IdempotentReplay: true, TargetProvider: "SES", Message: "m"}, "result")
}

func TestReplayDetectedFromHeaderAlone(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"id": 2, "status": "queued"}, "Idempotent-Replayed", "true"), nil
	})
	res, err := e.C.Send(bg, msg)
	if err != nil || !res.IdempotentReplay {
		t.Fatalf("%v %+v", err, res)
	}
}

func TestIdempotencyKeys(t *testing.T) {
	e := setup(t, okHandler(1))
	r1, _ := e.C.Send(bg, msg)
	r2, _ := e.C.Send(bg, msg)
	k1 := e.M.Calls()[0].JSON["idempotency_key"].(string)
	matches(t, k1, `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if e.M.Calls()[1].JSON["idempotency_key"] == k1 || r1.IdempotencyKey != k1 || r2.IdempotencyKey == k1 {
		t.Fatal("keys must be unique per call and reported")
	}

	p := msg
	p.IdempotencyKey = " order-123:receipt "
	_, _ = e.C.Send(bg, p)
	eq(t, e.M.Calls()[2].JSON["idempotency_key"], "order-123:receipt", "trimmed key")

	p = msg
	p.NoIdempotency = true
	res, _ := e.C.Send(bg, p)
	if _, ok := e.M.Calls()[3].JSON["idempotency_key"]; ok {
		t.Fatal("key sent although disabled")
	}
	eq(t, res.IdempotencyKey, "", "disabled key")
}

func TestInvalidIdempotencyKeysSendNothing(t *testing.T) {
	for _, key := range []string{"  ", "has space", "tab\there", "ünï", strings.Repeat("x", 256), "a\nb", "k\x7f"} {
		e := setup(t, okHandler(1))
		p := msg
		p.IdempotencyKey = key
		_, err := e.C.Send(bg, p)
		if err == nil || unsent.CodeOf(err) != "invalid_idempotency_key" || !unsent.IsValidation(err) {
			t.Errorf("%q: %v", key, err)
		}
		if e.M.N() != 0 {
			t.Errorf("%q: request sent", key)
		}
	}
	e := setup(t, okHandler(1))
	p := msg
	p.IdempotencyKey, p.NoIdempotency = "k", true
	if _, err := e.C.Send(bg, p); unsent.CodeOf(err) != "invalid_idempotency_key" {
		t.Fatalf("conflicting options: %v", err)
	}
	p = msg
	p.IdempotencyKey = strings.Repeat("x", 255)
	if _, err := e.C.Send(bg, p); err != nil {
		t.Fatalf("255 chars should be fine: %v", err)
	}
}

func many(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("u%d@x.co", i)
	}
	return out
}

func TestSendValidation(t *testing.T) {
	mk := func(f func(*unsent.SendParams)) unsent.SendParams {
		p := unsent.SendParams{To: []string{"a@b.co"}, Subject: "s", HTML: "h"}
		f(&p)
		return p
	}
	atts := func(n int) []unsent.Attachment {
		a := make([]unsent.Attachment, n)
		for i := range a {
			a[i] = unsent.Attachment{Filename: "a", Base64: "QQ=="}
		}
		return a
	}
	cases := []struct {
		name string
		p    unsent.SendParams
		re   string
	}{
		{"missing to", mk(func(p *unsent.SendParams) { p.To = nil }), `"to" is required`},
		{"empty to", mk(func(p *unsent.SendParams) { p.To = []string{} }), `at least one`},
		{"blank to", mk(func(p *unsent.SendParams) { p.To = []string{"  "} }), `at least one`},
		{"no @", mk(func(p *unsent.SendParams) { p.To = []string{"nope"} }), `invalid address`},
		{"CRLF in to", mk(func(p *unsent.SendParams) { p.To = []string{"a@b.co\r\nBcc: x@y.z"} }), `line break`},
		{"NUL in cc", mk(func(p *unsent.SendParams) { p.CC = []string{"a@b\x00.co"} }), `line break`},
		{"CRLF in bcc", mk(func(p *unsent.SendParams) { p.BCC = []string{"a@b.co\nX: y"} }), `line break`},
		{"101 recipients", mk(func(p *unsent.SendParams) { p.To = many(101) }), `maximum 100`},
		{"long address", mk(func(p *unsent.SendParams) { p.To = []string{strings.Repeat("a", 330) + "@x.co"} }), `longer than 320`},
		{"bad utf8", mk(func(p *unsent.SendParams) { p.To = []string{"a\xff@x.co"} }), `UTF-8`},
		{"missing subject", mk(func(p *unsent.SendParams) { p.Subject = "" }), `"subject" is required`},
		{"blank subject", mk(func(p *unsent.SendParams) { p.Subject = "   " }), `"subject" is required`},
		{"huge subject", mk(func(p *unsent.SendParams) { p.Subject = strings.Repeat("x", 1001) }), `maximum 1000`},
		{"subject bad utf8", mk(func(p *unsent.SendParams) { p.Subject = "a\xc3" }), `UTF-8`},
		{"no body", mk(func(p *unsent.SendParams) { p.HTML = "" }), `"html", "text"`},
		{"blank bodies", mk(func(p *unsent.SendParams) { p.HTML, p.Text = " ", "\n" }), `"html", "text"`},
		{"21 attachments", mk(func(p *unsent.SendParams) { p.Attachments = atts(21) }), `maximum 20`},
		{"no filename", mk(func(p *unsent.SendParams) { p.Attachments = []unsent.Attachment{{Base64: "QQ=="}} }), `filename is required`},
		{"long filename", mk(func(p *unsent.SendParams) {
			p.Attachments = []unsent.Attachment{{Filename: strings.Repeat("f", 256), Base64: "QQ=="}}
		}), `exceeds 255`},
		{"plain text as base64", mk(func(p *unsent.SendParams) {
			p.Attachments = []unsent.Attachment{{Filename: "a.txt", Base64: "hello world"}}
		}), `valid padded base64`},
		{"no content", mk(func(p *unsent.SendParams) { p.Attachments = []unsent.Attachment{{Filename: "a"}} }), `content is required`},
		{"two sources", mk(func(p *unsent.SendParams) {
			p.Attachments = []unsent.Attachment{{Filename: "a", Content: []byte("x"), Base64: "QQ=="}}
		}), `only one of`},
		{"empty content", mk(func(p *unsent.SendParams) { p.Attachments = []unsent.Attachment{{Filename: "a", Content: []byte{}}} }), `empty`},
		{"empty reader", mk(func(p *unsent.SendParams) {
			p.Attachments = []unsent.Attachment{{Filename: "a", Reader: strings.NewReader("")}}
		}), `empty`},
		{"bad content type", mk(func(p *unsent.SendParams) {
			p.Attachments = []unsent.Attachment{{Filename: "a", Content: []byte("x"), ContentType: "a/b\r\nX: y"}}
		}), `ContentType`},
		{"bad from", mk(func(p *unsent.SendParams) { p.From = unsent.Address{Name: "x"} }), `from\.email`},
		{"CRLF from", mk(func(p *unsent.SendParams) { p.From = unsent.Addr("a@b.co\r\nBcc: x@y.z") }), `line break`},
		{"CRLF from name", mk(func(p *unsent.SendParams) { p.From = unsent.Address{Email: "a@b.co", Name: "x\ny"} }), `line break`},
		{"blank provider", mk(func(p *unsent.SendParams) { p.ProviderID = " " }), `ProviderID`},
		{"long provider", mk(func(p *unsent.SendParams) { p.ProviderID = strings.Repeat("p", 256) }), `ProviderID`},
		{"too big", mk(func(p *unsent.SendParams) { p.HTML = strings.Repeat("x", 3*1024*1024+1) }), `maximum`},
	}
	for _, tc := range cases {
		e := setup(t, okHandler(1))
		_, err := e.C.Send(bg, tc.p)
		if err == nil {
			t.Errorf("%s: no error", tc.name)
			continue
		}
		var v *unsent.ValidationError
		if !unsent.IsValidation(err) || !errorsAs(err, &v) {
			t.Errorf("%s: not a validation error: %T %v", tc.name, err, err)
			continue
		}
		matches(t, err.Error(), tc.re)
		if e.M.N() != 0 {
			t.Errorf("%s: a request was sent", tc.name)
		}
	}
}

func TestPayloadTooLargeCode(t *testing.T) {
	e := setup(t, okHandler(1))
	p := msg
	p.HTML = strings.Repeat("x", 3*1024*1024)
	_, err := e.C.Send(bg, p)
	eq(t, unsent.CodeOf(err), "payload_too_large", "code")
	p = msg
	p.Attachments = []unsent.Attachment{{Filename: "a", Content: make([]byte, 3*1024*1024)}}
	_, err = e.C.Send(bg, p)
	eq(t, unsent.CodeOf(err), "payload_too_large", "attachment code")
	eq(t, e.M.N(), 0, "requests")
}

func TestBodyHashIndependent(t *testing.T) {
	e := setup(t, okHandler(1))
	_, _ = e.C.Send(bg, msg)
	r := e.M.Calls()[0]
	sum := sha256.Sum256(r.Body)
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(r.Header.Get("X-Timestamp") + "\n" + r.Header.Get("X-Nonce") + "\n" + hex.EncodeToString(sum[:])))
	eq(t, r.Header.Get("X-Signature"), "sha256="+hex.EncodeToString(mac.Sum(nil)), "signature")
	eq(t, r.Header.Get("X-Timestamp"), fmt.Sprint(e.Clock.Now().Unix()), "timestamp")
}

func TestConcurrentUseIsRaceFree(t *testing.T) {
	e := setup(t, func(_ *rec, n int) (*http.Response, error) {
		switch n % 7 {
		case 0:
			return apiErr(503, "x", "x", ""), nil
		case 1:
			return apiErr(401, "timestamp_skew", "x", "", "Date", t0.Add(time.Hour).UTC().Format(http.TimeFormat)), nil
		}
		return accepted(n), nil
	})
	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 25; i++ {
				_, _ = e.C.Send(bg, msg)
				_, _ = e.C.Status(bg)
				_ = e.C.String()
			}
		}()
	}
	wg.Wait()
}
