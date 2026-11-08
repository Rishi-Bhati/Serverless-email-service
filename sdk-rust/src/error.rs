//! The single error type returned by every fallible call.

use std::error::Error as StdError;
use std::fmt;
use std::time::Duration;

use serde_json::Value;

pub(crate) type BoxError = Box<dyn StdError + Send + Sync + 'static>;

/// Everything known about a failure. Reached through [`Error::info`] or the accessors on [`Error`].
#[derive(Debug)]
pub struct ErrorInfo {
    code: String,
    message: String,
    reason: Option<String>,
    hint: Option<String>,
    status: Option<u16>,
    body: Option<Value>,
    existing_email_id: Option<i64>,
    retry_after: Option<Duration>,
    pub(crate) server_time_ms: Option<i64>,
    source: Option<BoxError>,
}

impl ErrorInfo {
    pub(crate) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        ErrorInfo {
            code: code.into(),
            message: message.into(),
            reason: None,
            hint: None,
            status: None,
            body: None,
            existing_email_id: None,
            retry_after: None,
            server_time_ms: None,
            source: None,
        }
    }

    /// Stable machine-readable code, for example `invalid_api_key`, `validation_error` or `timeout`.
    pub fn code(&self) -> &str {
        &self.code
    }

    /// Human-readable message (may change between versions; branch on [`code`](ErrorInfo::code) instead).
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ErrorInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl StdError for ErrorInfo {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source
            .as_ref()
            .map(|e| e.as_ref() as &(dyn StdError + 'static))
    }
}

/// Every way an SDK call can fail.
///
/// Branch on [`Error::code`] (stable) rather than on the message. API errors (those that carry an HTTP
/// [`status`](Error::status)) also expose [`reason`](Error::reason), [`body`](Error::body),
/// [`existing_email_id`](Error::existing_email_id) and [`retry_after`](Error::retry_after).
///
/// Credentials never appear in an error's message, fields or `Debug` output.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The client was built with invalid options. Nothing was sent.
    #[error(transparent)]
    Config(Box<ErrorInfo>),
    /// A call argument failed client-side validation. Nothing was sent.
    #[error(transparent)]
    Validation(Box<ErrorInfo>),
    /// The request never produced an HTTP response (DNS, TLS, reset, offline...) or the response was cut off.
    #[error(transparent)]
    Connection(Box<ErrorInfo>),
    /// A request exceeded its timeout, or [`Emails::wait`](crate::Emails::wait) exceeded its deadline.
    #[error(transparent)]
    Timeout(Box<ErrorInfo>),
    /// The call was cancelled through its [`CancellationToken`](crate::CancellationToken).
    #[error(transparent)]
    Aborted(Box<ErrorInfo>),
    /// HTTP 401: wrong key or secret, clock skew, replayed nonce...
    #[error(transparent)]
    Authentication(Box<ErrorInfo>),
    /// HTTP 403: the endpoint needs an admin dashboard session, which API keys cannot provide.
    #[error(transparent)]
    PermissionDenied(Box<ErrorInfo>),
    /// HTTP 404: unknown email or route.
    #[error(transparent)]
    NotFound(Box<ErrorInfo>),
    /// HTTP 409: the idempotency key was already used for a different email.
    #[error(transparent)]
    Conflict(Box<ErrorInfo>),
    /// HTTP 429.
    #[error(transparent)]
    RateLimited(Box<ErrorInfo>),
    /// HTTP 5xx.
    #[error(transparent)]
    Server(Box<ErrorInfo>),
    /// HTTP 400 or 413: the server rejected the request contents.
    #[error(transparent)]
    Request(Box<ErrorInfo>),
    /// Any other non-success HTTP status.
    #[error(transparent)]
    Api(Box<ErrorInfo>),
    /// The server's reply was not what an Unsent deployment sends: a redirect (`unexpected_redirect`), a
    /// non-JSON or malformed success body (`invalid_response`) or an oversized body (`response_too_large`).
    #[error(transparent)]
    Protocol(Box<ErrorInfo>),
}

impl Error {
    /// The details of this error.
    pub fn info(&self) -> &ErrorInfo {
        match self {
            Error::Config(i)
            | Error::Validation(i)
            | Error::Connection(i)
            | Error::Timeout(i)
            | Error::Aborted(i)
            | Error::Authentication(i)
            | Error::PermissionDenied(i)
            | Error::NotFound(i)
            | Error::Conflict(i)
            | Error::RateLimited(i)
            | Error::Server(i)
            | Error::Request(i)
            | Error::Api(i)
            | Error::Protocol(i) => i,
        }
    }

    fn info_mut(&mut self) -> &mut ErrorInfo {
        match self {
            Error::Config(i)
            | Error::Validation(i)
            | Error::Connection(i)
            | Error::Timeout(i)
            | Error::Aborted(i)
            | Error::Authentication(i)
            | Error::PermissionDenied(i)
            | Error::NotFound(i)
            | Error::Conflict(i)
            | Error::RateLimited(i)
            | Error::Server(i)
            | Error::Request(i)
            | Error::Api(i)
            | Error::Protocol(i) => i,
        }
    }

    /// Stable machine-readable code, for example `invalid_api_key`, `validation_error`, `timeout`, `aborted`.
    pub fn code(&self) -> &str {
        &self.info().code
    }

    /// The error message (including the hint, when there is one).
    pub fn message(&self) -> &str {
        &self.info().message
    }

    /// HTTP status, for errors that came from a server response.
    pub fn status(&self) -> Option<u16> {
        self.info().status
    }

    /// Extra detail from the server (the API's `reason` field).
    pub fn reason(&self) -> Option<&str> {
        self.info().reason.as_deref()
    }

    /// A short suggestion for fixing the problem, when the SDK knows one.
    pub fn hint(&self) -> Option<&str> {
        self.info().hint.as_deref()
    }

    /// The parsed JSON error body, or the raw text (as a JSON string) when the body was not JSON.
    pub fn body(&self) -> Option<&Value> {
        self.info().body.as_ref()
    }

    /// The id of the existing email on an idempotency conflict (HTTP 409).
    pub fn existing_email_id(&self) -> Option<i64> {
        self.info().existing_email_id
    }

    /// The delay the server asked for with `Retry-After`, capped at 60 seconds.
    pub fn retry_after(&self) -> Option<Duration> {
        self.info().retry_after
    }

    /// Whether repeating the call might succeed: network errors, timeouts, HTTP 408, 425, 429 and 5xx
    /// (except 501, 505 and `server_misconfigured`). The SDK already retries these automatically where that is
    /// safe; this is for your own retry logic after the SDK has given up.
    pub fn is_retryable(&self) -> bool {
        match self {
            Error::Connection(_) | Error::Timeout(_) => true,
            Error::Aborted(_) | Error::Config(_) | Error::Validation(_) | Error::Protocol(_) => {
                false
            }
            _ => is_retryable_status(self.info().status, self.code()),
        }
    }

    /// Whether this is a timeout.
    pub fn is_timeout(&self) -> bool {
        matches!(self, Error::Timeout(_))
    }

    /// Whether the call was cancelled.
    pub fn is_aborted(&self) -> bool {
        matches!(self, Error::Aborted(_))
    }

    // ---- constructors -------------------------------------------------------------------------------------

    pub(crate) fn config(message: impl Into<String>) -> Error {
        Error::Config(Box::new(ErrorInfo::new("invalid_config", message)))
    }

    pub(crate) fn config_code(code: &str, message: impl Into<String>) -> Error {
        Error::Config(Box::new(ErrorInfo::new(code, message)))
    }

    pub(crate) fn validation(message: impl Into<String>) -> Error {
        Error::Validation(Box::new(ErrorInfo::new("validation_error", message)))
    }

    pub(crate) fn validation_code(code: &str, message: impl Into<String>) -> Error {
        Error::Validation(Box::new(ErrorInfo::new(code, message)))
    }

    pub(crate) fn connection(message: impl Into<String>, source: Option<BoxError>) -> Error {
        let mut info = ErrorInfo::new("connection_error", message);
        info.source = source;
        Error::Connection(Box::new(info))
    }

    pub(crate) fn timeout(message: impl Into<String>) -> Error {
        Error::Timeout(Box::new(ErrorInfo::new("timeout", message)))
    }

    pub(crate) fn aborted(message: impl Into<String>) -> Error {
        Error::Aborted(Box::new(ErrorInfo::new("aborted", message)))
    }

    pub(crate) fn protocol(code: &str, message: impl Into<String>) -> Error {
        Error::Protocol(Box::new(ErrorInfo::new(code, message)))
    }

    pub(crate) fn with_source(mut self, source: BoxError) -> Error {
        self.info_mut().source = Some(source);
        self
    }

    /// Build the right variant from an HTTP error response. `redact` scrubs credentials from server-provided text.
    pub(crate) fn from_response(status: u16, body: Value, ctx: &ResponseContext<'_>) -> Error {
        let obj = body.as_object();
        let code = match obj.and_then(|o| o.get("code")).and_then(Value::as_str) {
            Some(c) if !c.is_empty() => c.to_owned(),
            _ if status >= 500 => "internal_error".to_owned(),
            _ => format!("http_{status}"),
        };
        let base_message = match (
            obj.and_then(|o| o.get("error")).and_then(Value::as_str),
            &body,
        ) {
            (Some(e), _) if !e.is_empty() => e.to_owned(),
            (_, Value::String(s)) if !s.trim().is_empty() => s.trim().chars().take(200).collect(),
            _ => ctx
                .status_text
                .map(str::to_owned)
                .unwrap_or_else(|| format!("HTTP {status}")),
        };
        let base_message = (ctx.redact)(&base_message);
        let reason = obj
            .and_then(|o| o.get("reason"))
            .and_then(Value::as_str)
            .map(|r| (ctx.redact)(r));

        let mut hint = hint_for(&code).map(str::to_owned);
        if code == "timestamp_skew" {
            hint = Some(
                if ctx.has_api_secret {
                    "Your system clock differs from the server by more than 3 minutes. Sync it (NTP)."
                } else {
                    "The server requires signed requests. Pass api_secret (UNSENT_API_SECRET) to the client."
                }
                .to_owned(),
            );
        } else if code == "invalid_nonce" && !ctx.has_api_secret {
            hint = Some("The server requires signed requests. Pass api_secret (UNSENT_API_SECRET) to the client.".to_owned());
        }

        let mut message = match &reason {
            Some(r) if !base_message.contains(r.as_str()) => format!("{base_message}: {r}"),
            _ => base_message,
        };
        if let Some(h) = &hint {
            message.push_str(&format!(" ({h})"));
        }

        let existing_email_id = obj.and_then(|o| o.get("id")).and_then(|v| {
            v.as_i64().or_else(|| {
                let f = v.as_f64()?;
                (f.fract() == 0.0 && f.abs() < 9.0e15).then_some(f as i64)
            })
        });

        let mut info = ErrorInfo::new(code, message);
        info.reason = reason;
        info.hint = hint;
        info.status = Some(status);
        info.body = Some(redact_value(body, ctx.redact));
        info.existing_email_id = existing_email_id;
        info.retry_after = ctx.retry_after;
        info.server_time_ms = ctx.server_time_ms;
        let info = Box::new(info);
        match status {
            401 => Error::Authentication(info),
            403 => Error::PermissionDenied(info),
            404 => Error::NotFound(info),
            409 => Error::Conflict(info),
            429 => Error::RateLimited(info),
            500.. => Error::Server(info),
            400 | 413 => Error::Request(info),
            _ => Error::Api(info),
        }
    }
}

pub(crate) struct ResponseContext<'a> {
    pub has_api_secret: bool,
    pub retry_after: Option<Duration>,
    pub server_time_ms: Option<i64>,
    pub status_text: Option<&'a str>,
    pub redact: &'a dyn Fn(&str) -> String,
}

pub(crate) fn is_retryable_status(status: Option<u16>, code: &str) -> bool {
    if code == "server_misconfigured" {
        return false;
    }
    match status {
        Some(s) => s == 408 || s == 425 || s == 429 || (s >= 500 && s != 501 && s != 505),
        None => false,
    }
}

fn hint_for(code: &str) -> Option<&'static str> {
    Some(match code {
        "invalid_api_key" | "unauthorized" => "Check that api_key matches the API_KEY secret of your Unsent deployment.",
        "invalid_signature" => "Check that api_secret matches the API_SECRET secret of your Unsent deployment (no extra whitespace).",
        "missing_signature" => "The server requires signed requests. Pass api_secret (UNSENT_API_SECRET) to the client.",
        "nonce_reused" => "A nonce was replayed. This should not happen with the SDK; check for proxies that duplicate requests.",
        "server_misconfigured" => {
            "The Unsent server is missing configuration (API_KEY, API_SECRET, SECURITY_MODE or IDEMPOTENCY_TTL_HOURS). See the server logs."
        }
        "unauthorized_sender" => {
            "The \"from\" address or provider_id is not an active provider. Configure it in the dashboard, or omit \"from\" to use the default provider."
        }
        "forbidden" => "This endpoint needs an admin dashboard session; API keys cannot call it.",
        _ => return None,
    })
}

fn redact_value(value: Value, redact: &dyn Fn(&str) -> String) -> Value {
    match value {
        Value::String(s) => Value::String(redact(&s)),
        Value::Array(a) => Value::Array(a.into_iter().map(|v| redact_value(v, redact)).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| (redact(&k), redact_value(v, redact)))
                .collect(),
        ),
        other => other,
    }
}
