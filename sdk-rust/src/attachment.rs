//! File attachments.

use std::fmt;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;

use crate::error::Error;

/// Maximum attachments per email.
pub(crate) const MAX_ATTACHMENTS: usize = 20;
pub(crate) const MAX_FILENAME_UTF16: usize = 255;

#[derive(Clone)]
enum Content {
    Bytes(Vec<u8>),
    Base64(String),
}

/// A file to attach to an email.
///
/// Raw bytes are base64-encoded for you ([`Attachment::from_bytes`]); data that is already base64 goes through
/// [`Attachment::from_base64`], which is validated. Plain text is *not* base64: use `from_bytes` for it.
///
/// ```
/// use unsent::Attachment;
/// let a = Attachment::from_bytes("report.csv", "id,total\n1,9\n").content_type("text/csv");
/// let b = Attachment::from_base64("hello.txt", "aGVsbG8=");
/// # let _ = (a, b);
/// ```
#[derive(Clone)]
pub struct Attachment {
    filename: Option<String>,
    content: Content,
    content_type: Option<String>,
}

impl fmt::Debug for Attachment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (kind, len) = match &self.content {
            Content::Bytes(b) => ("bytes", b.len()),
            Content::Base64(s) => ("base64", s.len()),
        };
        f.debug_struct("Attachment")
            .field("filename", &self.filename)
            .field("content", &format_args!("<{len} {kind}>"))
            .field("content_type", &self.content_type)
            .finish()
    }
}

impl Attachment {
    /// Attach raw bytes; the SDK base64-encodes them.
    pub fn from_bytes(filename: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        Attachment {
            filename: Some(filename.into()),
            content: Content::Bytes(bytes.into()),
            content_type: None,
        }
    }

    /// Attach content that is already base64-encoded (whitespace is ignored; it must be valid, padded base64).
    pub fn from_base64(filename: impl Into<String>, base64: impl Into<String>) -> Self {
        Attachment {
            filename: Some(filename.into()),
            content: Content::Base64(base64.into()),
            content_type: None,
        }
    }

    /// Read a file from disk. The filename is the path's last component and the content type is guessed from
    /// its extension (override either with [`Attachment::filename`] / [`Attachment::content_type`]).
    ///
    /// This reads the file synchronously; inside async code with large files wrap it in
    /// `tokio::task::spawn_blocking`.
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, Error> {
        let path = path.as_ref();
        let bytes = std::fs::read(path).map_err(|e| {
            Error::validation_code(
                "attachment_read_error",
                format!("Could not read attachment file {}: {e}", path.display()),
            )
            .with_source(Box::new(e))
        })?;
        let filename = path.file_name().map(|n| n.to_string_lossy().into_owned());
        let content_type = path
            .extension()
            .and_then(|e| e.to_str())
            .and_then(mime_for_extension)
            .map(str::to_owned);
        Ok(Attachment {
            filename,
            content: Content::Bytes(bytes),
            content_type,
        })
    }

    /// Set (or replace) the filename shown to the recipient.
    pub fn filename(mut self, filename: impl Into<String>) -> Self {
        self.filename = Some(filename.into());
        self
    }

    /// Set the MIME type, for example `application/pdf`.
    pub fn content_type(mut self, content_type: impl Into<String>) -> Self {
        self.content_type = Some(content_type.into());
        self
    }

    /// Rough size of the encoded content, used to refuse oversized messages before allocating.
    pub(crate) fn estimated_encoded_len(&self) -> usize {
        match &self.content {
            Content::Bytes(b) => b.len().div_ceil(3).saturating_mul(4),
            Content::Base64(s) => s.len(),
        }
    }

    /// Build from already-validated parts (used by JSON input).
    pub(crate) fn from_parts(
        filename: Option<String>,
        base64: String,
        content_type: Option<String>,
    ) -> Self {
        Attachment {
            filename,
            content: Content::Base64(base64),
            content_type,
        }
    }

    /// Validate and convert to the wire format.
    pub(crate) fn to_wire(&self, index: usize) -> Result<WireAttachment, Error> {
        let at = format!("attachments[{index}]");
        let filename: String = self
            .filename
            .as_deref()
            .unwrap_or("")
            .chars()
            .filter(|c| !matches!(c, '\r' | '\n' | '\0'))
            .collect();
        let filename = filename.trim().to_owned();
        if filename.is_empty() {
            return Err(Error::validation(format!("{at}.filename is required")));
        }
        if filename.encode_utf16().count() > MAX_FILENAME_UTF16 {
            return Err(Error::validation(format!(
                "{at}.filename exceeds {MAX_FILENAME_UTF16} characters"
            )));
        }
        let content = match &self.content {
            Content::Bytes(bytes) => STANDARD.encode(bytes),
            Content::Base64(raw) => {
                let stripped: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
                if stripped.is_empty()
                    || !stripped.len().is_multiple_of(4)
                    || !is_padded_base64(stripped.as_bytes())
                {
                    return Err(Error::validation(format!(
                        "{at}.content is a string, so it must be valid base64. To attach text or binary data, pass bytes (for example Attachment::from_bytes)."
                    )));
                }
                stripped
            }
        };
        if content.is_empty() {
            return Err(Error::validation(format!("{at}.content is empty")));
        }
        let mime_type = self.content_type.clone().filter(|m| !m.is_empty());
        Ok(WireAttachment {
            filename,
            content,
            mime_type,
        })
    }
}

/// Attachment as the API expects it.
#[derive(Debug, Serialize)]
pub(crate) struct WireAttachment {
    pub filename: String,
    pub content: String,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// `^[A-Za-z0-9+/]*={0,2}$`, in linear time.
fn is_padded_base64(b: &[u8]) -> bool {
    let body_len = b.iter().rposition(|&c| c != b'=').map_or(0, |i| i + 1);
    let padding = b.len() - body_len;
    padding <= 2
        && b[..body_len]
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
}

fn mime_for_extension(ext: &str) -> Option<&'static str> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" => "text/html",
        "xml" => "application/xml",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ics" => "text/calendar",
        _ => return None,
    })
}

/// Decoded size of a base64 string, as the API reports it.
pub(crate) fn base64_size(content: &str) -> u64 {
    let len = content.len() as u64;
    let padding = (content.len() - content.trim_end_matches('=').len()) as u64;
    (len * 3 / 4).saturating_sub(padding)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_shape() {
        assert!(is_padded_base64(b"aGVsbG8="));
        assert!(is_padded_base64(b"QQ=="));
        assert!(is_padded_base64(b"AAAA"));
        assert!(!is_padded_base64(b"A==="));
        assert!(!is_padded_base64(b"AA=A"));
        assert!(!is_padded_base64(b"AA A"));
        assert!(!is_padded_base64("é===".as_bytes()));
    }

    #[test]
    fn sizes() {
        assert_eq!(base64_size("aGVsbG8="), 5);
        assert_eq!(base64_size("QQ=="), 1);
        assert_eq!(base64_size(""), 0);
        assert_eq!(base64_size("===="), 0);
    }

    #[test]
    fn debug_hides_content() {
        let a = Attachment::from_bytes("a.bin", vec![1, 2, 3]);
        assert_eq!(
            format!("{a:?}"),
            "Attachment { filename: Some(\"a.bin\"), content: <3 bytes>, content_type: None }"
        );
    }
}
