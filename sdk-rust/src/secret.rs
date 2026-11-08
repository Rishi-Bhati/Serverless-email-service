//! A string wrapper that never reveals its contents through `Debug` or `Display`.

use std::fmt;

/// A credential (API key or API secret).
///
/// `Debug` and `Display` print `***`; the value is only reachable through [`Secret::expose`].
/// The SDK stores both credentials in this type so they cannot leak through logging or `{:?}` output.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    /// Wrap a value.
    pub fn new(value: impl Into<String>) -> Self {
        Secret(value.into())
    }

    /// The wrapped value. Handle with care: do not log it.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Length of the wrapped value in bytes.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the wrapped value is empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl From<String> for Secret {
    fn from(value: String) -> Self {
        Secret(value)
    }
}

impl From<&str> for Secret {
    fn from(value: &str) -> Self {
        Secret(value.to_owned())
    }
}
