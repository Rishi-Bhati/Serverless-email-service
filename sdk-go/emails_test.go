package unsent_test

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"testing"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func noRetry(o *unsent.Options) { o.MaxRetries = unsent.Int(0) }

// Shapes copied from GET /api/emails and GET /api/emails/:id in src/index.ts.
func listRow(over map[string]any) map[string]any {
	m := map[string]any{
		"id": 3, "to_json": `["a@b.co"]`, "subject": "Hello", "body": "<p>Hi</p>", "html_body": "<p>Hi</p>",
		"text_body": "<p>Hi</p>", "from_email": "me@x.co", "from_name": "Me", "provider_id": nil, "provider_used": "SES",
		"failover_history": `[{"provider":"SMTP","type":"smtp","error":"timeout","timestamp":1780000000000}]`,
		"idempotency_key":  "k-1", "status": "sent", "attempts": 1, "error": nil, "error_message": nil,
		"created_at": 1780000000000, "updated_at": 1780000005000, "to": []string{"a@b.co"},
		"attachments": []any{map[string]any{"filename": "a.pdf", "mimeType": "application/pdf", "size": 1234}}, "attachment_count": 1,
	}
	for k, v := range over {
		m[k] = v
	}
	return m
}

func TestGetMapsDetail(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"email": listRow(map[string]any{
			"text_body": "Hi", "cc": []string{"c@d.co"},
			"attachments": []any{map[string]any{"filename": "a.txt", "mimeType": "text/plain", "content": "aGVsbG8="}},
		})}), nil
	}, withOpts(noRetry))
	em, err := e.C.Emails.Get(bg, 3)
	if err != nil {
		t.Fatal(err)
	}
	r := e.M.Calls()[0]
	eq(t, r.URL.Path, "/api/emails/3", "path")
	eq(t, r.Header.Get("X-API-Key"), testKey, "key")
	eq(t, r.Header.Get("X-Signature"), "", "unsigned")
	eq(t, em.ID, 3, "id")
	eq(t, em.Status, unsent.StatusSent, "status")
	eq(t, em.To, []string{"a@b.co"}, "to")
	eq(t, em.CC, []string{"c@d.co"}, "cc")
	if em.BCC != nil {
		t.Fatalf("bcc should be nil, got %v", em.BCC)
	}
	eq(t, em.Subject, "Hello", "subject")
	eq(t, em.HTMLBody, "<p>Hi</p>", "html")
	eq(t, em.TextBody, "Hi", "text")
	eq(t, em.FromEmail, "me@x.co", "from")
	eq(t, em.FromName, "Me", "name")
	eq(t, em.ProviderUsed, "SES", "provider")
	eq(t, em.IdempotencyKey, "k-1", "key")
	eq(t, em.Attempts, 1, "attempts")
	eq(t, em.Error, "", "error")
	if !em.CreatedAt.Equal(time.UnixMilli(1780000000000)) || !em.UpdatedAt.Equal(time.UnixMilli(1780000005000)) {
		t.Fatalf("times %v %v", em.CreatedAt, em.UpdatedAt)
	}
	eq(t, len(em.FailoverHistory), 1, "failover")
	eq(t, em.FailoverHistory[0].Provider, "SMTP", "failover provider")
	eq(t, em.FailoverHistory[0].Error, "timeout", "failover error")
	if !em.FailoverHistory[0].Timestamp.Equal(time.UnixMilli(1780000000000)) {
		t.Fatal("failover time")
	}
	eq(t, len(em.Attachments), 1, "attachments")
	a := em.Attachments[0]
	eq(t, []any{a.Filename, a.MimeType, a.Size, a.Content}, []any{"a.txt", "text/plain", 5, "aGVsbG8="}, "attachment")
	raw, err := a.DecodeContent()
	eq(t, string(raw), "hello", "decoded")
	if err != nil {
		t.Fatal(err)
	}
}

func TestTextBodyEmptyWhenOnlyHTMLEchoed(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"email": listRow(nil)}), nil
	})
	em, err := e.C.Emails.Get(bg, 3)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, em.TextBody, "", "text")
}

func TestGetNotFound(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(404, "not_found", "Email not found", ""), nil })
	_, err := e.C.Emails.Get(bg, 999)
	if !unsent.IsNotFound(err) || !errors.Is(err, unsent.ErrNotFound) {
		t.Fatalf("%v", err)
	}
	eq(t, e.M.N(), 1, "no retry on 404")
}

func TestGetRejectsInvalidIDs(t *testing.T) {
	for _, id := range []int64{0, -1, -9223372036854775808} {
		e := setup(t, okHandler(1))
		if _, err := e.C.Emails.Get(bg, id); !unsent.IsValidation(err) || e.M.N() != 0 {
			t.Errorf("id %d: %v", id, err)
		}
	}
}

func TestMalformedFailoverHistory(t *testing.T) {
	for _, fh := range []any{"{not json", 5, "{}", nil, "[1,\"x\",null]"} {
		e := setup(t, func(*rec, int) (*http.Response, error) {
			return jsonResp(200, map[string]any{"email": listRow(map[string]any{"failover_history": fh})}), nil
		})
		em, err := e.C.Emails.Get(bg, 3)
		if err != nil {
			t.Fatal(err)
		}
		if fh == "[1,\"x\",null]" {
			eq(t, len(em.FailoverHistory), 3, "lenient entries")
		} else {
			eq(t, len(em.FailoverHistory), 0, "empty history")
		}
	}
}

func TestGetRejectsWrongShapes(t *testing.T) {
	for _, body := range []string{`[]`, `{}`, `{"email":null}`, `{"email":[1]}`, `"x"`, `5`, `null`} {
		e := setup(t, func(*rec, int) (*http.Response, error) { return resp(200, body), nil })
		_, err := e.C.Emails.Get(bg, 1)
		eq(t, unsent.CodeOf(err), "invalid_response", body)
	}
}

func TestListBuildsQueryAndMapsPage(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"emails": []any{listRow(nil), listRow(map[string]any{"id": 2})}, "results": []any{}, "total": 5, "limit": 2, "offset": 0}), nil
	}, withOpts(noRetry))
	page, err := e.C.Emails.List(bg, &unsent.ListParams{
		Limit: 2, Status: unsent.StatusFailed, Search: "invoice",
		FromTime: time.Date(2026, 1, 5, 23, 0, 0, 0, time.UTC), To: "2026-02-01", Sort: unsent.SortCreatedAtAsc,
	})
	if err != nil {
		t.Fatal(err)
	}
	q := e.M.Calls()[0].URL.Query()
	got := map[string]string{}
	for k := range q {
		got[k] = q.Get(k)
	}
	eq(t, got, map[string]string{"limit": "2", "status": "failed", "q": "invoice", "from": "2026-01-05", "to": "2026-02-01", "sort": "created_at_asc"}, "query")
	eq(t, []int64{page.Emails[0].ID, page.Emails[1].ID}, []int64{3, 2}, "ids")
	eq(t, []any{page.Total, page.Limit, page.Offset, page.HasMore}, []any{5, 2, 0, true}, "page")
	eq(t, page.Emails[0].Attachments, []unsent.AttachmentInfo{{Filename: "a.pdf", MimeType: "application/pdf", Size: 1234}}, "attachments")
}

func TestListTimezoneIsUTC(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"emails": []any{}, "total": 0}), nil
	})
	loc := time.FixedZone("x", 14*3600)
	_, err := e.C.Emails.List(bg, &unsent.ListParams{FromTime: time.Date(2026, 3, 2, 1, 0, 0, 0, loc)})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, e.M.Calls()[0].URL.Query().Get("from"), "2026-03-01", "from")
}

func TestListOmitsUnsetAndNoMore(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"emails": []any{listRow(nil)}, "total": 1, "limit": 100, "offset": 0}), nil
	})
	page, err := e.C.Emails.List(bg, nil)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, e.M.Calls()[0].URL.RawQuery, "", "query")
	eq(t, page.HasMore, false, "hasMore")
}

func TestListRejectsInvalidParams(t *testing.T) {
	bad := []unsent.ListParams{
		{Limit: -1}, {Limit: 201}, {Offset: -1}, {From: "yesterday"}, {To: "2026-13-45"}, {From: "2026-1-1"},
		{Status: "done"}, {Sort: "random"}, {FromTime: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)},
		{From: "2026-01-01", FromTime: time.Now()}, {Search: "a\xff"},
	}
	for i := range bad {
		e := setup(t, okHandler(1))
		_, err := e.C.Emails.List(bg, &bad[i])
		if !unsent.IsValidation(err) || e.M.N() != 0 {
			t.Errorf("%+v: %v", bad[i], err)
		}
	}
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"emails": []any{}, "total": 0}), nil
	})
	if _, err := e.C.Emails.List(bg, &unsent.ListParams{From: "2026-01-05T10:00:00Z"}); err != nil {
		t.Fatalf("timestamp prefix should be accepted: %v", err)
	}
	eq(t, e.M.Calls()[0].URL.Query().Get("from"), "2026-01-05", "from")
}

func pagedHandler(total int) handlerFn {
	all := make([]any, total)
	for i := range all {
		all[i] = listRow(map[string]any{"id": i + 1})
	}
	return func(r *rec, _ int) (*http.Response, error) {
		q := r.URL.Query()
		off, _ := strconv.Atoi(q.Get("offset"))
		lim := 100
		if v := q.Get("limit"); v != "" {
			lim, _ = strconv.Atoi(v)
		}
		end := off + lim
		if end > total {
			end = total
		}
		if off > total {
			off = total
		}
		return jsonResp(200, map[string]any{"emails": all[off:end], "total": total, "limit": lim, "offset": off}), nil
	}
}

func TestIterateWalksAllPages(t *testing.T) {
	e := setup(t, pagedHandler(5))
	it := e.C.Emails.Iterate(bg, &unsent.ListParams{Limit: 2})
	var ids []int64
	for it.Next(bg) {
		ids = append(ids, it.Email().ID)
	}
	if it.Err() != nil {
		t.Fatal(it.Err())
	}
	eq(t, ids, []int64{1, 2, 3, 4, 5}, "ids")
	var offs []string
	for _, c := range e.M.Calls() {
		offs = append(offs, c.URL.Query().Get("offset"))
	}
	eq(t, offs, []string{"", "2", "4"}, "offsets")
	eq(t, e.M.Calls()[0].URL.Query().Get("sort"), "created_at_asc", "default sort")
	if it.Next(bg) {
		t.Fatal("Next after the end must stay false")
	}
}

func TestIterateStartOffsetSortAndEach(t *testing.T) {
	e := setup(t, pagedHandler(5))
	var ids []int64
	err := e.C.Emails.Each(bg, &unsent.ListParams{Limit: 2, Offset: 3, Sort: unsent.SortCreatedAtDesc}, func(m unsent.Email) error {
		ids = append(ids, m.ID)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, ids, []int64{4, 5}, "ids")
	eq(t, e.M.Calls()[0].URL.Query().Get("sort"), "created_at_desc", "sort")

	stop := errors.New("stop")
	n := 0
	err = e.C.Emails.Each(bg, nil, func(unsent.Email) error { n++; return stop })
	if !errors.Is(err, stop) || n != 1 {
		t.Fatalf("%v %d", err, n)
	}
}

func TestIterateEmptyAndOverReportedTotal(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"emails": []any{}, "total": 10, "limit": 100, "offset": 0}), nil
	})
	it := e.C.Emails.Iterate(bg, nil)
	if it.Next(bg) || it.Err() != nil {
		t.Fatalf("%v", it.Err())
	}
	eq(t, e.M.N(), 1, "requests")
}

func TestIterateSurfacesErrors(t *testing.T) {
	e := setup(t, okHandler(1))
	it := e.C.Emails.Iterate(bg, &unsent.ListParams{Limit: 999})
	if it.Next(bg) || !unsent.IsValidation(it.Err()) || e.M.N() != 0 {
		t.Fatalf("%v", it.Err())
	}
	e2 := setup(t, func(*rec, int) (*http.Response, error) {
		return apiErr(401, "invalid_api_key", "Unauthorized", ""), nil
	})
	it = e2.C.Emails.Iterate(bg, nil)
	if it.Next(bg) || !unsent.IsAuthentication(it.Err()) {
		t.Fatal("expected auth error")
	}
	it = e.C.Emails.Iterate(bg, nil, unsent.WithTimeout(-1))
	if it.Next(bg) || !unsent.IsValidation(it.Err()) {
		t.Fatal("bad call option")
	}
}

func waitHandler(statuses ...map[string]any) handlerFn {
	return func(_ *rec, n int) (*http.Response, error) {
		s := statuses[len(statuses)-1]
		if n <= len(statuses) {
			s = statuses[n-1]
		}
		return jsonResp(200, map[string]any{"email": listRow(s)}), nil
	}
}

func TestWaitPollsUntilSent(t *testing.T) {
	e := setup(t, waitHandler(map[string]any{"status": "queued"}, map[string]any{"status": "sending"}, map[string]any{"status": "sent"}))
	em, err := e.C.Emails.Wait(bg, 3, nil)
	if err != nil || em.Status != unsent.StatusSent {
		t.Fatalf("%v %+v", err, em)
	}
	eq(t, e.M.N(), 3, "polls")
	eq(t, e.Clock.Sleeps(), []time.Duration{time.Second, 1500 * time.Millisecond}, "interval grows 1.5x")
}

func TestWaitIntervalCapsAt5s(t *testing.T) {
	e := setup(t, waitHandler(map[string]any{"status": "queued", "attempts": 0}))
	_, err := e.C.Emails.Wait(bg, 3, &unsent.WaitOptions{Timeout: 40 * time.Second, Interval: time.Second})
	if !unsent.IsTimeout(err) {
		t.Fatal(err)
	}
	for _, s := range e.Clock.Sleeps() {
		if s > 5*time.Second {
			t.Fatalf("sleep %v exceeds 5s", s)
		}
	}
	eq(t, e.Clock.Sleeps()[:5], []time.Duration{time.Second, 1500 * time.Millisecond, 2250 * time.Millisecond, 3375 * time.Millisecond, 5 * time.Second}, "progression")
}

func TestWaitKeepsWaitingOnFailedWithAttemptsLeft(t *testing.T) {
	e := setup(t, waitHandler(
		map[string]any{"status": "failed", "attempts": 1, "error": "boom"},
		map[string]any{"status": "failed", "attempts": 2, "error": "boom"},
		map[string]any{"status": "failed", "attempts": unsent.MaxDeliveryAttempts, "error": "boom"}))
	em, err := e.C.Emails.Wait(bg, 3, nil)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, []any{em.Status, em.Attempts, em.Error}, []any{unsent.StatusFailed, 3, "boom"}, "final")
	eq(t, e.M.N(), 3, "polls")
}

func TestWaitTimesOut(t *testing.T) {
	e := setup(t, waitHandler(map[string]any{"status": "queued", "attempts": 0}))
	_, err := e.C.Emails.Wait(bg, 3, &unsent.WaitOptions{Timeout: 3 * time.Second})
	if !unsent.IsTimeout(err) || !unsent.IsConnection(err) || unsent.CodeOf(err) != "timeout" {
		t.Fatal(err)
	}
	matches(t, err.Error(), `Email 3.*queued.*3s`)
}

func TestWaitAbort(t *testing.T) {
	e := setup(t, waitHandler(map[string]any{"status": "queued", "attempts": 0}))
	ctx, cancel := context.WithCancel(bg)
	e.C.SetSleep(func(c context.Context, d time.Duration) error { cancel(); return c.Err() })
	_, err := e.C.Emails.Wait(ctx, 3, nil)
	if !unsent.IsAborted(err) || !errors.Is(err, context.Canceled) {
		t.Fatalf("%v", err)
	}
	// real timer: cancel during an actual sleep
	e.C.SetSleep(nil)
	ctx, cancel = context.WithCancel(bg)
	go func() { time.Sleep(30 * time.Millisecond); cancel() }()
	start := time.Now()
	_, err = e.C.Emails.Wait(ctx, 3, nil)
	if !unsent.IsAborted(err) || time.Since(start) > 900*time.Millisecond {
		t.Fatalf("%v after %v", err, time.Since(start))
	}
}

func TestWaitPropagatesLookupErrorsAndValidates(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) { return apiErr(404, "not_found", "Email not found", ""), nil })
	if _, err := e.C.Emails.Wait(bg, 3, nil); !unsent.IsNotFound(err) {
		t.Fatal(err)
	}
	for _, o := range []*unsent.WaitOptions{{Timeout: -1}, {Interval: -1}} {
		if _, err := e.C.Emails.Wait(bg, 3, o); !unsent.IsValidation(err) {
			t.Fatal(err)
		}
	}
	if _, err := e.C.Emails.Wait(bg, 0, nil); !unsent.IsValidation(err) {
		t.Fatal(err)
	}
}

func TestStatus(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"queued": 1, "sending": 2, "sent": 3, "failed": 4}), nil
	})
	s, err := e.C.Status(bg)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, *s, unsent.QueueStatus{Queued: 1, Sending: 2, Sent: 3, Failed: 4}, "status")
	eq(t, e.M.Calls()[0].URL.Path, "/api/status", "path")
	eq(t, e.M.Calls()[0].Header.Get("X-API-Key"), testKey, "key")
	e2 := setup(t, func(*rec, int) (*http.Response, error) { return resp(200, `{}`), nil })
	s, _ = e2.C.Status(bg)
	eq(t, *s, unsent.QueueStatus{}, "defaults")
}

func TestHealthNeedsNoCredentials(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return jsonResp(200, map[string]any{"status": "ok", "runtime": "cf_worker", "d1": "bound", "timestamp": 1780000000000}), nil
	})
	h, err := e.C.Health(bg)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, []any{h.Status, h.Runtime, h.D1}, []any{"ok", "cf_worker", "bound"}, "health")
	if !h.Timestamp.Equal(time.UnixMilli(1780000000000)) {
		t.Fatal(h.Timestamp)
	}
	eq(t, e.M.Calls()[0].Header.Get("X-API-Key"), "", "no key on health")
}

func TestStatusBadCredentialsHaveHint(t *testing.T) {
	e := setup(t, func(*rec, int) (*http.Response, error) {
		return apiErr(401, "invalid_api_key", "Unauthorized", "Invalid API key"), nil
	})
	_, err := e.C.Status(bg)
	a := asAPI(t, err)
	eq(t, a.Status, 401, "status")
	eq(t, a.Code, "invalid_api_key", "code")
	contains(t, a.Hint, "API_KEY")
	contains(t, a.Error(), "Unauthorized: Invalid API key (Check that APIKey")
}
