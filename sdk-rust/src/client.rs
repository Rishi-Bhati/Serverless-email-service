//! The client and its resource methods.

use std::collections::VecDeque;
use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::time::Instant;

use crate::address::Address;
use crate::cancel::race_cancel;
use crate::config::UnsentBuilder;
use crate::error::Error;
use crate::http::{Call, HttpClient};
use crate::mapping::{as_u64, get, js_string, map_email, number, object};
use crate::send::{Defaults, SendEmail};
use crate::time::{ms_to_system_time, now_ms};
use crate::transport::Method;
use crate::types::{
    Email, EmailPage, EmailStatus, Health, ListEmails, QueueStatus, RequestOptions, SendResult,
    WaitOptions,
};

struct Inner {
    http: HttpClient,
    default_from: Option<Address>,
    default_provider_id: Option<String>,
}

/// The Unsent client. Cheap to clone (clones share one connection pool and clock correction), `Send + Sync`.
///
/// ```no_run
/// use unsent::{SendEmail, Unsent};
///
/// # async fn run() -> Result<(), unsent::Error> {
/// let client = Unsent::from_env()?; // UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET
/// let receipt = client
///     .emails()
///     .send(SendEmail::builder().to("user@example.com").subject("Hi").html("<p>Hello</p>"))
///     .await?;
/// println!("queued as #{}", receipt.id);
/// # Ok(())
/// # }
/// ```
#[derive(Clone)]
pub struct Unsent {
    inner: Arc<Inner>,
}

impl fmt::Debug for Unsent {
    /// Never prints credentials.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Unsent")
            .field("base_url", &self.inner.http.base_url())
            .field("api_key", &"***")
            .field(
                "api_secret",
                &if self.inner.http.has_api_secret() {
                    "***"
                } else {
                    "(none)"
                },
            )
            .field("timeout", &self.inner.http.default_timeout())
            .field("max_retries", &self.inner.http.default_max_retries())
            .finish_non_exhaustive()
    }
}

impl Unsent {
    /// Start configuring a client.
    pub fn builder() -> UnsentBuilder {
        UnsentBuilder::default()
    }

    /// Build a client from `UNSENT_BASE_URL`, `UNSENT_API_KEY` and (optionally) `UNSENT_API_SECRET`.
    pub fn from_env() -> Result<Unsent, Error> {
        UnsentBuilder::default().build()
    }

    /// Build a client from explicit variables instead of the process environment, for example from a
    /// configuration library or secret store. Recognised names: `UNSENT_BASE_URL`, `UNSENT_API_KEY`,
    /// `UNSENT_API_SECRET`. Empty values count as unset.
    pub fn from_vars<I, K, V>(vars: I) -> Result<Unsent, Error>
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        let map: Vec<(String, String)> = vars
            .into_iter()
            .map(|(k, v)| (k.as_ref().to_owned(), v.as_ref().to_owned()))
            .collect();
        UnsentBuilder::default()
            .build_with(|name| map.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()))
    }

    pub(crate) fn from_parts(
        http: HttpClient,
        default_from: Option<Address>,
        default_provider_id: Option<String>,
    ) -> Self {
        Unsent {
            inner: Arc::new(Inner {
                http,
                default_from,
                default_provider_id,
            }),
        }
    }

    /// Send and inspect emails.
    pub fn emails(&self) -> Emails {
        Emails {
            client: self.clone(),
        }
    }

    /// Shortcut for `emails().send(..)`.
    pub async fn send(&self, email: SendEmail) -> Result<SendResult, Error> {
        self.emails().send(email).await
    }

    /// Queue counters. Also a cheap way to verify your credentials are accepted.
    pub async fn status(&self) -> Result<QueueStatus, Error> {
        self.status_with(&RequestOptions::default()).await
    }

    /// [`status`](Unsent::status) with per-call options.
    pub async fn status_with(&self, options: &RequestOptions) -> Result<QueueStatus, Error> {
        options.validate()?;
        let reply = self
            .inner
            .http
            .call(&get_call("/api/status", Vec::new(), true, options))
            .await?;
        let d = &reply.data;
        Ok(QueueStatus {
            queued: as_u64(get(d, "queued")),
            sending: as_u64(get(d, "sending")),
            sent: as_u64(get(d, "sent")),
            failed: as_u64(get(d, "failed")),
        })
    }

    /// Public liveness probe. Needs no credentials, so it does not verify them; use
    /// [`status`](Unsent::status) for that.
    pub async fn health(&self) -> Result<Health, Error> {
        self.health_with(&RequestOptions::default()).await
    }

    /// [`health`](Unsent::health) with per-call options.
    pub async fn health_with(&self, options: &RequestOptions) -> Result<Health, Error> {
        options.validate()?;
        let reply = self
            .inner
            .http
            .call(&get_call("/api/health", Vec::new(), false, options))
            .await?;
        let d = &reply.data;
        object(d, "health")?;
        let ts = number(get(d, "timestamp"));
        let timestamp = if ts == 0.0 {
            now_ms()
        } else {
            ts.clamp(-8.64e15, 8.64e15) as i64
        };
        Ok(Health {
            status: js_string(get(d, "status")),
            runtime: js_string(get(d, "runtime")),
            d1: js_string(get(d, "d1")),
            timestamp: ms_to_system_time(timestamp),
        })
    }

    /// The correction (milliseconds) currently applied to request timestamps; `0` unless a clock skew was
    /// detected.
    #[doc(hidden)]
    pub fn clock_offset_ms(&self) -> i64 {
        self.inner.http.clock_offset_ms()
    }
}

fn get_call<'a>(
    path: &str,
    query: Vec<(&'static str, String)>,
    auth: bool,
    options: &'a RequestOptions,
) -> Call<'a> {
    Call {
        method: Method::Get,
        path: path.to_owned(),
        query,
        body: None,
        sign: false,
        auth,
        retry_safe: true,
        timeout: options.timeout,
        max_retries: options.max_retries,
        cancel: options.cancel.as_ref(),
    }
}

/// `client.emails()`: send and inspect emails.
#[derive(Clone)]
pub struct Emails {
    client: Unsent,
}

impl fmt::Debug for Emails {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Emails")
            .field("client", &self.client)
            .finish()
    }
}

impl Emails {
    fn http(&self) -> &HttpClient {
        &self.client.inner.http
    }

    /// Queue an email for delivery.
    ///
    /// Resolves as soon as the service has accepted the email (HTTP 202); delivery happens in the background.
    /// Use [`wait`](Emails::wait) to block until it is actually sent.
    ///
    /// Retries on network errors, timeouts, 408, 425, 429 and 5xx are automatic and cannot cause duplicates:
    /// every send carries an idempotency key (yours, or a generated UUID). All validation happens before the
    /// first request; invalid input returns [`Error::Validation`] and sends nothing.
    pub fn send(
        &self,
        email: SendEmail,
    ) -> impl Future<Output = Result<SendResult, Error>> + Send + 'static {
        let this = self.clone();
        async move { this.send_inner(email).await }
    }

    async fn send_inner(&self, email: SendEmail) -> Result<SendResult, Error> {
        let inner = &self.client.inner;
        let prepared = email.prepare(&Defaults {
            from: inner.default_from.as_ref(),
            provider_id: inner.default_provider_id.as_deref(),
        })?;
        let reply = inner
            .http
            .call(&Call {
                method: Method::Post,
                path: "/api/send".to_owned(),
                query: Vec::new(),
                body: Some(&prepared.body),
                sign: true,
                auth: true,
                // Without a key a retry could duplicate the email, so only keyed sends are retried.
                retry_safe: prepared.idempotency_key.is_some(),
                timeout: prepared.options.timeout,
                max_retries: prepared.options.max_retries,
                cancel: prepared.options.cancel.as_ref(),
            })
            .await?;
        let d = &reply.data;
        let id = d.get("id").and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64))
        });
        let Some(id) = id.filter(|id| *id > 0) else {
            return Err(Error::protocol(
                "invalid_response",
                format!("The server accepted the request (HTTP {}) but returned no email id. Is base_url pointing at your Unsent deployment?", reply.status),
            ));
        };
        Ok(SendResult {
            id,
            status: d
                .get("status")
                .and_then(Value::as_str)
                .and_then(|s| s.parse().ok())
                .unwrap_or(EmailStatus::Queued),
            idempotency_key: match d.get("idempotency_key") {
                Some(Value::String(k)) => Some(k.clone()),
                _ => prepared.idempotency_key,
            },
            idempotent_replay: d.get("idempotent_replay").and_then(Value::as_bool) == Some(true)
                || reply.replayed_header,
            target_provider: js_string(get(d, "targetProvider")),
            message: js_string(get(d, "message")),
        })
    }

    /// Fetch one email, including attachment contents. Fails with [`Error::NotFound`] if it does not exist.
    pub fn get(&self, id: i64) -> impl Future<Output = Result<Email, Error>> + Send + 'static {
        let this = self.clone();
        async move { this.get_inner(id).await }
    }

    async fn get_inner(&self, id: i64) -> Result<Email, Error> {
        self.get_with(id, &RequestOptions::default()).await
    }

    /// [`get`](Emails::get) with per-call options.
    pub fn get_with(
        &self,
        id: i64,
        options: &RequestOptions,
    ) -> impl Future<Output = Result<Email, Error>> + Send + 'static {
        let this = self.clone();
        let options = options.clone();
        async move { this.get_with_inner(id, &options).await }
    }

    async fn get_with_inner(&self, id: i64, options: &RequestOptions) -> Result<Email, Error> {
        if id < 1 {
            return Err(Error::validation("\"id\" must be a positive integer"));
        }
        options.validate()?;
        let reply = self
            .http()
            .call(&get_call(
                &format!("/api/emails/{id}"),
                Vec::new(),
                true,
                options,
            ))
            .await?;
        match reply.data.get("email") {
            Some(row) => map_email(row, true),
            None => Err(Error::protocol("invalid_response", "The server's reply has no \"email\" field. Is base_url pointing at your Unsent deployment?")),
        }
    }

    /// List emails (most recently updated first unless you sort). Attachment contents are not included.
    pub fn list(
        &self,
        query: ListEmails,
    ) -> impl Future<Output = Result<EmailPage, Error>> + Send + 'static {
        let this = self.clone();
        async move { this.list_inner(query).await }
    }

    async fn list_inner(&self, query: ListEmails) -> Result<EmailPage, Error> {
        if let Some(limit) = query.limit {
            if !(1..=200).contains(&limit) {
                return Err(Error::validation(
                    "\"limit\" must be an integer from 1 to 200",
                ));
            }
        }
        let from = query.from.as_ref().map(|d| d.resolve("from")).transpose()?;
        let to = query.to.as_ref().map(|d| d.resolve("to")).transpose()?;
        query.options.validate()?;

        let mut params: Vec<(&'static str, String)> = Vec::new();
        if let Some(v) = query.limit {
            params.push(("limit", v.to_string()));
        }
        if let Some(v) = query.offset {
            params.push(("offset", v.to_string()));
        }
        if let Some(v) = query.status {
            params.push(("status", v.as_str().to_owned()));
        }
        if let Some(v) = &query.search {
            params.push(("q", v.clone()));
        }
        if let Some(v) = from {
            params.push(("from", v));
        }
        if let Some(v) = to {
            params.push(("to", v));
        }
        if let Some(v) = query.sort {
            params.push(("sort", v.as_str().to_owned()));
        }

        let reply = self
            .http()
            .call(&get_call("/api/emails", params, true, &query.options))
            .await?;
        let d = &reply.data;
        object(d, "list")?;
        let rows = match d.get("emails") {
            None | Some(Value::Null) => &[][..],
            Some(Value::Array(a)) => a.as_slice(),
            Some(_) => return Err(Error::protocol("invalid_response", "The server's list reply has a malformed \"emails\" field. Is base_url pointing at your Unsent deployment?")),
        };
        let emails = rows
            .iter()
            .map(|r| map_email(r, false))
            .collect::<Result<Vec<_>, _>>()?;
        let total = as_u64(get(d, "total"));
        let offset = as_u64(get(d, "offset"));
        let limit = match as_u64(get(d, "limit")) {
            0 => emails.len() as u64,
            n => n,
        };
        let has_more = offset.saturating_add(emails.len() as u64) < total;
        Ok(EmailPage {
            emails,
            total,
            limit,
            offset,
            has_more,
        })
    }

    /// Iterate over every matching email, fetching pages as needed. Defaults to oldest-first so that emails sent
    /// while iterating do not shift pages.
    ///
    /// ```no_run
    /// # async fn run(client: unsent::Unsent) -> Result<(), unsent::Error> {
    /// use unsent::{EmailStatus, ListEmails};
    /// let mut failed = client.emails().iterate(ListEmails::new().status(EmailStatus::Failed));
    /// while let Some(email) = failed.next().await {
    ///     println!("{}", email?.subject);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub fn iterate(&self, query: ListEmails) -> EmailIter {
        EmailIter {
            emails: self.clone(),
            offset: query.offset.unwrap_or(0),
            query,
            buffer: VecDeque::new(),
            done: false,
        }
    }

    /// Poll until the email is delivered (`Sent`) or has permanently failed (`Failed` after all attempts), then
    /// return it. Check [`Email::status`]; a permanent failure is a normal return value. Fails with
    /// [`Error::Timeout`] if it is still in flight after 60 seconds. Use [`wait_with`](Emails::wait_with) to
    /// change that.
    pub fn wait(&self, id: i64) -> impl Future<Output = Result<Email, Error>> + Send + 'static {
        let this = self.clone();
        async move { this.wait_inner(id).await }
    }

    async fn wait_inner(&self, id: i64) -> Result<Email, Error> {
        self.wait_with(id, WaitOptions::default()).await
    }

    /// [`wait`](Emails::wait) with a custom timeout, poll interval or cancellation token.
    pub fn wait_with(
        &self,
        id: i64,
        options: WaitOptions,
    ) -> impl Future<Output = Result<Email, Error>> + Send + 'static {
        let this = self.clone();
        async move { this.wait_with_inner(id, options).await }
    }

    async fn wait_with_inner(&self, id: i64, options: WaitOptions) -> Result<Email, Error> {
        let deadline = Instant::now() + options.timeout;
        let mut interval = options.interval.max(Duration::from_millis(100));
        let per_call = RequestOptions {
            cancel: options.cancel.clone(),
            ..RequestOptions::default()
        };
        loop {
            let email = self.get_with(id, &per_call).await?;
            if email.is_final() {
                return Ok(email);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::timeout(format!(
                    "Email {id} was still \"{}\" after {} ms",
                    email.status,
                    options.timeout.as_millis()
                )));
            }
            if race_cancel(
                tokio::time::sleep(interval.min(remaining)),
                options.cancel.as_ref(),
            )
            .await
            .is_err()
            {
                return Err(Error::aborted("The wait was aborted"));
            }
            interval = interval.mul_f64(1.5).min(Duration::from_secs(5));
        }
    }
}

/// Walks every email matching a [`ListEmails`] query. Created by [`Emails::iterate`].
#[derive(Debug)]
pub struct EmailIter {
    emails: Emails,
    query: ListEmails,
    offset: u64,
    buffer: VecDeque<Email>,
    done: bool,
}

impl EmailIter {
    /// The next email, or `None` when there are no more. After an error the iterator is finished.
    pub async fn next(&mut self) -> Option<Result<Email, Error>> {
        loop {
            if let Some(email) = self.buffer.pop_front() {
                return Some(Ok(email));
            }
            if self.done {
                return None;
            }
            match self.next_page().await {
                Ok(Some(page)) => self.buffer.extend(page),
                Ok(None) => return None,
                Err(e) => return Some(Err(e)),
            }
        }
    }

    /// The next page of emails (never empty), or `None` when the results are exhausted. After an error the
    /// iterator is finished.
    pub async fn next_page(&mut self) -> Result<Option<Vec<Email>>, Error> {
        if self.done {
            return Ok(None);
        }
        let mut q = self.query.clone();
        q.offset = Some(self.offset);
        q.sort = q.sort.or(Some(crate::types::Sort::CreatedAtAsc));
        let page = match self.emails.list(q).await {
            Ok(p) => p,
            Err(e) => {
                self.done = true;
                return Err(e);
            }
        };
        if !page.has_more || page.emails.is_empty() {
            self.done = true;
        }
        if page.emails.is_empty() {
            return Ok(None);
        }
        self.offset += page.emails.len() as u64;
        Ok(Some(page.emails))
    }
}
