//! Building and validating outgoing messages.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::address::{normalize_recipients, validate_from, Address};
use crate::attachment::{Attachment, WireAttachment, MAX_ATTACHMENTS};
use crate::cancel::CancellationToken;
use crate::crypto::random_uuid;
use crate::error::Error;
use crate::types::RequestOptions;

/// Largest request body the server accepts (3 MiB).
pub(crate) const MAX_BODY_BYTES: usize = 3 * 1024 * 1024;
const MAX_SUBJECT_UTF16: usize = 1000;
const MAX_PROVIDER_ID_UTF16: usize = 255;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
enum Idempotency {
    #[default]
    Auto,
    Key(String),
    Disabled,
}

/// An email to send. Build it with [`SendEmail::builder`] and pass it to [`Emails::send`](crate::Emails::send).
///
/// ```
/// use unsent::SendEmail;
/// let email = SendEmail::builder()
///     .from("Acme <support@acme.com>")
///     .to("customer@example.com")
///     .subject("Your order has shipped")
///     .html("<p>It is on its way.</p>")
///     .text("It is on its way.")
///     .idempotency_key("order-8492:shipped");
/// # let _ = email;
/// ```
///
/// Nothing is validated until the email is sent; invalid input then fails with [`Error::Validation`] before
/// any network request is made.
#[derive(Debug, Clone, Default)]
pub struct SendEmail {
    to: Option<Vec<String>>,
    cc: Option<Vec<String>>,
    bcc: Option<Vec<String>>,
    subject: Option<String>,
    html: Option<String>,
    text: Option<String>,
    attachments: Vec<Attachment>,
    from: Option<Address>,
    provider_id: Option<String>,
    idempotency: Idempotency,
    options: RequestOptions,
}

#[derive(Serialize)]
struct WireFrom<'a> {
    email: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
}

#[derive(Serialize)]
struct WireBody<'a> {
    to: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    cc: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bcc: Option<&'a [String]>,
    subject: &'a str,
    html: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachments: Option<&'a [WireAttachment]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<WireFrom<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotency_key: Option<&'a str>,
}

/// A validated message, ready to sign and send.
pub(crate) struct Prepared {
    /// The exact JSON text that is signed and sent.
    pub body: String,
    pub idempotency_key: Option<String>,
    pub options: RequestOptions,
}

pub(crate) struct Defaults<'a> {
    pub from: Option<&'a Address>,
    pub provider_id: Option<&'a str>,
}

fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `^[\x21-\x7e]{1,255}$`
fn valid_idempotency_key(k: &str) -> bool {
    (1..=255).contains(&k.len()) && k.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

impl SendEmail {
    /// Start a new message.
    pub fn builder() -> Self {
        Self::default()
    }

    /// Add a recipient. Call repeatedly, or use [`to_all`](SendEmail::to_all). Up to 100 per field.
    pub fn to(mut self, address: impl Into<String>) -> Self {
        self.to.get_or_insert_with(Vec::new).push(address.into());
        self
    }

    /// Add several recipients.
    pub fn to_all<I, S>(mut self, addresses: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.to
            .get_or_insert_with(Vec::new)
            .extend(addresses.into_iter().map(Into::into));
        self
    }

    /// Add a cc recipient.
    pub fn cc(mut self, address: impl Into<String>) -> Self {
        self.cc.get_or_insert_with(Vec::new).push(address.into());
        self
    }

    /// Add several cc recipients.
    pub fn cc_all<I, S>(mut self, addresses: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.cc
            .get_or_insert_with(Vec::new)
            .extend(addresses.into_iter().map(Into::into));
        self
    }

    /// Add a bcc recipient.
    pub fn bcc(mut self, address: impl Into<String>) -> Self {
        self.bcc.get_or_insert_with(Vec::new).push(address.into());
        self
    }

    /// Add several bcc recipients.
    pub fn bcc_all<I, S>(mut self, addresses: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.bcc
            .get_or_insert_with(Vec::new)
            .extend(addresses.into_iter().map(Into::into));
        self
    }

    /// Subject: required, up to 1000 characters.
    pub fn subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    /// HTML body. Provide `html`, `text`, or both.
    pub fn html(mut self, html: impl Into<String>) -> Self {
        self.html = Some(html.into());
        self
    }

    /// Plain-text body. If no HTML body is given, one is derived from the text (the API requires HTML).
    pub fn text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    /// Sender: `"Name <a@b.com>"`, `"a@b.com"`, an [`Address`] or `(email, name)`. Must match a provider
    /// configured in your dashboard. Omit it to use the client's `default_from`, or the default provider.
    pub fn from(mut self, from: impl Into<Address>) -> Self {
        self.from = Some(from.into());
        self
    }

    /// Add an attachment (up to 20).
    pub fn attachment(mut self, attachment: Attachment) -> Self {
        self.attachments.push(attachment);
        self
    }

    /// Add several attachments.
    pub fn attachments(mut self, attachments: impl IntoIterator<Item = Attachment>) -> Self {
        self.attachments.extend(attachments);
        self
    }

    /// Force a specific provider by its id (see the dashboard).
    pub fn provider_id(mut self, provider_id: impl Into<String>) -> Self {
        self.provider_id = Some(provider_id.into());
        self
    }

    /// Use your own idempotency key (1 to 255 printable ASCII characters without spaces, for example
    /// `order-123:receipt`) to deduplicate across calls and processes. Without it the SDK generates a UUID per
    /// call and reuses it across that call's retries.
    pub fn idempotency_key(mut self, key: impl Into<String>) -> Self {
        self.idempotency = Idempotency::Key(key.into());
        self
    }

    /// Send without an idempotency key. The SDK then never retries this send, because a retry could deliver the
    /// email twice.
    pub fn no_idempotency(mut self) -> Self {
        self.idempotency = Idempotency::Disabled;
        self
    }

    /// Per-attempt timeout for this call. Must be greater than zero.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.options = self.options.timeout(timeout);
        self
    }

    /// Maximum retries for this call (0 to 10); overrides the client default.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.options = self.options.max_retries(max_retries);
        self
    }

    /// Abort this call (including any retries and backoff sleeps) when the token is cancelled.
    pub fn cancellation_token(mut self, token: CancellationToken) -> Self {
        self.options = self.options.cancellation_token(token);
        self
    }

    /// Build a message from a JSON value, as you might receive from a queue or another service.
    ///
    /// Recognised fields: `to`, `cc`, `bcc` (string or array of strings), `subject`, `html`, `text`,
    /// `from` (string or `{email, name}`), `provider_id`, `idempotency_key` (string, or `false` to disable) and
    /// `attachments` (array of `{filename, content, content_type}` where `content` is a base64 string).
    /// Anything of the wrong type is a [`Error::Validation`], never a panic.
    pub fn from_json(value: &Value) -> Result<Self, Error> {
        let obj = value
            .as_object()
            .ok_or_else(|| Error::validation("send() needs an options object"))?;
        let mut email = SendEmail::builder();

        let strings = |field: &str| -> Result<Option<Vec<String>>, Error> {
            match obj.get(field) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) => Ok(Some(vec![s.clone()])),
                Some(Value::Array(items)) => items
                    .iter()
                    .map(|v| {
                        v.as_str().map(str::to_owned).ok_or_else(|| {
                            Error::validation(format!(
                                "\"{field}\" must be a string or an array of strings"
                            ))
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map(Some),
                Some(_) => Err(Error::validation(format!(
                    "\"{field}\" must be a string or an array of strings"
                ))),
            }
        };
        email.to = strings("to")?;
        email.cc = strings("cc")?;
        email.bcc = strings("bcc")?;

        let string = |field: &str, alt: Option<&str>| -> Result<Option<String>, Error> {
            let v = obj.get(field).or_else(|| alt.and_then(|a| obj.get(a)));
            match v {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) => Ok(Some(s.clone())),
                Some(_) => Err(Error::validation(format!("\"{field}\" must be a string"))),
            }
        };
        email.subject = string("subject", None)?;
        email.html = string("html", None)?;
        email.text = string("text", None)?;
        email.provider_id = string("provider_id", Some("providerId"))?;

        email.from = match obj.get("from") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(Address::parse(s)),
            Some(Value::Object(o)) => {
                let e = o.get("email").and_then(Value::as_str).ok_or_else(|| {
                    Error::validation("\"from.email\" must be a non-empty string")
                })?;
                match o.get("name") {
                    None | Some(Value::Null) => Some(Address::new(e)),
                    Some(Value::String(n)) => Some(Address::with_name(e, n.as_str())),
                    Some(_) => return Err(Error::validation("\"from.name\" must be a string")),
                }
            }
            Some(_) => {
                return Err(Error::validation(
                    "\"from\" must be a non-empty string or { email, name }",
                ))
            }
        };

        match obj
            .get("idempotency_key")
            .or_else(|| obj.get("idempotencyKey"))
        {
            None | Some(Value::Null) => {}
            Some(Value::Bool(false)) => email.idempotency = Idempotency::Disabled,
            Some(Value::String(s)) => email.idempotency = Idempotency::Key(s.clone()),
            Some(_) => {
                return Err(Error::validation_code(
                    "invalid_idempotency_key",
                    "\"idempotency_key\" must be a string (or false to disable)",
                ))
            }
        }

        match obj.get("attachments") {
            None | Some(Value::Null) => {}
            Some(Value::Array(items)) => {
                for (i, item) in items.iter().enumerate() {
                    let o = item.as_object().ok_or_else(|| {
                        Error::validation(format!("attachments[{i}] must be an object"))
                    })?;
                    let filename = match o.get("filename") {
                        None | Some(Value::Null) => None,
                        Some(Value::String(s)) => Some(s.clone()),
                        Some(_) => {
                            return Err(Error::validation(format!(
                                "attachments[{i}].filename must be a string"
                            )))
                        }
                    };
                    let content = o.get("content").and_then(Value::as_str).ok_or_else(|| {
                        Error::validation(format!(
                            "attachments[{i}].content must be a base64 string"
                        ))
                    })?;
                    let content_type = match o
                        .get("content_type")
                        .or_else(|| o.get("contentType"))
                        .or_else(|| o.get("mimeType"))
                    {
                        None | Some(Value::Null) => None,
                        Some(Value::String(s)) => Some(s.clone()),
                        Some(_) => {
                            return Err(Error::validation(format!(
                                "attachments[{i}].content_type must be a string"
                            )))
                        }
                    };
                    email.attachments.push(Attachment::from_parts(
                        filename,
                        content.to_owned(),
                        content_type,
                    ));
                }
            }
            Some(_) => return Err(Error::validation("\"attachments\" must be an array")),
        }
        Ok(email)
    }

    /// Validate everything and produce the exact request body. No network I/O happens here.
    pub(crate) fn prepare(&self, defaults: &Defaults<'_>) -> Result<Prepared, Error> {
        let to = normalize_recipients(self.to.as_deref(), "to", true)?.unwrap_or_default();
        let cc = normalize_recipients(self.cc.as_deref(), "cc", false)?;
        let bcc = normalize_recipients(self.bcc.as_deref(), "bcc", false)?;

        let subject = match &self.subject {
            Some(s) if !s.trim().is_empty() => s,
            _ => return Err(Error::validation("\"subject\" is required")),
        };
        if utf16_len(subject) > MAX_SUBJECT_UTF16 {
            return Err(Error::validation(format!(
                "\"subject\" is {} characters (maximum {MAX_SUBJECT_UTF16})",
                utf16_len(subject)
            )));
        }

        let has_html = self.html.as_deref().is_some_and(|h| !h.trim().is_empty());
        let has_text = self.text.as_deref().is_some_and(|t| !t.trim().is_empty());
        if !has_html && !has_text {
            return Err(Error::validation("Provide \"html\", \"text\", or both"));
        }
        // The API requires an HTML body; derive one from the text so text-only sends just work.
        let html = if has_html {
            self.html.clone().unwrap_or_default()
        } else {
            format!(
                "<div style=\"white-space:pre-wrap\">{}</div>",
                escape_html(self.text.as_deref().unwrap_or(""))
            )
        };

        let mut attachments: Option<Vec<WireAttachment>> = None;
        if !self.attachments.is_empty() {
            if self.attachments.len() > MAX_ATTACHMENTS {
                return Err(Error::validation(format!(
                    "Too many attachments ({}, maximum {MAX_ATTACHMENTS})",
                    self.attachments.len()
                )));
            }
            // Refuse oversized messages before allocating the base64 text.
            let estimated = self.attachments.iter().fold(0usize, |acc, a| {
                acc.saturating_add(a.estimated_encoded_len())
            });
            if estimated > MAX_BODY_BYTES {
                return Err(too_large());
            }
            attachments = Some(
                self.attachments
                    .iter()
                    .enumerate()
                    .map(|(i, a)| a.to_wire(i))
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }

        let from = self.from.as_ref().or(defaults.from);
        if let Some(from) = from {
            validate_from(from)?;
        }

        let provider_id = self.provider_id.as_deref().or(defaults.provider_id);
        if let Some(p) = provider_id {
            if p.trim().is_empty() || utf16_len(p) > MAX_PROVIDER_ID_UTF16 {
                return Err(Error::validation(
                    "\"provider_id\" must be a non-empty string up to 255 characters",
                ));
            }
        }

        let idempotency_key = match &self.idempotency {
            Idempotency::Disabled => None,
            Idempotency::Auto => Some(random_uuid()),
            Idempotency::Key(k) => {
                let k = k.trim();
                if !valid_idempotency_key(k) {
                    return Err(Error::validation_code(
                        "invalid_idempotency_key",
                        "\"idempotency_key\" must be 1-255 printable ASCII characters without spaces (e.g. a UUID or \"order-123:receipt\")",
                    ));
                }
                Some(k.to_owned())
            }
        };

        self.options.validate()?;

        let trimmed_provider = provider_id.map(str::trim);
        let wire = WireBody {
            to: &to,
            cc: cc.as_deref(),
            bcc: bcc.as_deref(),
            subject,
            html: &html,
            text: if has_text { self.text.as_deref() } else { None },
            attachments: attachments.as_deref(),
            from: from.map(|f| WireFrom {
                email: f.email.trim(),
                name: f.name.as_deref().map(str::trim).filter(|n| !n.is_empty()),
            }),
            provider_id: trimmed_provider,
            idempotency_key: idempotency_key.as_deref(),
        };
        let body = serde_json::to_string(&wire)
            .map_err(|e| Error::validation(format!("Could not encode the message: {e}")))?;
        if body.len() > MAX_BODY_BYTES {
            return Err(too_large());
        }
        Ok(Prepared {
            body,
            idempotency_key,
            options: self.options.clone(),
        })
    }
}

fn too_large() -> Error {
    Error::validation_code(
        "payload_too_large",
        format!(
            "The message is larger than the server limit of {} MiB (the service stores body and attachments in one row, so keep attachments under about 1.4 MB of raw data)",
            MAX_BODY_BYTES / (1024 * 1024)
        ),
    )
}
