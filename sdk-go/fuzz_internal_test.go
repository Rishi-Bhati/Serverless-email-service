package unsent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

type rtFunc func(*http.Request) (*http.Response, error)

func (f rtFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func okRT() http.RoundTripper {
	return rtFunc(func(r *http.Request) (*http.Response, error) {
		if r.Body != nil {
			io.Copy(io.Discard, r.Body)
		}
		return &http.Response{
			StatusCode: 202, Header: http.Header{}, Request: r,
			Body: io.NopCloser(strings.NewReader(`{"id":1,"status":"queued"}`)),
		}, nil
	})
}

func FuzzParseAddress(f *testing.F) {
	for _, s := range []string{"a@b.co", "Name <a@b.co>", `"Doe, Jane" <j@x.co>`, "<a@b.co>", "", " ", "<>", `""<a@b>`, "a<b<c>", "\r\n", "é <é@é>", "\xff<\xfe>"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		a, err := ParseAddress(s)
		if err != nil {
			if !IsValidation(err) {
				t.Fatalf("non-validation error %T", err)
			}
			return
		}
		if a.Email == "" {
			t.Fatalf("empty email for %q", s)
		}
		if a.Email != strings.TrimSpace(a.Email) || a.Name != strings.TrimSpace(a.Name) {
			t.Fatalf("untrimmed result %#v", a)
		}
		// resolveFrom must never panic and only produce clean output
		if w, err := resolveFrom(Address{Email: s}, "from"); err == nil && w != nil {
			if strings.ContainsAny(w.Email+w.Name, "\r\n\x00") || !utf8.ValidString(w.Email+w.Name) {
				t.Fatalf("unsafe wire address %#v", w)
			}
		}
	})
}

var b64Oracle = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)

func FuzzNormalizeBase64(f *testing.F) {
	for _, s := range []string{"aGVsbG8=", "aGVs\nbG8=\n", "QQ==", "QQ=", "====", "A===", "", " ", "hello world", "QR==", "AAAA AAAA", "AA==AA=="} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		got, ok := normalizeBase64(s)
		stripped := stripSpace(s)
		// TS reference: non-empty, length%4==0, matches ^[A-Za-z0-9+/]*={0,2}$
		want := stripped != "" && len(stripped)%4 == 0 && b64Oracle.MatchString(stripped)
		if ok != want {
			t.Fatalf("normalizeBase64(%q) = %v, reference says %v", s, ok, want)
		}
		if !ok {
			return
		}
		if got != stripped {
			t.Fatalf("content changed")
		}
		// a valid string must be decodable by encoding/base64 (non-strict) and sized consistently
		raw, err := base64.StdEncoding.DecodeString(got)
		if err != nil {
			t.Fatalf("validated but not decodable: %q: %v", got, err)
		}
		if int64(len(raw)) != base64Size(got) {
			t.Fatalf("size mismatch %d vs %d for %q", len(raw), base64Size(got), got)
		}
	})
}

var idemOracle = regexp.MustCompile(`^[\x21-\x7e]{1,255}$`)

func FuzzIdempotencyKey(f *testing.F) {
	for _, s := range []string{"order-123:receipt", "", " ", "a b", "\t", "ünï", strings.Repeat("x", 255), strings.Repeat("x", 256), "k\n", "~!"} {
		f.Add(s)
	}
	c, err := New(Options{BaseURL: "https://x.test", APIKey: "k", Transport: okRT()})
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, s string) {
		if got, want := validIdempotencyKey(s), idemOracle.MatchString(s); got != want {
			t.Fatalf("validIdempotencyKey(%q) = %v, reference %v", s, got, want)
		}
		body, key, err := c.Emails.buildSend(SendParams{To: []string{"a@b.co"}, Subject: "s", HTML: "h", IdempotencyKey: s})
		if s == "" {
			if err != nil || key == "" {
				t.Fatalf("empty key should generate one: %v", err)
			}
			return
		}
		trimmed := strings.TrimSpace(s)
		if idemOracle.MatchString(trimmed) {
			if err != nil || key != trimmed {
				t.Fatalf("key %q rejected or altered: %v %q", s, err, key)
			}
			var m map[string]any
			if json.Unmarshal(body, &m) != nil || m["idempotency_key"] != trimmed {
				t.Fatalf("wire key mismatch")
			}
		} else if err == nil || CodeOf(err) != "invalid_idempotency_key" {
			t.Fatalf("key %q should be rejected, got %v", s, err)
		}
	})
}

func FuzzOptions(f *testing.F) {
	f.Setenv("UNSENT_BASE_URL", "")
	f.Setenv("UNSENT_API_KEY", "")
	f.Setenv("UNSENT_API_SECRET", "")
	f.Add("https://unsent.example.com", "key", "secret", int64(0), 3)
	f.Add("http://localhost:8787/prefix/?q=1#h", "k", "", int64(time.Second), 0)
	f.Add("http://[::1]", "k\n", "s", int64(-1), 11)
	f.Add("ftp://x", "", "", int64(1), -1)
	f.Add("https://user:pw@h", "é", "s", int64(0), 10)
	f.Add("http://evil.com\\@localhost", "k", "s", int64(0), 1)
	f.Add("HTTPS://UPPER.test///", "k", "s", int64(5), 2)
	f.Fuzz(func(t *testing.T, base, key, secret string, timeout int64, retries int) {
		var seen *url.URL
		rt := rtFunc(func(r *http.Request) (*http.Response, error) {
			seen = r.URL
			return okRT().RoundTrip(r)
		})
		c, err := New(Options{BaseURL: base, APIKey: key, APISecret: secret, Timeout: time.Duration(timeout), MaxRetries: &retries, Transport: rt})
		if err != nil {
			if !IsConfig(err) {
				t.Fatalf("non-config error %T: %v", err, err)
			}
			return
		}
		// success implies all documented constraints hold
		if retries < 0 || retries > 10 || timeout < 0 {
			t.Fatalf("accepted invalid numeric options")
		}
		for _, v := range []string{strings.TrimSpace(key), strings.TrimSpace(secret)} {
			if !printableASCII(v) {
				t.Fatalf("accepted non-printable credential %q", v)
			}
		}
		u, err := url.Parse(c.h.baseURL)
		if err != nil {
			t.Fatalf("normalized URL does not parse: %q", c.h.baseURL)
		}
		if u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.HasSuffix(u.Path, "/") {
			t.Fatalf("not normalized: %q", c.h.baseURL)
		}
		h := strings.ToLower(u.Hostname())
		loop := h == "localhost" || h == "127.0.0.1" || h == "::1" || strings.HasSuffix(h, ".localhost")
		if u.Scheme != "https" && !(u.Scheme == "http" && loop) {
			t.Fatalf("insecure base URL accepted: %q", c.h.baseURL)
		}
		if _, err := c.Emails.Send(context.Background(), SendParams{To: []string{"a@b.co"}, Subject: "s", HTML: "h"}, WithMaxRetries(0), WithTimeout(time.Second)); err != nil {
			t.Fatalf("send over normalized URL: %v", err)
		}
		if seen == nil || !strings.EqualFold(seen.Host, u.Host) {
			t.Fatalf("request went to %v, base %v", seen, u)
		}
	})
}

func FuzzSendParams(f *testing.F) {
	f.Add("a@b.co", "Name <f@x.co>", "subject", "<p>x</p>", "text", "fn.txt", "aGk=", "p1", "key-1")
	f.Add("a@b.co\r\nBcc: x", "", "s", "", "t", "", "", "", "")
	f.Add("", "", "", "", "", "a", "!!!", " ", "a b")
	f.Add("\xff@x", "<>", " ", "\x00", "é", "f\n", "====", "p\x00", "\xff")
	c, err := New(Options{BaseURL: "https://x.test", APIKey: "k", APISecret: "s", Transport: okRT()})
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, to, from, subject, html, text, fname, b64, provider, key string) {
		body, _, err := c.Emails.buildSend(SendParams{
			From: Address{Email: from}, To: []string{to}, CC: []string{to}, Subject: subject, HTML: html, Text: text,
			Attachments: []Attachment{{Filename: fname, Base64: b64}, {Filename: fname, Content: []byte(text)}},
			ProviderID:  provider, IdempotencyKey: key,
		})
		if err != nil {
			if !IsValidation(err) {
				t.Fatalf("non-validation error %T %v", err, err)
			}
			return
		}
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			t.Fatalf("invalid JSON: %v", err)
		}
		for _, k := range []string{"to", "cc"} {
			for _, a := range m[k].([]any) {
				s := a.(string)
				if strings.ContainsAny(s, "\r\n\x00") || !strings.Contains(s, "@") || s != strings.TrimSpace(s) {
					t.Fatalf("bad recipient %q", s)
				}
			}
		}
		if strings.TrimSpace(m["subject"].(string)) == "" || strings.TrimSpace(m["html"].(string)) == "" {
			t.Fatalf("blank required field")
		}
		// a real send must go out signed
		if _, err := c.Emails.Send(context.Background(), SendParams{To: []string{"a@b.co"}, Subject: "s", HTML: "h"}); err != nil {
			t.Fatal(err)
		}
	})
}

func FuzzRetryAfter(f *testing.F) {
	for _, s := range []string{"7", "0", "-1", "1e999", "NaN", "Inf", "", "Tue, 01 Jun 2027 12:00:00 GMT", "99999999999999999999", "0x10", " 3 "} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		d := parseRetryAfter(s, time.Now())
		if d < 0 || d > maxRetryAfter {
			t.Fatalf("out of range: %v", d)
		}
	})
}

func FuzzMapResponses(f *testing.F) {
	f.Add([]byte(`{"email":{"id":1,"to":["a@b.co"],"attachments":[{"filename":"a","content":"QQ=="}],"failover_history":"[]"}}`))
	f.Add([]byte(`{"emails":[{"id":"x","to":5}],"total":1e300}`))
	f.Add([]byte(`[null,1,"a",{"__proto__":{}}]`))
	f.Fuzz(func(t *testing.T, data []byte) {
		var v any
		if json.Unmarshal(data, &v) != nil {
			return
		}
		m := asMap(v)
		_ = mapEmail(m)
		_ = mapEmailDetail(m)
		_ = mapEmail(asMap(m["email"]))
		_ = parseFailover(v)
		_ = apiErrorFromResponse(400, v, apiCtx{})
		_ = apiErrorFromResponse(500, string(data), apiCtx{hasSecret: true})
	})
}
