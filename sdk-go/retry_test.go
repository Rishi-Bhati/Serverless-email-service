package unsent_test

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func TestRetries5xxSameKeyFreshNonce(t *testing.T) {
	e := setup(t, func(_ *rec, n int) (*http.Response, error) {
		if n < 3 {
			return apiErr(500, "internal_error", "Internal server error", ""), nil
		}
		return accepted(5), nil
	})
	res, err := e.C.Send(bg, msg)
	if err != nil || res.ID != 5 {
		t.Fatalf("%v %+v", err, res)
	}
	calls := e.M.Calls()
	eq(t, len(calls), 3, "attempts")
	keys, nonces := map[any]bool{}, map[string]bool{}
	used := map[string]bool{}
	for _, c := range calls {
		keys[c.JSON["idempotency_key"]] = true
		nonces[c.Header.Get("X-Nonce")] = true
		if ok, code := verifySigned(c, e.Clock.Now(), used); !ok {
			t.Fatal(code)
		}
	}
	eq(t, len(keys), 1, "keys")
	eq(t, len(nonces), 3, "nonces")
}

func TestRetriesEachRetryableStatusHonoringRetryAfter(t *testing.T) {
	for _, status := range []int{408, 425, 429, 500, 502, 503, 504} {
		e := setup(t, func(_ *rec, n int) (*http.Response, error) {
			if n == 1 {
				return apiErr(status, "x", "e", "", "Retry-After", "2"), nil
			}
			return accepted(1), nil
		})
		if _, err := e.C.Send(bg, msg); err != nil {
			t.Fatalf("%d: %v", status, err)
		}
		eq(t, e.M.N(), 2, fmt.Sprint(status, " attempts"))
		if s := e.Clock.Sleeps(); len(s) != 1 || s[0] != 2*time.Second {
			t.Fatalf("%d: sleeps %v", status, s)
		}
	}
}

func TestRetryAfterParsing(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		in   string
		want time.Duration
	}{
		{"7", 7 * time.Second}, {"0", 0}, {"1.5", 1500 * time.Millisecond}, {" 3 ", 3 * time.Second},
		{"999999", 60 * time.Second}, {"1e999", 0}, {"-5", 0}, {"abc", 0}, {"", 0}, {"NaN", 0}, {"Inf", 0},
		{now.Add(10 * time.Second).UTC().Format(http.TimeFormat), 10 * time.Second},
		{now.Add(-10 * time.Second).UTC().Format(http.TimeFormat), 0},
		{now.Add(24 * time.Hour).UTC().Format(http.TimeFormat), 60 * time.Second},
		{"Tue, 99 Foo 2026", 0},
	}
	for _, tc := range cases {
		if got := unsent.ParseRetryAfterFor(tc.in, now); got != tc.want {
			t.Errorf("%q: got %v want %v", tc.in, got, tc.want)
		}
	}
}

func TestBackoffBoundsAndJitter(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(503, "x", "Unavailable", ""), nil }, withOpts(func(o *unsent.Options) { o.MaxRetries = unsent.Int(8) }))
	e.C.SetRand(func() float64 { return 0 })
	_, _ = e.C.Send(bg, msg)
	var want []time.Duration
	for _, ms := range []int{250, 500, 1000, 2000, 4000, 4000, 4000, 4000} {
		want = append(want, time.Duration(ms)*time.Millisecond)
	}
	eq(t, e.Clock.Sleeps(), want, "lower bound (rand=0)")

	e = setup(t, func(*rec, int) (*http.Response, error) { return apiErr(503, "x", "Unavailable", ""), nil }, withOpts(func(o *unsent.Options) { o.MaxRetries = unsent.Int(3) }))
	e.C.SetRand(func() float64 { return 0.9999999 })
	_, _ = e.C.Send(bg, msg)
	for i, s := range e.Clock.Sleeps() {
		hi := time.Duration(500<<uint(i)) * time.Millisecond
		if s <= hi/2 || s > hi {
			t.Errorf("attempt %d: %v outside (%v, %v]", i, s, hi/2, hi)
		}
	}
}

func TestRetriesNetworkErrors(t *testing.T) {
	e := setup(t, func(_ *rec, n int) (*http.Response, error) {
		if n < 3 {
			return nil, errors.New("connection reset by peer")
		}
		return accepted(1), nil
	})
	if _, err := e.C.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 3, "attempts")
}

func TestGivesUpAfterMaxRetries(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(503, "x", "Unavailable", ""), nil }, withOpts(func(o *unsent.Options) { o.MaxRetries = unsent.Int(2) }))
	_, err := e.C.Send(bg, msg)
	a := asAPI(t, err)
	if !unsent.IsServer(err) || a.Status != 503 {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 3, "attempts")
}

func TestMaxRetriesZeroDisablesRetries(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(500, "internal_error", "x", ""), nil }, withOpts(noRetry))
	if _, err := e.C.Send(bg, msg); !unsent.IsServer(err) {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 1, "client-level")
	e = setup(t, func(*rec, int) (*http.Response, error) { return apiErr(500, "internal_error", "x", ""), nil })
	if _, err := e.C.Send(bg, msg, unsent.WithMaxRetries(0)); !unsent.IsServer(err) {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 1, "per-call")
	e = setup(t, func(*rec, int) (*http.Response, error) { return apiErr(500, "internal_error", "x", ""), nil }, withOpts(noRetry))
	_, _ = e.C.Send(bg, msg, unsent.WithMaxRetries(2))
	eq(t, e.M.N(), 3, "per-call override raises")
}

func TestNeverRetried(t *testing.T) {
	cases := []struct {
		status int
		code   string
		check  func(error) bool
	}{
		{400, "validation_error", unsent.IsRequest}, {400, "unauthorized_sender", unsent.IsRequest},
		{401, "invalid_api_key", unsent.IsAuthentication}, {401, "invalid_signature", unsent.IsAuthentication},
		{403, "forbidden", unsent.IsPermission}, {409, "idempotency_key_conflict", unsent.IsConflict},
		{413, "payload_too_large", unsent.IsRequest}, {500, "server_misconfigured", unsent.IsServer},
		{501, "x", unsent.IsServer}, {505, "x", unsent.IsServer}, {404, "not_found", unsent.IsNotFound},
	}
	for _, tc := range cases {
		e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(tc.status, tc.code, "nope", ""), nil })
		_, err := e.C.Send(bg, msg)
		if err == nil || !tc.check(err) {
			t.Errorf("%d %s: %v", tc.status, tc.code, err)
		}
		if e.M.N() != 1 {
			t.Errorf("%d %s retried (%d calls)", tc.status, tc.code, e.M.N())
		}
	}
}

func TestSendWithoutKeyIsNeverRetried(t *testing.T) {
	p := msg
	p.NoIdempotency = true
	net := setup(t, func(*rec, int) (*http.Response, error) { return nil, errors.New("boom") })
	if _, err := net.C.Send(bg, p); !unsent.IsConnection(err) {
		t.Fatal(err)
	}
	eq(t, net.M.N(), 1, "network")
	srv := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(500, "internal_error", "x", ""), nil })
	if _, err := srv.C.Send(bg, p); !unsent.IsServer(err) {
		t.Fatal(err)
	}
	eq(t, srv.M.N(), 1, "5xx")
}

func TestRetriedSendThatLanded(t *testing.T) {
	e := setup(t, func(_ *rec, n int) (*http.Response, error) {
		if n == 1 {
			return apiErr(502, "x", "Bad gateway", ""), nil
		}
		return jsonResp(200, map[string]any{"success": true, "id": 4, "status": "queued", "idempotent_replay": true, "message": "m", "targetProvider": "p"}, "Idempotent-Replayed", "true"), nil
	})
	res, err := e.C.Send(bg, msg)
	if err != nil || res.ID != 4 || !res.IdempotentReplay {
		t.Fatalf("%v %+v", err, res)
	}
	eq(t, e.M.N(), 2, "attempts")
}

// ---- clock skew --------------------------------------------------------------

func TestSkewLearnedFromDateHeader(t *testing.T) {
	var e *testEnv
	e = setup(t, func(r *rec, n int) (*http.Response, error) {
		serverNow := e.Clock.Now().Add(10 * time.Minute)
		var tsn int64
		fmt.Sscan(r.Header.Get("X-Timestamp"), &tsn)
		if d := serverNow.Unix() - tsn; d > 180 || d < -180 {
			return apiErr(401, "timestamp_skew", "Unauthorized", "Timestamp out of range", "Date", serverNow.UTC().Format(http.TimeFormat)), nil
		}
		return accepted(8), nil
	})
	res, err := e.C.Send(bg, msg)
	if err != nil || res.ID != 8 {
		t.Fatalf("%v", err)
	}
	eq(t, e.M.N(), 2, "attempts")
	if off := e.C.ClockOffset(); off < 9*time.Minute || off > 11*time.Minute {
		t.Fatalf("offset %v", off)
	}
	if _, err := e.C.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 3, "offset is remembered")
	if len(e.Clock.Sleeps()) != 0 {
		t.Fatal("clock correction must not back off")
	}
}

func TestSkewFallsBackToHealth(t *testing.T) {
	var e *testEnv
	e = setup(t, func(r *rec, n int) (*http.Response, error) {
		serverNow := e.Clock.Now().Add(10 * time.Minute)
		if r.URL.Path == "/api/health" {
			return jsonResp(200, map[string]any{"status": "ok", "timestamp": serverNow.UnixMilli()}), nil
		}
		var tsn int64
		fmt.Sscan(r.Header.Get("X-Timestamp"), &tsn)
		if d := serverNow.Unix() - tsn; d > 180 || d < -180 {
			return apiErr(401, "timestamp_skew", "Unauthorized", "Timestamp out of range"), nil
		}
		return accepted(11), nil
	})
	res, err := e.C.Send(bg, msg)
	if err != nil || res.ID != 11 {
		t.Fatalf("%v", err)
	}
	eq(t, e.M.Paths(), []string{"/api/send", "/api/health", "/api/send"}, "paths")
	eq(t, e.M.Calls()[1].Header.Get("X-API-Key"), "", "health is unauthenticated")
}

func TestStaleOffsetIsDropped(t *testing.T) {
	var e *testEnv
	skew := 10 * time.Minute
	e = setup(t, func(r *rec, n int) (*http.Response, error) {
		serverNow := e.Clock.Now().Add(skew)
		if r.URL.Path == "/api/health" {
			return jsonResp(200, map[string]any{"status": "ok", "timestamp": serverNow.UnixMilli()}), nil
		}
		var tsn int64
		fmt.Sscan(r.Header.Get("X-Timestamp"), &tsn)
		if d := serverNow.Unix() - tsn; d > 180 || d < -180 {
			return apiErr(401, "timestamp_skew", "Unauthorized", "Timestamp out of range"), nil
		}
		return accepted(1), nil
	})
	sends := func() int {
		n := 0
		for _, p := range e.M.Paths() {
			if p == "/api/send" {
				n++
			}
		}
		return n
	}
	if _, err := e.C.Send(bg, msg); err != nil { // learns +10 min
		t.Fatal(err)
	}
	skew = 0 // operator fixes the clock
	if _, err := e.C.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	eq(t, sends(), 4, "2 + 2 sends")
	if _, err := e.C.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	eq(t, sends(), 5, "healthy again")
	eq(t, e.C.ClockOffset(), time.Duration(0), "offset reset")
}

func TestSkewGivesUpWhenHealthUnreachable(t *testing.T) {
	e := setup(t, func(r *rec, n int) (*http.Response, error) {
		if r.URL.Path == "/api/health" {
			return nil, errors.New("down")
		}
		return apiErr(401, "timestamp_skew", "Unauthorized", "Timestamp out of range"), nil
	})
	_, err := e.C.Send(bg, msg)
	eq(t, unsent.CodeOf(err), "timestamp_skew", "code")
	sends := 0
	for _, p := range e.M.Paths() {
		if p == "/api/send" {
			sends++
		}
	}
	eq(t, sends, 1, "send attempts")
}

func TestSkewDoesNotLoop(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return apiErr(401, "timestamp_skew", "Unauthorized", "bad", "Date", t0.Add(time.Hour).UTC().Format(http.TimeFormat)), nil
	})
	_, err := e.C.Send(bg, msg)
	if !unsent.IsAuthentication(err) || unsent.CodeOf(err) != "timestamp_skew" {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 2, "attempts")
}

func TestSmallSkewIsIgnored(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return apiErr(401, "timestamp_skew", "Unauthorized", "bad", "Date", t0.UTC().Format(http.TimeFormat)), nil
	})
	_, err := e.C.Send(bg, msg)
	eq(t, unsent.CodeOf(err), "timestamp_skew", "code")
	eq(t, e.M.N(), 1, "attempts")
}

func TestSkewHintDependsOnSecret(t *testing.T) {
	h := func(*rec, int) (*http.Response, error) {
		return apiErr(401, "timestamp_skew", "Unauthorized", "Invalid or missing X-Timestamp header"), nil
	}
	e := setup(t, h, withOpts(func(o *unsent.Options) { o.APISecret = "" }))
	_, err := e.C.Send(bg, msg)
	contains(t, asAPI(t, err).Hint, "requires signed requests")
	e = setup(t, h, withOpts(func(o *unsent.Options) { o.Transport = &mockRT{h: h} }))
	_, err = e.C.Send(bg, msg)
	contains(t, asAPI(t, err).Hint, "3 minutes")
}

// ---- timeouts and aborts -------------------------------------------------------

func TestHungRequestTimesOutAndIsRetried(t *testing.T) {
	e := setup(t, func(r *rec, n int) (*http.Response, error) {
		if n == 1 {
			return hang(r)
		}
		return accepted(1), nil
	}, withOpts(func(o *unsent.Options) { o.Timeout = 80 * time.Millisecond }))
	if _, err := e.C.Send(bg, msg); err != nil {
		t.Fatal(err)
	}
	eq(t, e.M.N(), 2, "attempts")
}

func TestEveryAttemptHangsGivesTimeoutError(t *testing.T) {
	e := setup(t, func(r *rec, n int) (*http.Response, error) { return hang(r) },
		withOpts(func(o *unsent.Options) { o.Timeout = 50 * time.Millisecond; o.MaxRetries = unsent.Int(1) }))
	_, err := e.C.Send(bg, msg)
	var ce *unsent.ConnectionError
	if !errors.As(err, &ce) || !ce.Timeout() || !unsent.IsTimeout(err) || !unsent.IsConnection(err) || ce.Code != "timeout" {
		t.Fatalf("%T %v", err, err)
	}
	var ne net.Error
	if !errors.As(err, &ne) || !ne.Timeout() {
		t.Fatal("should satisfy net.Error timeout semantics")
	}
	eq(t, e.M.N(), 2, "attempts")
}

func TestPerCallTimeout(t *testing.T) {
	e := setup(t, func(r *rec, n int) (*http.Response, error) { return hang(r) }, withOpts(noRetry))
	start := time.Now()
	_, err := e.C.Send(bg, msg, unsent.WithTimeout(40*time.Millisecond))
	if !unsent.IsTimeout(err) || time.Since(start) > 2*time.Second {
		t.Fatalf("%v", err)
	}
}

func TestAbortStopsImmediately(t *testing.T) {
	e := setup(t, func(r *rec, n int) (*http.Response, error) { return hang(r) })
	ctx, cancel := context.WithCancel(bg)
	go func() { time.Sleep(30 * time.Millisecond); cancel() }()
	_, err := e.C.Send(ctx, msg)
	if !unsent.IsAborted(err) || unsent.CodeOf(err) != "aborted" || unsent.IsTimeout(err) || !errors.Is(err, context.Canceled) {
		t.Fatalf("%v", err)
	}
	eq(t, e.M.N(), 1, "attempts")
}

func TestAbortDuringBackoff(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(500, "internal_error", "x", ""), nil })
	e.C.SetSleep(nil) // real timers
	ctx, cancel := context.WithCancel(bg)
	go func() { time.Sleep(30 * time.Millisecond); cancel() }()
	start := time.Now()
	_, err := e.C.Send(ctx, msg)
	if !unsent.IsAborted(err) || time.Since(start) > 400*time.Millisecond {
		t.Fatalf("%v after %v", err, time.Since(start))
	}
	eq(t, e.M.N(), 1, "attempts")
}

func TestAlreadyCancelledNeverTouchesNetwork(t *testing.T) {
	e := setup(t, okHandler(1))
	ctx, cancel := context.WithCancel(bg)
	cancel()
	_, err := e.C.Send(ctx, msg)
	if !unsent.IsAborted(err) || e.M.N() != 0 {
		t.Fatalf("%v", err)
	}
	for _, f := range []func() error{
		func() error { _, err := e.C.Status(ctx); return err },
		func() error { _, err := e.C.Health(ctx); return err },
		func() error { _, err := e.C.Emails.Get(ctx, 1); return err },
		func() error { _, err := e.C.Emails.List(ctx, nil); return err },
	} {
		if err := f(); !unsent.IsAborted(err) {
			t.Fatalf("%v", err)
		}
	}
	eq(t, e.M.N(), 0, "requests")
}

func TestCallerDeadlineIsAborted(t *testing.T) {
	e := setup(t, func(r *rec, n int) (*http.Response, error) { return hang(r) })
	ctx, cancel := context.WithTimeout(bg, 40*time.Millisecond)
	defer cancel()
	_, err := e.C.Send(ctx, msg)
	if !unsent.IsAborted(err) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("%v", err)
	}
}

// ---- error mapping -----------------------------------------------------------

func TestErrorMapping(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return apiErr(401, "invalid_signature", "Unauthorized", "Invalid signature (request headers or body may have been tampered with)"), nil
	})
	_, err := e.C.Send(bg, msg)
	a := asAPI(t, err)
	if !unsent.IsAuthentication(err) || !errors.Is(err, unsent.ErrAPI) || unsent.IsConflict(err) {
		t.Fatal("kind helpers")
	}
	eq(t, a.Status, 401, "status")
	eq(t, a.Code, "invalid_signature", "code")
	contains(t, a.Reason, "tampered")
	contains(t, a.Hint, "APISecret")
	matches(t, a.Error(), `(?s)Unauthorized.*tampered.*APISecret`)
	body, ok := a.Body.(map[string]any)
	if !ok || body["code"] != "invalid_signature" {
		t.Fatalf("body %#v", a.Body)
	}
	b := asBase(t, err)
	eq(t, b.Code, "invalid_signature", "base code")
}

func TestExistingEmailIDOnConflict(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(409, map[string]any{"error": "Idempotency key was already used for a different email", "code": "idempotency_key_conflict", "id": 77}), nil
	})
	p := msg
	p.IdempotencyKey = "k"
	_, err := e.C.Send(bg, p)
	a := asAPI(t, err)
	if !unsent.IsConflict(err) || a.ExistingEmailID != 77 {
		t.Fatal(err)
	}
}

func TestRetryAfterOnRateLimit(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return apiErr(429, "rate_limited", "slow down", "", "Retry-After", "7"), nil
	}, withOpts(noRetry))
	_, err := e.C.Send(bg, msg)
	a := asAPI(t, err)
	if !unsent.IsRateLimit(err) || a.RetryAfter != 7*time.Second {
		t.Fatal(err)
	}
}

func TestNonJSONErrorBodies(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return resp(502, "<html>Bad gateway</html>"), nil }, withOpts(noRetry))
	_, err := e.C.Send(bg, msg)
	a := asAPI(t, err)
	eq(t, []any{a.Status, a.Code, unsent.IsServer(err)}, []any{502, "internal_error", true}, "502")
	eq(t, a.Body, "<html>Bad gateway</html>", "body text")
	contains(t, a.Error(), "Bad gateway")
}

func TestEmptyErrorBody(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return resp(404, ""), nil })
	_, err := e.C.Status(bg)
	a := asAPI(t, err)
	eq(t, []any{a.Status, a.Code, a.Error()}, []any{404, "http_404", "Not Found"}, "404")
}

func TestNon2xxUnknownStatusIsAPIError(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return jsonResp(418, map[string]any{"error": "teapot"}), nil })
	_, err := e.C.Status(bg)
	a := asAPI(t, err)
	eq(t, []any{a.Status, a.Code}, []any{418, "http_418"}, "418")
	if unsent.IsRequest(err) || unsent.IsServer(err) {
		t.Fatal("418 has no specific kind")
	}
}

func TestNonJSON200IsInvalidResponse(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return resp(200, "<!doctype html>hi"), nil })
	_, err := e.C.Status(bg)
	b := asBase(t, err)
	eq(t, b.Code, "invalid_response", "code")
	contains(t, b.Message, "BaseURL")
	eq(t, e.M.N(), 1, "not retried")
}

func TestConnectionErrorMentionsHost(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return nil, errors.New("dial tcp: lookup unsent.test: no such host")
	}, withOpts(noRetry))
	_, err := e.C.Send(bg, msg)
	var ce *unsent.ConnectionError
	if !errors.As(err, &ce) {
		t.Fatal(err)
	}
	matches(t, ce.Error(), `unsent\.test.*no such host`)
	eq(t, ce.Code, "connection_error", "code")
}

func TestRedirectIsRefused(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return resp(308, "", "Location", "https://elsewhere.test/api/status"), nil
	})
	_, err := e.C.Status(bg)
	b := asBase(t, err)
	eq(t, b.Code, "unexpected_redirect", "code")
	contains(t, b.Message, "redirected to https://elsewhere.test")
	eq(t, e.M.N(), 1, "not retried")
	for _, st := range []int{301, 302, 303, 307} {
		e := setup(t, func(*rec, int) (*http.Response, error) { return resp(st, ""), nil })
		_, err := e.C.Send(bg, msg)
		eq(t, unsent.CodeOf(err), "unexpected_redirect", fmt.Sprint(st))
		eq(t, e.M.N(), 1, "no retry")
	}
}
