//! Sender and recipient parsing and validation.

use crate::error::Error;

/// Maximum addresses per recipient field.
pub(crate) const MAX_RECIPIENTS: usize = 100;

/// A sender address: an email plus an optional display name.
///
/// Converting from a string parses `"Name <a@b.com>"` (quotes around the name are stripped); a bare address
/// has no name.
///
/// ```
/// use unsent::Address;
/// let a: Address = "Acme Support <help@acme.co>".into();
/// assert_eq!(a.email, "help@acme.co");
/// assert_eq!(a.name.as_deref(), Some("Acme Support"));
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Address {
    /// The email address.
    pub email: String,
    /// Optional display name.
    pub name: Option<String>,
}

impl Address {
    /// An address without a display name (the string is used as is, apart from trimming).
    pub fn new(email: impl Into<String>) -> Self {
        Address {
            email: email.into().trim().to_owned(),
            name: None,
        }
    }

    /// An address with a display name.
    pub fn with_name(email: impl Into<String>, name: impl Into<String>) -> Self {
        let name = name.into().trim().to_owned();
        Address {
            email: email.into().trim().to_owned(),
            name: (!name.is_empty()).then_some(name),
        }
    }

    /// Parse `"Name <a@b.com>"` or a bare address.
    pub fn parse(value: &str) -> Self {
        match parse_named(value) {
            Some((name, email)) => Address {
                email,
                name: (!name.is_empty()).then_some(name),
            },
            None => Address {
                email: value.trim().to_owned(),
                name: None,
            },
        }
    }
}

impl From<&str> for Address {
    fn from(value: &str) -> Self {
        Address::parse(value)
    }
}

impl From<String> for Address {
    fn from(value: String) -> Self {
        Address::parse(&value)
    }
}

impl From<&String> for Address {
    fn from(value: &String) -> Self {
        Address::parse(value)
    }
}

impl From<(&str, &str)> for Address {
    /// `(email, name)`.
    fn from((email, name): (&str, &str)) -> Self {
        Address::with_name(email, name)
    }
}

/// Linear-time equivalent of `^\s*"?([^"<>]*?)"?\s*<\s*([^<>\s]+)\s*>\s*$`.
fn parse_named(value: &str) -> Option<(String, String)> {
    let s = value.trim();
    let inner_end = s
        .len()
        .checked_sub(1)
        .filter(|&i| s.as_bytes()[i] == b'>')?;
    let lt = s.find('<')?;
    // exactly one '<' and one '>' (the last character)
    if s[lt + 1..].contains('<') || s[..inner_end].contains('>') {
        return None;
    }
    let email = s[lt + 1..inner_end].trim();
    if email.is_empty() || email.chars().any(char::is_whitespace) {
        return None;
    }
    let mut name = s[..lt].trim_start();
    if let Some(rest) = name.strip_prefix('"') {
        name = rest;
    }
    let mut name = name.trim_end();
    if let Some(rest) = name.strip_suffix('"') {
        name = rest;
    }
    if name.contains('"') {
        return None;
    }
    Some((name.trim().to_owned(), email.to_owned()))
}

pub(crate) fn has_line_break(s: &str) -> bool {
    s.bytes().any(|b| matches!(b, b'\r' | b'\n' | 0))
}

/// A short, quoted preview of untrusted text for error messages.
pub(crate) fn preview(s: &str) -> String {
    let mut out: String = s.chars().take(60).collect();
    if s.chars().nth(60).is_some() {
        out.push('…');
    }
    serde_json::to_string(&out).unwrap_or_default()
}

/// Validate a recipient list. Entries are trimmed, blank ones dropped.
pub(crate) fn normalize_recipients(
    values: Option<&[String]>,
    field: &str,
    required: bool,
) -> Result<Option<Vec<String>>, Error> {
    let Some(values) = values else {
        if required {
            return Err(Error::validation(format!("\"{field}\" is required")));
        }
        return Ok(None);
    };
    let cleaned: Vec<String> = values
        .iter()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .collect();
    if cleaned.is_empty() {
        if required {
            return Err(Error::validation(format!(
                "\"{field}\" must contain at least one address"
            )));
        }
        return Ok(None);
    }
    if cleaned.len() > MAX_RECIPIENTS {
        return Err(Error::validation(format!(
            "\"{field}\" has {} addresses (maximum {MAX_RECIPIENTS})",
            cleaned.len()
        )));
    }
    for addr in &cleaned {
        if has_line_break(addr) {
            return Err(Error::validation(format!(
                "\"{field}\" contains a line break or NUL character"
            )));
        }
        if !addr.contains('@') {
            return Err(Error::validation(format!(
                "\"{field}\" contains an invalid address: {}",
                preview(addr)
            )));
        }
    }
    Ok(Some(cleaned))
}

/// Validate the sender: non-blank email, no CR/LF/NUL.
pub(crate) fn validate_from(from: &Address) -> Result<(), Error> {
    if from.email.trim().is_empty() {
        return Err(Error::validation(
            "\"from.email\" must be a non-empty string",
        ));
    }
    if has_line_break(&from.email) || from.name.as_deref().is_some_and(has_line_break) {
        return Err(Error::validation(
            "\"from\" contains a line break or NUL character",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_named_addresses() {
        let cases = [
            (
                "Acme Support <help@acme.co>",
                "help@acme.co",
                Some("Acme Support"),
            ),
            ("\"Doe, Jane\" <j@acme.co>", "j@acme.co", Some("Doe, Jane")),
            ("  \"Quoted\"   < a@b.co >  ", "a@b.co", Some("Quoted")),
            ("<a@b.co>", "a@b.co", None),
            ("a@b.co", "a@b.co", None),
            ("  a@b.co  ", "a@b.co", None),
            ("Bob \"x\" <a@b.co>", "Bob \"x\" <a@b.co>", None),
            ("Name <a b@c.co>", "Name <a b@c.co>", None),
            ("A <b@c.co> <d@e.co>", "A <b@c.co> <d@e.co>", None),
            ("Zoë <z@x.co>", "z@x.co", Some("Zoë")),
        ];
        for (input, email, name) in cases {
            let a = Address::parse(input);
            assert_eq!(
                (a.email.as_str(), a.name.as_deref()),
                (email, name),
                "{input:?}"
            );
        }
    }

    #[test]
    fn pathological_inputs_are_fast() {
        let start = std::time::Instant::now();
        for s in [
            "<".repeat(100_000),
            format!("{}>", " ".repeat(100_000)),
            format!("\"{}<a@b>", "\"".repeat(100_000)),
            format!("{}<{}>", "a ".repeat(50_000), "b".repeat(50_000)),
            "<>".repeat(50_000),
        ] {
            let _ = Address::parse(&s);
        }
        assert!(start.elapsed() < std::time::Duration::from_millis(500));
    }

    #[test]
    fn recipients() {
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(
            normalize_recipients(Some(&v(&[" a@b.co ", ""])), "to", true)
                .unwrap()
                .unwrap(),
            v(&["a@b.co"])
        );
        assert!(normalize_recipients(None, "cc", false).unwrap().is_none());
        assert!(normalize_recipients(Some(&[]), "cc", false)
            .unwrap()
            .is_none());
        assert!(normalize_recipients(Some(&v(&["x"])), "to", true).is_err());
        assert!(normalize_recipients(Some(&v(&["a@b\r\nBcc: x@y"])), "to", true).is_err());
    }
}
