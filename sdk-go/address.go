package unsent

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	maxRecipients      = 100
	maxRecipientLength = 320
)

var namedAddrRE = regexp.MustCompile(`^\s*"?([^"<>]*?)"?\s*<\s*([^<>\s]+)\s*>\s*$`)

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func hasCRLFNUL(s string) bool { return strings.ContainsAny(s, "\r\n\x00") }

// ParseAddress parses "a@b.co" or `Name <a@b.co>` (quotes around the name are stripped).
func ParseAddress(s string) (Address, error) {
	a, err := parseAddress(s, "address")
	if err != nil {
		return Address{}, err
	}
	return a, nil
}

func parseAddress(value, field string) (Address, error) {
	if strings.TrimSpace(value) == "" {
		return Address{}, newValidationErr(fmt.Sprintf(`"%s" must be a non-empty string or Address`, field))
	}
	if len(value) > 4096 {
		// Bound regexp work and message size; no real address is this long.
		return Address{}, newValidationErr(fmt.Sprintf(`"%s" is too long`, field))
	}
	if m := namedAddrRE.FindStringSubmatch(value); m != nil {
		// The capture can still hold whitespace that `\s` (RE2: [\t\n\f\r ]) does not cover, such as a
		// vertical tab, so trim it here; an address that is only whitespace falls through to the bare path.
		if email := strings.TrimSpace(m[2]); email != "" {
			return Address{Email: email, Name: strings.TrimSpace(m[1])}, nil
		}
	}
	return Address{Email: strings.TrimSpace(value)}, nil
}

type wireAddr struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

// resolveFrom validates an Address and converts it to wire form. The zero Address yields nil.
func resolveFrom(a Address, field string) (*wireAddr, error) {
	if a == (Address{}) {
		return nil, nil
	}
	var out Address
	if strings.TrimSpace(a.Name) == "" {
		if strings.TrimSpace(a.Email) == "" {
			return nil, newValidationErr(fmt.Sprintf(`"%s.email" must be a non-empty string`, field))
		}
		p, err := parseAddress(a.Email, field)
		if err != nil {
			return nil, err
		}
		out = p
	} else {
		if strings.TrimSpace(a.Email) == "" {
			return nil, newValidationErr(fmt.Sprintf(`"%s.email" must be a non-empty string`, field))
		}
		out = Address{Email: strings.TrimSpace(a.Email), Name: strings.TrimSpace(a.Name)}
	}
	if hasCRLFNUL(out.Email) || hasCRLFNUL(out.Name) {
		return nil, newValidationErr(fmt.Sprintf(`"%s" contains a line break or NUL character`, field))
	}
	if !utf8.ValidString(out.Email) || !utf8.ValidString(out.Name) {
		return nil, newValidationErr(fmt.Sprintf(`"%s" must be valid UTF-8`, field))
	}
	return &wireAddr{Email: out.Email, Name: out.Name}, nil
}

// normalizeRecipients validates a recipient list. nil means "not provided".
func normalizeRecipients(list []string, field string, required bool) ([]string, error) {
	if list == nil {
		if required {
			return nil, newValidationErr(fmt.Sprintf(`"%s" is required`, field))
		}
		return nil, nil
	}
	if len(list) > 10*maxRecipients {
		return nil, newValidationErr(fmt.Sprintf(`"%s" has %d addresses (maximum %d)`, field, len(list), maxRecipients))
	}
	cleaned := make([]string, 0, len(list))
	for _, v := range list {
		if t := strings.TrimSpace(v); t != "" {
			cleaned = append(cleaned, t)
		}
	}
	if len(cleaned) == 0 {
		if required {
			return nil, newValidationErr(fmt.Sprintf(`"%s" must contain at least one address`, field))
		}
		return nil, nil
	}
	if len(cleaned) > maxRecipients {
		return nil, newValidationErr(fmt.Sprintf(`"%s" has %d addresses (maximum %d)`, field, len(cleaned), maxRecipients))
	}
	for _, addr := range cleaned {
		if hasCRLFNUL(addr) {
			return nil, newValidationErr(fmt.Sprintf(`"%s" contains a line break or NUL character`, field))
		}
		if !utf8.ValidString(addr) {
			return nil, newValidationErr(fmt.Sprintf(`"%s" contains an address that is not valid UTF-8`, field))
		}
		if utf16Len(addr) > maxRecipientLength {
			return nil, newValidationErr(fmt.Sprintf(`"%s" contains an address longer than %d characters`, field, maxRecipientLength))
		}
		if !strings.Contains(addr, "@") {
			return nil, newValidationErr(fmt.Sprintf(`"%s" contains an invalid address: %s`, field, quoteShort(addr)))
		}
	}
	return cleaned, nil
}

func quoteShort(s string) string {
	s = truncateRunes(s, 80)
	return fmt.Sprintf("%q", s)
}
