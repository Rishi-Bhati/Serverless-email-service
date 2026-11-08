package unsent

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

type wire = map[string]any

func asMap(v any) wire {
	m, _ := v.(map[string]any)
	return m
}

// str returns v when it is a string, "" otherwise.
func str(v any) string {
	s, _ := v.(string)
	return s
}

// toFloat mimics JS Number(): numbers, numeric strings; ok=false otherwise.
func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return 0, false
		}
		return t, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

func toInt64(v any) int64 {
	f, ok := toFloat(v)
	if !ok || f > 1<<62 || f < -(1<<62) {
		return 0
	}
	return int64(f)
}

func toInt(v any) int {
	n := toInt64(v)
	if n > math.MaxInt32 || n < math.MinInt32 {
		return 0
	}
	return int(n)
}

func toTime(v any) time.Time {
	ms := toInt64(v)
	if ms < -62135596800000 || ms > 253402300799000 { // keep within years 0001-9999
		ms = 0
	}
	return time.UnixMilli(ms).UTC()
}

func strArray(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func parseFailover(raw any) []FailoverAttempt {
	list := raw
	if s, ok := raw.(string); ok {
		var parsed any
		if err := json.Unmarshal([]byte(s), &parsed); err != nil {
			return []FailoverAttempt{}
		}
		list = parsed
	}
	arr, ok := list.([]any)
	if !ok {
		return []FailoverAttempt{}
	}
	out := make([]FailoverAttempt, 0, len(arr))
	for _, x := range arr {
		m := asMap(x)
		out = append(out, FailoverAttempt{
			Provider:  str(m["provider"]),
			Type:      str(m["type"]),
			Error:     str(m["error"]),
			Timestamp: toTime(m["timestamp"]),
		})
	}
	return out
}

func mapFields(w wire) EmailFields {
	html := ""
	if s, ok := w["html_body"].(string); ok {
		html = s
	} else if s, ok := w["body"].(string); ok {
		html = s
	}
	text := ""
	// The API falls back to the HTML body when no plain-text alternative was stored.
	if s, ok := w["text_body"].(string); ok && s != "" && s != html {
		text = s
	}
	status := EmailStatus(str(w["status"]))
	switch status {
	case StatusQueued, StatusSending, StatusSent, StatusFailed:
	default:
		status = StatusQueued
	}
	to := strArray(w["to"])
	if to == nil {
		to = []string{}
	}
	return EmailFields{
		ID:              toInt64(w["id"]),
		Status:          status,
		To:              to,
		CC:              strArray(w["cc"]),
		BCC:             strArray(w["bcc"]),
		Subject:         str(w["subject"]),
		HTMLBody:        html,
		TextBody:        text,
		FromEmail:       str(w["from_email"]),
		FromName:        str(w["from_name"]),
		ProviderID:      str(w["provider_id"]),
		ProviderUsed:    str(w["provider_used"]),
		FailoverHistory: parseFailover(w["failover_history"]),
		IdempotencyKey:  str(w["idempotency_key"]),
		Attempts:        toInt(w["attempts"]),
		Error:           str(w["error"]),
		CreatedAt:       toTime(w["created_at"]),
		UpdatedAt:       toTime(w["updated_at"]),
	}
}

func mapEmail(w wire) Email {
	atts := []AttachmentInfo{}
	if arr, ok := w["attachments"].([]any); ok {
		for _, x := range arr {
			a := asMap(x)
			size := int64(0)
			if f, ok := a["size"].(float64); ok && !math.IsNaN(f) && !math.IsInf(f, 0) && f >= 0 && f < 1<<53 {
				size = int64(f)
			} else if c, ok := a["content"].(string); ok {
				size = base64Size(c)
			}
			atts = append(atts, AttachmentInfo{Filename: str(a["filename"]), MimeType: str(a["mimeType"]), Size: size})
		}
	}
	return Email{EmailFields: mapFields(w), Attachments: atts}
}

func mapEmailDetail(w wire) EmailDetail {
	atts := []AttachmentContent{}
	if arr, ok := w["attachments"].([]any); ok {
		for _, x := range arr {
			a := asMap(x)
			c := str(a["content"])
			atts = append(atts, AttachmentContent{
				AttachmentInfo: AttachmentInfo{Filename: str(a["filename"]), MimeType: str(a["mimeType"]), Size: base64Size(c)},
				Content:        c,
			})
		}
	}
	return EmailDetail{EmailFields: mapFields(w), Attachments: atts}
}
