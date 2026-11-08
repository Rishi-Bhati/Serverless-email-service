package unsent_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func okRT() http.RoundTripper { return &mockRT{h: okHandler(1)} }

func TestNewRequiresBaseURLAndKey(t *testing.T) {
	clearEnv(t)
	_, err := unsent.New(unsent.Options{APIKey: "k", Transport: okRT()})
	if err == nil || !unsent.IsConfig(err) {
		t.Fatalf("want config error, got %v", err)
	}
	matches(t, err.Error(), `(?s)BaseURL.*UNSENT_BASE_URL`)
	_, err = unsent.New(unsent.Options{BaseURL: testBase, Transport: okRT()})
	matches(t, err.Error(), `(?s)APIKey.*UNSENT_API_KEY`)
	var ce *unsent.ConfigError
	if !errors.As(err, &ce) {
		t.Fatalf("want *ConfigError, got %T", err)
	}
	if ce.Code != "invalid_config" {
		t.Fatalf("code %q", ce.Code)
	}
}

func TestEnvIsReadAndTrimmed(t *testing.T) {
	m := &mockRT{h: okHandler(1)}
	t.Setenv("UNSENT_BASE_URL", testBase+"/\n")
	t.Setenv("UNSENT_API_KEY", " "+testKey+"\n")
	t.Setenv("UNSENT_API_SECRET", testSecret+"\n")
	c, err := unsent.New(unsent.Options{Transport: m})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Send(context.Background(), unsent.SendParams{To: []string{"a@b.co"}, Subject: "s", Text: "t"}); err != nil {
		t.Fatal(err)
	}
	r := m.Calls()[0]
	eq(t, r.URL.String(), testBase+"/api/send", "url")
	eq(t, r.Header.Get("X-API-Key"), testKey, "key")
	if r.Header.Get("X-Signature") == "" {
		t.Fatal("expected a signature")
	}
}

func TestEmptyEnvCountsAsUnset(t *testing.T) {
	t.Setenv("UNSENT_BASE_URL", "")
	t.Setenv("UNSENT_API_KEY", "   ")
	if _, err := unsent.New(unsent.Options{BaseURL: testBase, Transport: okRT()}); err == nil {
		t.Fatal("blank env var must count as unset")
	}
}

func TestExplicitOptionsWinOverEnv(t *testing.T) {
	m := &mockRT{h: okHandler(1)}
	t.Setenv("UNSENT_BASE_URL", "https://wrong.test")
	t.Setenv("UNSENT_API_KEY", "wrong")
	t.Setenv("UNSENT_API_SECRET", "")
	c, err := unsent.New(unsent.Options{BaseURL: testBase, APIKey: testKey, Transport: m})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	r := m.Calls()[0]
	eq(t, r.URL.Host, "unsent.test", "host")
	eq(t, r.Header.Get("X-API-Key"), testKey, "key")
}

func TestNewFromEnv(t *testing.T) {
	m := &mockRT{h: okHandler(1)}
	t.Setenv("UNSENT_BASE_URL", testBase)
	t.Setenv("UNSENT_API_KEY", testKey)
	t.Setenv("UNSENT_API_SECRET", testSecret)
	c, err := unsent.NewFromEnv(unsent.Options{Transport: m, DefaultFrom: unsent.Addr("me@x.co")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	matches(t, m.Calls()[0].Header.Get("X-Signature"), `^sha256=[0-9a-f]{64}$`)
	eq(t, m.Calls()[0].JSON["from"], map[string]any{"email": "me@x.co"}, "default from")
	if _, err := unsent.NewFromEnv(); err != nil {
		t.Fatalf("NewFromEnv() without overrides: %v", err)
	}
}

func TestBaseURLNormalization(t *testing.T) {
	cases := map[string]string{
		testBase + "/mail/?x=1#y":       testBase + "/mail/api/send",
		"  " + testBase + "///":         testBase + "/api/send",
		"HTTPS://UNSENT.test":           testBase + "/api/send",
		testBase + "/a/b//":             testBase + "/a/b/api/send",
		"http://localhost:8787/":        "http://localhost:8787/api/send",
		"https://unsent.test:8443?x=#h": "https://unsent.test:8443/api/send",
	}
	for in, want := range cases {
		m := &mockRT{h: okHandler(1)}
		c, err := unsent.New(unsent.Options{BaseURL: in, APIKey: "k", Transport: m})
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if _, err := c.Send(context.Background(), msg); err != nil {
			t.Fatal(err)
		}
		eq(t, m.Calls()[0].URL.String(), want, "url for "+in)
	}
}

func TestBaseURLRejections(t *testing.T) {
	clearEnv(t)
	cases := []struct{ in, want string }{
		{"not a url", "not a valid URL"},
		{"unsent.example.com", "not a valid URL"},
		{"ftp://x.test", "https"},
		{"file:///etc/passwd", "https"},
		{"javascript:alert(1)", "https"},
		{"http://unsent.example.com", "plain http"},
		{"http://localhost.evil.com", "plain http"},
		{"http://127.0.0.2:80", "plain http"},
		{"http://localhostx", "plain http"},
		{"https://user:pw@unsent.example.com", "credentials"},
		{"http://localhost@evil.com", "credentials"},
		{"https://", "not a valid URL"},
		{"https:///path", "not a valid URL"},
		{"https://a b.test", "not a valid URL"},
		{"https://unsent.test\\@evil.com", "not a valid URL"},
		{"https://unsent.test/\x00", "not a valid URL"},
	}
	for _, tc := range cases {
		_, err := unsent.New(unsent.Options{BaseURL: tc.in, APIKey: "k", Transport: okRT()})
		if err == nil {
			t.Errorf("%q: expected an error", tc.in)
			continue
		}
		if !unsent.IsConfig(err) {
			t.Errorf("%q: not a config error: %T", tc.in, err)
		}
		contains(t, err.Error(), tc.want)
	}
}

func TestHTTPAllowedForLoopback(t *testing.T) {
	for _, host := range []string{"localhost:8787", "127.0.0.1:8787", "[::1]:8787", "app.localhost", "LOCALHOST"} {
		if _, err := unsent.New(unsent.Options{BaseURL: "http://" + host, APIKey: "k", Transport: okRT()}); err != nil {
			t.Errorf("%s: %v", host, err)
		}
	}
}

func TestTimeoutAndMaxRetriesValidation(t *testing.T) {
	clearEnv(t)
	base := func() unsent.Options { return unsent.Options{BaseURL: testBase, APIKey: "k", Transport: okRT()} }
	for name, mod := range map[string]func(*unsent.Options){
		"negative timeout": func(o *unsent.Options) { o.Timeout = -time.Second },
		"retries -1":       func(o *unsent.Options) { o.MaxRetries = unsent.Int(-1) },
		"retries 11":       func(o *unsent.Options) { o.MaxRetries = unsent.Int(11) },
		"both clients":     func(o *unsent.Options) { o.HTTPClient = &http.Client{} },
		"bad default from": func(o *unsent.Options) { o.DefaultFrom = unsent.Addr("a@b.co\r\nBcc: x@y.z") },
		"bad provider":     func(o *unsent.Options) { o.DefaultProviderID = "bad\nid" },
	} {
		o := base()
		mod(&o)
		if _, err := unsent.New(o); err == nil || !unsent.IsConfig(err) {
			t.Errorf("%s: want config error, got %v", name, err)
		}
	}
	for _, n := range []int{0, 1, 10} {
		o := base()
		o.MaxRetries = unsent.Int(n)
		if _, err := unsent.New(o); err != nil {
			t.Errorf("retries %d: %v", n, err)
		}
	}
}

func TestRejectsUnsafeCredentials(t *testing.T) {
	clearEnv(t)
	bad := []string{"key\nX-Evil: 1", "ke\r\ny", "ke\x00y", "k\x7fey", "kéy", "k​ey", "ke\ty", "😀"}
	for _, v := range bad {
		for _, field := range []string{"key", "secret"} {
			o := unsent.Options{BaseURL: testBase, APIKey: "k", Transport: okRT()}
			if field == "key" {
				o.APIKey = v
			} else {
				o.APISecret = v
			}
			_, err := unsent.New(o)
			if err == nil || !unsent.IsConfig(err) {
				t.Errorf("%s %q accepted", field, v)
				continue
			}
			if v != "" {
				if got := err.Error(); len(v) > 2 && strings.Contains(got, v) {
					t.Errorf("error leaks the value: %q", got)
				}
			}
		}
	}
	// surrounding whitespace (including a trailing newline from a file) is trimmed, not rejected
	if _, err := unsent.New(unsent.Options{BaseURL: testBase, APIKey: " key\n", APISecret: "\tsecret \n", Transport: okRT()}); err != nil {
		t.Fatalf("trimmed credentials rejected: %v", err)
	}
}

func TestSecretsNeverPrinted(t *testing.T) {
	o := unsent.Options{BaseURL: testBase, APIKey: "SUPER-KEY-VALUE", APISecret: "SUPER-SECRET-VALUE", Transport: okRT()}
	c, err := unsent.New(o)
	if err != nil {
		t.Fatal(err)
	}
	j, _ := json.Marshal(c)
	jo, _ := json.Marshal(o)
	dump := ""
	for _, f := range []string{"%v", "%+v", "%#v", "%s", "%q", "%d", "%x"} {
		dump += fmt.Sprintf(f, c) + fmt.Sprintf(f, o) + fmt.Sprintf(f, &o) + fmt.Sprintf(f, c.Emails) + fmt.Sprintf(f, []any{c, o})
	}
	dump += string(j) + string(jo) + c.String() + o.String() + fmt.Sprint(c, o)
	for _, s := range []string{"SUPER-KEY-VALUE", "SUPER-SECRET-VALUE"} {
		if strings.Contains(dump, s) {
			t.Fatalf("output leaks %q: %s", s, dump)
		}
	}
	contains(t, c.String(), testBase)
}

func TestNilCallOptionIsIgnoredAndBadOnesRejected(t *testing.T) {
	e := setup(t, okHandler(1))
	if _, err := e.C.Send(context.Background(), msg, nil); err != nil {
		t.Fatal(err)
	}
	for _, o := range []unsent.CallOption{unsent.WithTimeout(0), unsent.WithTimeout(-1), unsent.WithMaxRetries(-1), unsent.WithMaxRetries(11)} {
		before := e.M.N()
		_, err := e.C.Send(context.Background(), msg, o)
		if err == nil || !unsent.IsValidation(err) {
			t.Fatalf("want validation error, got %v", err)
		}
		if e.M.N() != before {
			t.Fatal("a request was sent")
		}
	}
}
