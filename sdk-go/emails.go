package unsent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxSubject     = 1000
	maxProviderLen = 255
)

// Emails sends and inspects emails. Obtain it from Client.Emails.
type Emails struct {
	h               *httpClient
	defaultFrom     Address
	defaultProvider string
}

// String describes the resource without exposing credentials.
func (e *Emails) String() string { return "unsent.Emails" }

// GoString implements fmt.GoStringer without exposing credentials.
func (e *Emails) GoString() string { return "unsent.Emails" }

// Format implements fmt.Formatter so no verb can print credentials.
func (e *Emails) Format(f fmt.State, _ rune) { _, _ = fmt.Fprint(f, "unsent.Emails") }

// MarshalJSON never serialises credentials.
func (e *Emails) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }

func escapeHTML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
}

func validateProviderID(p string) error {
	if strings.TrimSpace(p) == "" || utf16Len(p) > maxProviderLen {
		return fmt.Errorf(`"ProviderID" must be a non-empty string up to 255 characters`)
	}
	if !utf8.ValidString(p) || hasCRLFNUL(p) {
		return fmt.Errorf(`"ProviderID" must be valid UTF-8 without line breaks`)
	}
	return nil
}

// validIdempotencyKey checks ^[\x21-\x7e]{1,255}$.
func validIdempotencyKey(k string) bool {
	if len(k) < 1 || len(k) > 255 {
		return false
	}
	for i := 0; i < len(k); i++ {
		if k[i] < 0x21 || k[i] > 0x7e {
			return false
		}
	}
	return true
}

type wireSend struct {
	To             []string         `json:"to"`
	CC             []string         `json:"cc,omitempty"`
	BCC            []string         `json:"bcc,omitempty"`
	Subject        string           `json:"subject"`
	HTML           string           `json:"html"`
	Text           string           `json:"text,omitempty"`
	Attachments    []wireAttachment `json:"attachments,omitempty"`
	From           *wireAddr        `json:"from,omitempty"`
	ProviderID     string           `json:"provider_id,omitempty"`
	IdempotencyKey string           `json:"idempotency_key,omitempty"`
}

func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// buildSend validates p and returns the exact JSON body to send plus the idempotency key ("" = none).
func (e *Emails) buildSend(p SendParams) ([]byte, string, error) {
	to, err := normalizeRecipients(p.To, "to", true)
	if err != nil {
		return nil, "", err
	}
	cc, err := normalizeRecipients(p.CC, "cc", false)
	if err != nil {
		return nil, "", err
	}
	bcc, err := normalizeRecipients(p.BCC, "bcc", false)
	if err != nil {
		return nil, "", err
	}

	if strings.TrimSpace(p.Subject) == "" {
		return nil, "", newValidationErr(`"subject" is required`)
	}
	if !utf8.ValidString(p.Subject) {
		return nil, "", newValidationErr(`"subject" must be valid UTF-8`)
	}
	if n := utf16Len(p.Subject); n > maxSubject {
		return nil, "", newValidationErr(fmt.Sprintf(`"subject" is %d characters (maximum %d)`, n, maxSubject))
	}

	hasHTML := strings.TrimSpace(p.HTML) != ""
	hasText := strings.TrimSpace(p.Text) != ""
	if !utf8.ValidString(p.HTML) {
		return nil, "", newValidationErr(`"html" must be valid UTF-8`)
	}
	if !utf8.ValidString(p.Text) {
		return nil, "", newValidationErr(`"text" must be valid UTF-8`)
	}
	if !hasHTML && !hasText {
		return nil, "", newValidationErr(`Provide "html", "text", or both`)
	}
	html := p.HTML
	if !hasHTML {
		// The API requires an HTML body; derive one from the text so text-only sends just work.
		html = `<div style="white-space:pre-wrap">` + escapeHTML(p.Text) + `</div>`
	}

	if len(p.Attachments) > MaxAttachments {
		return nil, "", newValidationErr(fmt.Sprintf("Too many attachments (%d, maximum %d)", len(p.Attachments), MaxAttachments))
	}
	var atts []wireAttachment
	for i, a := range p.Attachments {
		w, err := buildAttachment(a, i)
		if err != nil {
			return nil, "", err
		}
		atts = append(atts, w)
	}

	fromIn := p.From
	if fromIn == (Address{}) {
		fromIn = e.defaultFrom
	}
	from, err := resolveFrom(fromIn, "from")
	if err != nil {
		return nil, "", err
	}

	providerID := p.ProviderID
	if providerID == "" {
		providerID = e.defaultProvider
	}
	if providerID != "" {
		if err := validateProviderID(providerID); err != nil {
			return nil, "", newValidationErr(err.Error())
		}
		providerID = strings.TrimSpace(providerID)
	}

	key := ""
	switch {
	case p.NoIdempotency && p.IdempotencyKey != "":
		return nil, "", newValidationCode(`"IdempotencyKey" and "NoIdempotency" are mutually exclusive`, "invalid_idempotency_key")
	case p.NoIdempotency:
	case p.IdempotencyKey == "":
		k, err := newUUID()
		if err != nil {
			return nil, "", err
		}
		key = k
	default:
		key = strings.TrimSpace(p.IdempotencyKey)
		if !validIdempotencyKey(key) {
			return nil, "", newValidationCode(`"IdempotencyKey" must be 1-255 printable ASCII characters without spaces (e.g. a UUID or "order-123:receipt")`, "invalid_idempotency_key")
		}
	}

	w := wireSend{To: to, CC: cc, BCC: bcc, Subject: p.Subject, HTML: html, Attachments: atts, From: from, ProviderID: providerID, IdempotencyKey: key}
	if hasText {
		w.Text = p.Text
	}
	body, err := marshalNoEscape(w)
	if err != nil {
		return nil, "", newValidationErr("could not encode the message: " + sanitizeText(err.Error()))
	}
	if len(body) > maxBodyBytes {
		return nil, "", newValidationCode(fmt.Sprintf("The request body is %d bytes (maximum %d)", len(body), maxBodyBytes), "payload_too_large")
	}
	return body, key, nil
}

// Send queues an email for delivery. It returns as soon as the service has accepted it (HTTP 202);
// delivery happens in the background (use Wait to block until it is sent).
//
// Retries on network errors, timeouts, 408/425/429 and 5xx are automatic and cannot cause duplicates:
// every send carries an idempotency key (yours, or a generated UUID). With NoIdempotency a send is never retried.
func (e *Emails) Send(ctx context.Context, p SendParams, opts ...CallOption) (*SendResult, error) {
	cfg, err := e.h.callConfig(opts)
	if err != nil {
		return nil, err
	}
	body, key, err := e.buildSend(p)
	if err != nil {
		return nil, err
	}
	res, err := e.h.call(ctx, &callOp{
		method: "POST", path: "/api/send", body: body, sign: true,
		// Without a key a retry could duplicate the email, so only keyed sends are retried.
		retrySafe: key != "", timeout: cfg.timeout, maxRetries: cfg.maxRetries,
	})
	if err != nil {
		return nil, err
	}
	d := asMap(res.data)
	id := toInt64(d["id"])
	if d == nil || id < 1 {
		return nil, &BaseError{Code: "invalid_response", Message: "The /api/send response has no email id. Is BaseURL pointing at your Unsent deployment?"}
	}
	status := EmailStatus(str(d["status"]))
	if status == "" {
		status = StatusQueued
	}
	out := &SendResult{
		ID:               id,
		Status:           status,
		IdempotencyKey:   key,
		IdempotentReplay: d["idempotent_replay"] == true || res.header.Get("Idempotent-Replayed") == "true",
		TargetProvider:   str(d["targetProvider"]),
		Message:          str(d["message"]),
	}
	if k := str(d["idempotency_key"]); k != "" {
		out.IdempotencyKey = k
	}
	return out, nil
}

// Get fetches one email, including attachment contents. It returns a *APIError with status 404 if it does not exist.
func (e *Emails) Get(ctx context.Context, id int64, opts ...CallOption) (*EmailDetail, error) {
	cfg, err := e.h.callConfig(opts)
	if err != nil {
		return nil, err
	}
	if id < 1 {
		return nil, newValidationErr(`"id" must be a positive integer`)
	}
	path := "/api/emails/" + strconv.FormatInt(id, 10)
	res, err := e.h.call(ctx, &callOp{method: "GET", path: path, retrySafe: true, timeout: cfg.timeout, maxRetries: cfg.maxRetries})
	if err != nil {
		return nil, err
	}
	m := asMap(asMap(res.data)["email"])
	if m == nil {
		return nil, invalidShape(path)
	}
	d := mapEmailDetail(m)
	return &d, nil
}

func dayParam(s string, t time.Time, field string) (string, error) {
	if s != "" && !t.IsZero() {
		return "", newValidationErr(fmt.Sprintf(`set only one of "%s" and "%sTime"`, field, field))
	}
	if !t.IsZero() {
		u := t.UTC()
		if y := u.Year(); y < 0 || y > 9999 {
			return "", newValidationErr(fmt.Sprintf(`"%sTime" is out of range`, field))
		}
		return u.Format("2006-01-02"), nil
	}
	if s == "" {
		return "", nil
	}
	if len(s) < 10 {
		return "", newValidationErr(fmt.Sprintf(`"%s" must be YYYY-MM-DD`, field))
	}
	if _, err := time.Parse("2006-01-02", s[:10]); err != nil {
		return "", newValidationErr(fmt.Sprintf(`"%s" must be YYYY-MM-DD`, field))
	}
	return s[:10], nil
}

func validStatus(s EmailStatus) bool {
	switch s {
	case StatusQueued, StatusSending, StatusSent, StatusFailed:
		return true
	}
	return false
}

func validSort(s Sort) bool {
	switch s {
	case SortUpdatedAtDesc, SortUpdatedAtAsc, SortCreatedAtDesc, SortCreatedAtAsc, SortAttemptsDesc:
		return true
	}
	return false
}

func buildListQuery(p ListParams) (url.Values, error) {
	if p.Limit < 0 || p.Limit > 200 {
		return nil, newValidationErr(`"Limit" must be an integer from 1 to 200`)
	}
	if p.Offset < 0 {
		return nil, newValidationErr(`"Offset" must be a non-negative integer`)
	}
	if p.Status != "" && !validStatus(p.Status) {
		return nil, newValidationErr(`"Status" must be one of queued, sending, sent, failed`)
	}
	if p.Sort != "" && !validSort(p.Sort) {
		return nil, newValidationErr(`"Sort" must be one of updated_at_desc, updated_at_asc, created_at_desc, created_at_asc, attempts_desc`)
	}
	if !utf8.ValidString(p.Search) {
		return nil, newValidationErr(`"Search" must be valid UTF-8`)
	}
	from, err := dayParam(p.From, p.FromTime, "From")
	if err != nil {
		return nil, err
	}
	to, err := dayParam(p.To, p.ToTime, "To")
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	if p.Limit > 0 {
		q.Set("limit", strconv.Itoa(p.Limit))
	}
	if p.Offset > 0 {
		q.Set("offset", strconv.Itoa(p.Offset))
	}
	if p.Status != "" {
		q.Set("status", string(p.Status))
	}
	if p.Search != "" {
		q.Set("q", p.Search)
	}
	if from != "" {
		q.Set("from", from)
	}
	if to != "" {
		q.Set("to", to)
	}
	if p.Sort != "" {
		q.Set("sort", string(p.Sort))
	}
	return q, nil
}

// List returns one page of emails, newest-updated first by default. Attachment contents are not included.
// params may be nil.
func (e *Emails) List(ctx context.Context, params *ListParams, opts ...CallOption) (*ListResult, error) {
	page, _, err := e.list(ctx, params, opts)
	return page, err
}

func (e *Emails) list(ctx context.Context, params *ListParams, opts []CallOption) (*ListResult, int, error) {
	cfg, err := e.h.callConfig(opts)
	if err != nil {
		return nil, 0, err
	}
	var p ListParams
	if params != nil {
		p = *params
	}
	q, err := buildListQuery(p)
	if err != nil {
		return nil, 0, err
	}
	res, err := e.h.call(ctx, &callOp{method: "GET", path: "/api/emails", query: q, retrySafe: true, timeout: cfg.timeout, maxRetries: cfg.maxRetries})
	if err != nil {
		return nil, 0, err
	}
	d := asMap(res.data)
	if d == nil {
		return nil, 0, invalidShape("/api/emails")
	}
	rows, _ := d["emails"].([]any)
	emails := make([]Email, 0, len(rows))
	for _, r := range rows {
		if m := asMap(r); m != nil {
			emails = append(emails, mapEmail(m))
		}
	}
	total := toInt(d["total"])
	off := toInt(d["offset"])
	limit := toInt(d["limit"])
	if limit == 0 {
		limit = len(emails)
	}
	return &ListResult{Emails: emails, Total: total, Limit: limit, Offset: off, HasMore: off+len(emails) < total}, len(rows), nil
}

// Iterator walks every matching email, fetching pages as needed. Use it like bufio.Scanner:
//
//	it := client.Emails.Iterate(ctx, &unsent.ListParams{Status: unsent.StatusFailed})
//	for it.Next(ctx) {
//		email := it.Email()
//	}
//	if err := it.Err(); err != nil { ... }
//
// An Iterator is not safe for concurrent use.
type Iterator struct {
	e       *Emails
	params  ListParams
	opts    []CallOption
	offset  int
	buf     []Email
	cur     Email
	started bool
	done    bool
	err     error
}

// Iterate returns an Iterator. It defaults to oldest-first (created_at_asc) so emails sent while
// iterating do not shift pages; params.Offset is the starting offset. Validation errors surface from Next/Err.
func (e *Emails) Iterate(ctx context.Context, params *ListParams, opts ...CallOption) *Iterator {
	it := &Iterator{e: e, opts: opts}
	if params != nil {
		it.params = *params
	}
	if it.params.Sort == "" {
		it.params.Sort = SortCreatedAtAsc
	}
	it.offset = it.params.Offset
	if _, err := e.h.callConfig(opts); err != nil {
		it.err, it.done = err, true
	} else if _, err := buildListQuery(it.params); err != nil {
		it.err, it.done = err, true
	}
	return it
}

// Next advances to the next email, fetching a new page when needed. It returns false at the end or on error (see Err).
func (it *Iterator) Next(ctx context.Context) bool {
	for len(it.buf) == 0 {
		if it.done {
			return false
		}
		if it.started && it.err != nil {
			return false
		}
		p := it.params
		p.Offset = it.offset
		page, raw, err := it.e.list(ctx, &p, it.opts)
		if err != nil {
			it.err, it.done = err, true
			return false
		}
		it.started = true
		it.buf = page.Emails
		it.offset += raw
		if !page.HasMore || raw == 0 {
			it.done = true
		}
	}
	it.cur = it.buf[0]
	it.buf = it.buf[1:]
	return true
}

// Email returns the current email (valid after Next returned true).
func (it *Iterator) Email() Email { return it.cur }

// Err returns the error that ended the iteration, if any.
func (it *Iterator) Err() error { return it.err }

// Each calls fn for every matching email until fn returns an error (which Each returns) or iteration ends.
func (e *Emails) Each(ctx context.Context, params *ListParams, fn func(Email) error, opts ...CallOption) error {
	it := e.Iterate(ctx, params, opts...)
	for it.Next(ctx) {
		if err := fn(it.Email()); err != nil {
			return err
		}
	}
	return it.Err()
}

func isFinal(e *EmailDetail) bool {
	return e.Status == StatusSent || (e.Status == StatusFailed && e.Attempts >= MaxDeliveryAttempts)
}

// Wait polls until the email is delivered (sent) or has permanently failed (failed after all attempts)
// and returns it. Check email.Status: a permanent failure is not an error. If the email is still in
// flight after opts.Timeout (default 60s) a *ConnectionError with code "timeout" is returned.
// Cancelling ctx returns a *ConnectionError with code "aborted". opts may be nil.
func (e *Emails) Wait(ctx context.Context, id int64, opts *WaitOptions, callOpts ...CallOption) (*EmailDetail, error) {
	var o WaitOptions
	if opts != nil {
		o = *opts
	}
	if o.Timeout < 0 || o.Interval < 0 {
		return nil, newValidationErr("wait Timeout and Interval must not be negative")
	}
	timeout := o.Timeout
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	interval := o.Interval
	if interval == 0 {
		interval = time.Second
	}
	if interval < 100*time.Millisecond {
		interval = 100 * time.Millisecond
	}
	deadline := e.h.nowFn().Add(timeout)
	for {
		email, err := e.Get(ctx, id, callOpts...)
		if err != nil {
			return nil, err
		}
		if isFinal(email) {
			return email, nil
		}
		remaining := deadline.Sub(e.h.nowFn())
		if remaining <= 0 {
			return nil, timeoutError(fmt.Sprintf("Email %d was still %q after %s", id, email.Status, timeout), nil)
		}
		if err := e.h.sleepFn(ctx, minDur(interval, remaining)); err != nil {
			return nil, abortedError(ctx)
		}
		interval = time.Duration(math.Min(float64(5*time.Second), math.Round(float64(interval)*1.5)))
	}
}
