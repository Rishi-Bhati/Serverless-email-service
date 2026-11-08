package unsent

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxAttachments is the maximum number of attachments per email.
	MaxAttachments = 20
	// maxBodyBytes mirrors the server's request limit.
	maxBodyBytes     = 3 * 1024 * 1024
	maxRawAttachment = maxBodyBytes / 4 * 3
)

type wireAttachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
	MimeType string `json:"mimeType,omitempty"`
}

var mimeByExt = map[string]string{
	".pdf":  "application/pdf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".txt":  "text/plain",
	".csv":  "text/csv",
	".json": "application/json",
	".html": "text/html",
	".xml":  "application/xml",
	".zip":  "application/zip",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ics":  "text/calendar",
}

// AttachmentFromFile reads a file from disk as an attachment. The filename is the base name and the
// content type is guessed from the extension. Override fields on the returned value if needed.
func AttachmentFromFile(path string) (Attachment, error) {
	f, err := os.Open(path)
	if err != nil {
		return Attachment{}, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxRawAttachment+1))
	if err != nil {
		return Attachment{}, err
	}
	if len(b) > maxRawAttachment {
		return Attachment{}, newValidationCode(fmt.Sprintf("file %q is larger than the 3 MiB request limit", filepath.Base(path)), "payload_too_large")
	}
	ext := strings.ToLower(filepath.Ext(path))
	ct := mimeByExt[ext]
	if ct == "" {
		ct = mime.TypeByExtension(ext)
	}
	return Attachment{Filename: filepath.Base(path), Content: b, ContentType: ct}, nil
}

// AttachmentFromReader reads r fully (bounded) into an attachment.
func AttachmentFromReader(filename, contentType string, r io.Reader) (Attachment, error) {
	b, err := io.ReadAll(io.LimitReader(r, maxRawAttachment+1))
	if err != nil {
		return Attachment{}, err
	}
	if len(b) > maxRawAttachment {
		return Attachment{}, newValidationCode("attachment is larger than the 3 MiB request limit", "payload_too_large")
	}
	return Attachment{Filename: filename, Content: b, ContentType: contentType}, nil
}

// DecodeContent returns the raw bytes of an attachment returned by Get.
func (a AttachmentContent) DecodeContent() ([]byte, error) {
	return decodeBase64(a.Content)
}

// stripSpace removes all Unicode whitespace.
func stripSpace(s string) string {
	if strings.IndexFunc(s, unicode.IsSpace) < 0 {
		return s
	}
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// validBase64 reports whether s is non-empty, padded, standard-alphabet base64. Linear time.
func validBase64(s string) bool {
	n := len(s)
	if n == 0 || n%4 != 0 {
		return false
	}
	pad := 0
	for pad < 2 && pad < n && s[n-1-pad] == '=' {
		pad++
	}
	body := s[:n-pad]
	for i := 0; i < len(body); i++ {
		c := body[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/') {
			return false
		}
	}
	return true
}

// normalizeBase64 strips whitespace and validates; ok is false when invalid.
func normalizeBase64(s string) (string, bool) {
	c := stripSpace(s)
	if !validBase64(c) {
		return "", false
	}
	return c, true
}

func base64Size(content string) int64 {
	pad := len(content) - len(strings.TrimRight(content, "="))
	n := int64(len(content))*3/4 - int64(pad)
	if n < 0 {
		return 0
	}
	return n
}

type nameable interface{ Name() string }

func buildAttachment(a Attachment, i int) (wireAttachment, error) {
	at := fmt.Sprintf("attachments[%d]", i)

	filename := a.Filename
	if filename == "" {
		if n, ok := a.Reader.(nameable); ok {
			filename = filepath.Base(n.Name())
		}
	}
	filename = strings.TrimSpace(strings.NewReplacer("\r", "", "\n", "", "\x00", "").Replace(filename))
	if filename == "" {
		return wireAttachment{}, newValidationErr(at + ".filename is required")
	}
	if !utf8.ValidString(filename) {
		return wireAttachment{}, newValidationErr(at + ".filename must be valid UTF-8")
	}
	if utf16Len(filename) > 255 {
		return wireAttachment{}, newValidationErr(at + ".filename exceeds 255 characters")
	}

	sources := 0
	if a.Content != nil {
		sources++
	}
	if a.Reader != nil {
		sources++
	}
	if a.Base64 != "" {
		sources++
	}
	if sources == 0 {
		return wireAttachment{}, newValidationErr(at + ".content is required (set Content, Reader or Base64)")
	}
	if sources > 1 {
		return wireAttachment{}, newValidationErr(at + " must set only one of Content, Reader or Base64")
	}

	var content string
	switch {
	case a.Base64 != "":
		c, ok := normalizeBase64(a.Base64)
		if !ok {
			return wireAttachment{}, newValidationErr(at + ".Base64 must be valid padded base64. To attach text or binary data, set Content to the raw bytes instead.")
		}
		if len(c) > maxBodyBytes {
			return wireAttachment{}, newValidationCode(at+" is larger than the 3 MiB request limit", "payload_too_large")
		}
		content = c
	case a.Content != nil:
		if len(a.Content) == 0 {
			return wireAttachment{}, newValidationErr(at + ".content is empty")
		}
		if len(a.Content) > maxRawAttachment {
			return wireAttachment{}, newValidationCode(at+" is larger than the 3 MiB request limit", "payload_too_large")
		}
		content = encodeBase64(a.Content)
	default:
		b, err := io.ReadAll(io.LimitReader(a.Reader, maxRawAttachment+1))
		if err != nil {
			v := newValidationErr(at + ".Reader could not be read: " + sanitizeText(err.Error()))
			v.Cause = err
			return wireAttachment{}, v
		}
		if len(b) == 0 {
			return wireAttachment{}, newValidationErr(at + ".content is empty")
		}
		if len(b) > maxRawAttachment {
			return wireAttachment{}, newValidationCode(at+" is larger than the 3 MiB request limit", "payload_too_large")
		}
		content = encodeBase64(b)
	}

	ct := strings.TrimSpace(a.ContentType)
	if ct != "" {
		if strings.ContainsAny(ct, "\r\n\x00") || !utf8.ValidString(ct) {
			return wireAttachment{}, newValidationErr(at + ".ContentType contains a line break, NUL or invalid UTF-8")
		}
		if len(ct) > 127 {
			return wireAttachment{}, newValidationErr(at + ".ContentType is longer than 127 characters")
		}
	}
	return wireAttachment{Filename: filename, Content: content, MimeType: ct}, nil
}
