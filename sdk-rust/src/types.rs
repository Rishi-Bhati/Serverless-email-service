//! Public data types returned by the API and used to query it.

use std::fmt;
use std::str::FromStr;
use std::time::{Duration, SystemTime};

use crate::cancel::CancellationToken;
use crate::error::Error;
use crate::time::{system_time_ms, utc_day_string};

/// After this many delivery attempts the service stops retrying a failed email.
pub const MAX_DELIVERY_ATTEMPTS: u32 = 3;

/// Delivery state of an email.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EmailStatus {
    /// Accepted and waiting for delivery.
    Queued,
    /// Being delivered right now.
    Sending,
    /// Delivered.
    Sent,
    /// Delivery failed (permanently once `attempts` reaches [`MAX_DELIVERY_ATTEMPTS`]).
    Failed,
}

impl EmailStatus {
    /// The API's name for this status.
    pub fn as_str(self) -> &'static str {
        match self {
            EmailStatus::Queued => "queued",
            EmailStatus::Sending => "sending",
            EmailStatus::Sent => "sent",
            EmailStatus::Failed => "failed",
        }
    }
}

impl fmt::Display for EmailStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for EmailStatus {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Error> {
        match s {
            "queued" => Ok(EmailStatus::Queued),
            "sending" => Ok(EmailStatus::Sending),
            "sent" => Ok(EmailStatus::Sent),
            "failed" => Ok(EmailStatus::Failed),
            _ => Err(Error::validation(
                "\"status\" must be one of queued, sending, sent, failed",
            )),
        }
    }
}

/// Sort order for [`ListEmails`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sort {
    /// Most recently updated first (the server default).
    UpdatedAtDesc,
    /// Least recently updated first.
    UpdatedAtAsc,
    /// Newest first.
    CreatedAtDesc,
    /// Oldest first.
    CreatedAtAsc,
    /// Most delivery attempts first.
    AttemptsDesc,
}

impl Sort {
    /// The API's name for this order.
    pub fn as_str(self) -> &'static str {
        match self {
            Sort::UpdatedAtDesc => "updated_at_desc",
            Sort::UpdatedAtAsc => "updated_at_asc",
            Sort::CreatedAtDesc => "created_at_desc",
            Sort::CreatedAtAsc => "created_at_asc",
            Sort::AttemptsDesc => "attempts_desc",
        }
    }
}

impl FromStr for Sort {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Error> {
        match s {
            "updated_at_desc" => Ok(Sort::UpdatedAtDesc),
            "updated_at_asc" => Ok(Sort::UpdatedAtAsc),
            "created_at_desc" => Ok(Sort::CreatedAtDesc),
            "created_at_asc" => Ok(Sort::CreatedAtAsc),
            "attempts_desc" => Ok(Sort::AttemptsDesc),
            _ => Err(Error::validation(
                "\"sort\" must be one of updated_at_desc, updated_at_asc, created_at_desc, created_at_asc, attempts_desc",
            )),
        }
    }
}

/// A calendar day (UTC) used to filter [`ListEmails`]. Build it from `"YYYY-MM-DD"` or a [`SystemTime`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Day(Result<String, String>);

impl Day {
    pub(crate) fn resolve(&self, field: &str) -> Result<String, Error> {
        self.0
            .clone()
            .map_err(|msg| Error::validation(format!("\"{field}\" {msg}")))
    }
}

impl From<&str> for Day {
    /// Uses the first ten characters, which must look like `YYYY-MM-DD`; anything else is reported as a
    /// validation error when the query runs.
    fn from(s: &str) -> Self {
        let b = s.as_bytes();
        let ok = b.len() >= 10
            && b[..10].iter().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 {
                    *c == b'-'
                } else {
                    c.is_ascii_digit()
                }
            });
        Day(if ok {
            Ok(s[..10].to_owned())
        } else {
            Err("must be a SystemTime or YYYY-MM-DD".to_owned())
        })
    }
}

impl From<String> for Day {
    fn from(s: String) -> Self {
        Day::from(s.as_str())
    }
}

impl From<SystemTime> for Day {
    fn from(t: SystemTime) -> Self {
        Day(utc_day_string(system_time_ms(t))
            .ok_or_else(|| "is outside the supported date range".to_owned()))
    }
}

/// Per-call transport options, accepted by every call.
#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    pub(crate) timeout: Option<Duration>,
    pub(crate) max_retries: Option<u32>,
    pub(crate) cancel: Option<CancellationToken>,
}

impl RequestOptions {
    /// No overrides.
    pub fn new() -> Self {
        Self::default()
    }

    /// Per-attempt timeout, overriding the client default. Must be greater than zero.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Maximum retries after the first attempt (0 to 10), overriding the client default. `0` disables retries.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = Some(max_retries);
        self
    }

    /// Abort the call (and its retries) when the token is cancelled.
    pub fn cancellation_token(mut self, token: CancellationToken) -> Self {
        self.cancel = Some(token);
        self
    }

    pub(crate) fn validate(&self) -> Result<(), Error> {
        if let Some(t) = self.timeout {
            if t.is_zero() {
                return Err(Error::validation("\"timeout\" must be greater than zero"));
            }
        }
        if let Some(r) = self.max_retries {
            if r > 10 {
                return Err(Error::validation(
                    "\"max_retries\" must be an integer from 0 to 10",
                ));
            }
        }
        Ok(())
    }
}

/// The accepted-email receipt returned by [`Emails::send`](crate::Emails::send).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendResult {
    /// Email id. Use it with [`Emails::get`](crate::Emails::get) / [`Emails::wait`](crate::Emails::wait).
    pub id: i64,
    /// `Queued` for a new email; the current status when this was an idempotent replay.
    pub status: EmailStatus,
    /// The key used for this send (yours, or the SDK-generated one). `None` if idempotency was disabled.
    pub idempotency_key: Option<String>,
    /// `true` when the key matched an email already queued; no new email was created.
    pub idempotent_replay: bool,
    /// Provider name the server targeted, or `Automatic Priority / Default`.
    pub target_provider: String,
    /// The server's message.
    pub message: String,
}

/// One failed provider attempt in an email's delivery history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailoverAttempt {
    /// Provider name.
    pub provider: String,
    /// Provider type, for example `smtp`.
    pub kind: String,
    /// The error that provider returned.
    pub error: String,
    /// When the attempt failed.
    pub timestamp: SystemTime,
}

/// Metadata (and, from [`Emails::get`](crate::Emails::get), content) of an attachment on a stored email.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentInfo {
    /// File name.
    pub filename: String,
    /// MIME type, if one was given.
    pub mime_type: Option<String>,
    /// Decoded size in bytes.
    pub size: u64,
    /// Base64 content. `Some` for [`Emails::get`](crate::Emails::get), `None` in list results.
    pub content: Option<String>,
}

impl AttachmentInfo {
    /// Decode [`content`](AttachmentInfo::content) to bytes. `None` when the content was not fetched.
    pub fn bytes(&self) -> Option<Result<Vec<u8>, Error>> {
        use base64::Engine as _;
        let content = self.content.as_deref()?;
        Some(
            base64::engine::general_purpose::STANDARD
                .decode(content)
                .map_err(|e| {
                    Error::validation_code(
                        "invalid_response",
                        format!("Attachment content is not valid base64: {e}"),
                    )
                }),
        )
    }
}

/// An email as stored by the service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email {
    /// Email id.
    pub id: i64,
    /// Delivery state.
    pub status: EmailStatus,
    /// Recipients.
    pub to: Vec<String>,
    /// Cc recipients, `None` when there were none.
    pub cc: Option<Vec<String>>,
    /// Bcc recipients, `None` when there were none.
    pub bcc: Option<Vec<String>>,
    /// Subject.
    pub subject: String,
    /// HTML body.
    pub html_body: String,
    /// Plain-text body; `None` when the email was sent without a plain-text alternative.
    pub text_body: Option<String>,
    /// Sender address.
    pub from_email: Option<String>,
    /// Sender display name.
    pub from_name: Option<String>,
    /// Provider id requested at send time, if any.
    pub provider_id: Option<String>,
    /// Name of the provider that actually delivered it.
    pub provider_used: Option<String>,
    /// Providers that failed before this one succeeded (or all of them, if it failed).
    pub failover_history: Vec<FailoverAttempt>,
    /// The idempotency key the email was sent with.
    pub idempotency_key: Option<String>,
    /// Delivery attempts so far.
    pub attempts: u32,
    /// Last delivery error, if any.
    pub error: Option<String>,
    /// When it was queued.
    pub created_at: SystemTime,
    /// When it last changed.
    pub updated_at: SystemTime,
    /// Attachments.
    pub attachments: Vec<AttachmentInfo>,
}

impl Email {
    /// Whether the service will not change this email any further: `sent`, or `failed` after all attempts.
    pub fn is_final(&self) -> bool {
        self.status == EmailStatus::Sent
            || (self.status == EmailStatus::Failed && self.attempts >= MAX_DELIVERY_ATTEMPTS)
    }
}

/// Query for [`Emails::list`](crate::Emails::list) and [`Emails::iterate`](crate::Emails::iterate).
#[derive(Debug, Clone, Default)]
pub struct ListEmails {
    pub(crate) limit: Option<u32>,
    pub(crate) offset: Option<u64>,
    pub(crate) status: Option<EmailStatus>,
    pub(crate) search: Option<String>,
    pub(crate) from: Option<Day>,
    pub(crate) to: Option<Day>,
    pub(crate) sort: Option<Sort>,
    pub(crate) options: RequestOptions,
}

impl ListEmails {
    /// A query with no filters (the server's defaults: 100 per page, most recently updated first).
    pub fn new() -> Self {
        Self::default()
    }

    /// Page size, 1 to 200.
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Rows to skip.
    pub fn offset(mut self, offset: u64) -> Self {
        self.offset = Some(offset);
        self
    }

    /// Only emails in this state.
    pub fn status(mut self, status: EmailStatus) -> Self {
        self.status = Some(status);
        self
    }

    /// Matches subject, recipients, sender, provider, body and error text.
    pub fn search(mut self, search: impl Into<String>) -> Self {
        self.search = Some(search.into());
        self
    }

    /// Created on or after this day (UTC): `"YYYY-MM-DD"` or a [`SystemTime`].
    pub fn from(mut self, day: impl Into<Day>) -> Self {
        self.from = Some(day.into());
        self
    }

    /// Created on or before this day (UTC): `"YYYY-MM-DD"` or a [`SystemTime`].
    pub fn to(mut self, day: impl Into<Day>) -> Self {
        self.to = Some(day.into());
        self
    }

    /// Sort order.
    pub fn sort(mut self, sort: Sort) -> Self {
        self.sort = Some(sort);
        self
    }

    /// Per-call timeout override.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.options = self.options.timeout(timeout);
        self
    }

    /// Per-call retry override.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.options = self.options.max_retries(max_retries);
        self
    }

    /// Abort the call when the token is cancelled.
    pub fn cancellation_token(mut self, token: CancellationToken) -> Self {
        self.options = self.options.cancellation_token(token);
        self
    }
}

/// One page of [`Emails::list`](crate::Emails::list).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailPage {
    /// The emails on this page.
    pub emails: Vec<Email>,
    /// Total number of matches.
    pub total: u64,
    /// Page size the server used.
    pub limit: u64,
    /// Offset of this page.
    pub offset: u64,
    /// Whether more matches exist after this page.
    pub has_more: bool,
}

/// Options for [`Emails::wait_with`](crate::Emails::wait_with).
#[derive(Debug, Clone)]
pub struct WaitOptions {
    pub(crate) timeout: Duration,
    pub(crate) interval: Duration,
    pub(crate) cancel: Option<CancellationToken>,
}

impl Default for WaitOptions {
    fn default() -> Self {
        WaitOptions {
            timeout: Duration::from_secs(60),
            interval: Duration::from_secs(1),
            cancel: None,
        }
    }
}

impl WaitOptions {
    /// Defaults: 60 s timeout, 1 s first poll interval.
    pub fn new() -> Self {
        Self::default()
    }

    /// Give up after this long with a [`Timeout`](crate::Error::Timeout) error.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// First poll interval (at least 100 ms); it grows by 1.5x up to 5 s.
    pub fn interval(mut self, interval: Duration) -> Self {
        self.interval = interval;
        self
    }

    /// Stop waiting early when the token is cancelled.
    pub fn cancellation_token(mut self, token: CancellationToken) -> Self {
        self.cancel = Some(token);
        self
    }
}

/// Queue counters from [`Unsent::status`](crate::Unsent::status).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct QueueStatus {
    /// Waiting for delivery.
    pub queued: u64,
    /// Being delivered.
    pub sending: u64,
    /// Delivered.
    pub sent: u64,
    /// Failed.
    pub failed: u64,
}

/// Liveness probe result from [`Unsent::health`](crate::Unsent::health).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Health {
    /// `ok` on a healthy deployment.
    pub status: String,
    /// Server runtime name.
    pub runtime: String,
    /// Database binding state.
    pub d1: String,
    /// Server time.
    pub timestamp: SystemTime,
}
