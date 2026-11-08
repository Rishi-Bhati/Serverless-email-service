//! The request pipeline: signing, timeouts, retries, clock-skew correction and error mapping.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use url::Url;

use crate::cancel::{race_cancel, CancellationToken};
use crate::crypto::{random_nonce, random_unit, sign_request};
use crate::error::{is_retryable_status, Error, ResponseContext};
use crate::secret::Secret;
use crate::time::parse_http_date;
use crate::transport::{
    Method, Transport, TransportError, TransportErrorKind, TransportRequest, TransportResponse,
    MAX_RESPONSE_BYTES,
};

const MAX_BACKOFF_MS: u64 = 8_000;
const BASE_BACKOFF_MS: u64 = 500;
const MAX_RETRY_AFTER_MS: f64 = 60_000.0;
/// Skews smaller than this are not worth correcting (the server tolerates 180 s).
const MIN_CLOCK_CORRECTION_MS: i64 = 30_000;
/// Credentials shorter than this are not scrubbed from server text (too likely to match ordinary words).
const MIN_REDACTED_LEN: usize = 8;

pub(crate) type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub(crate) struct HttpConfig {
    pub base_url: String,
    pub api_key: Secret,
    pub api_secret: Option<Secret>,
    pub timeout: Duration,
    pub max_retries: u32,
    pub transport: Arc<dyn Transport>,
    pub clock: Clock,
}

/// One logical API call.
pub(crate) struct Call<'a> {
    pub method: Method,
    pub path: String,
    pub query: Vec<(&'static str, String)>,
    pub body: Option<&'a str>,
    /// Sign with HMAC (POST /api/send). GET endpoints authenticate with the API key alone.
    pub sign: bool,
    /// Send the API key. `false` for the public health probe.
    pub auth: bool,
    /// May be re-sent after an ambiguous failure without risk of duplication.
    pub retry_safe: bool,
    pub timeout: Option<Duration>,
    pub max_retries: Option<u32>,
    pub cancel: Option<&'a CancellationToken>,
}

pub(crate) struct Reply {
    pub status: u16,
    pub data: Value,
    pub replayed_header: bool,
}

pub(crate) struct HttpClient {
    cfg: HttpConfig,
    host: String,
    /// Server clock minus local clock, learned from a `timestamp_skew` response.
    clock_offset_ms: AtomicI64,
    user_agent: String,
}

fn parse_retry_after(header: Option<&str>, now: i64) -> Option<Duration> {
    let header = header?.trim();
    if header.is_empty() {
        return None;
    }
    if let Ok(secs) = header.parse::<f64>() {
        if secs.is_finite() && secs >= 0.0 {
            return Some(Duration::from_millis(
                (secs * 1000.0).min(MAX_RETRY_AFTER_MS) as u64,
            ));
        }
        return None;
    }
    let date = parse_http_date(header)?;
    Some(Duration::from_millis(
        ((date - now).max(0) as f64).min(MAX_RETRY_AFTER_MS) as u64,
    ))
}

impl HttpClient {
    pub(crate) fn new(cfg: HttpConfig) -> Self {
        let host = Url::parse(&cfg.base_url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_default();
        HttpClient {
            cfg,
            host,
            clock_offset_ms: AtomicI64::new(0),
            user_agent: format!("unsent-sdk-rust/{}", crate::VERSION),
        }
    }

    pub(crate) fn has_api_secret(&self) -> bool {
        self.cfg.api_secret.is_some()
    }

    pub(crate) fn base_url(&self) -> &str {
        &self.cfg.base_url
    }

    pub(crate) fn default_timeout(&self) -> Duration {
        self.cfg.timeout
    }

    pub(crate) fn default_max_retries(&self) -> u32 {
        self.cfg.max_retries
    }

    pub(crate) fn clock_offset_ms(&self) -> i64 {
        self.clock_offset_ms.load(Ordering::Relaxed)
    }

    /// Replace credentials in server-provided text.
    fn redact(&self, text: &str) -> String {
        let mut out = text.to_owned();
        for secret in [Some(&self.cfg.api_key), self.cfg.api_secret.as_ref()]
            .into_iter()
            .flatten()
        {
            if secret.len() >= MIN_REDACTED_LEN && out.contains(secret.expose()) {
                out = out.replace(secret.expose(), "***");
            }
        }
        out
    }

    fn now(&self) -> i64 {
        (self.cfg.clock)()
    }

    pub(crate) async fn call(&self, call: &Call<'_>) -> Result<Reply, Error> {
        let max_retries = call.max_retries.unwrap_or(self.cfg.max_retries);
        let timeout = call.timeout.unwrap_or(self.cfg.timeout);
        let cancel = call.cancel;
        let aborted = || Error::aborted("The request was aborted");

        let mut attempt: u32 = 0;
        let mut clock_corrected = false;
        loop {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(aborted());
            }
            let err = match self.attempt(call, timeout).await {
                Ok(reply) => return Ok(reply),
                Err(err) => err,
            };
            if err.is_aborted() || cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(aborted());
            }

            // A skewed local clock fails signature checks before the nonce is consumed, so one corrected
            // retry is free and always safe.
            if !clock_corrected && err.code() == "timestamp_skew" && self.has_api_secret() {
                clock_corrected = true;
                if self.sync_clock(&err, cancel).await {
                    continue;
                }
                if cancel.is_some_and(CancellationToken::is_cancelled) {
                    return Err(aborted());
                }
            }

            let delay = if attempt < max_retries && call.retry_safe {
                match &err {
                    Error::Connection(_) | Error::Timeout(_) => Some(self.backoff(attempt)),
                    _ if is_retryable_status(err.status(), err.code()) => Some(
                        self.backoff(attempt)
                            .max(err.retry_after().unwrap_or_default()),
                    ),
                    _ => None,
                }
            } else {
                None
            };
            let Some(delay) = delay else {
                return Err(err);
            };
            attempt += 1;
            if race_cancel(tokio::time::sleep(delay), cancel)
                .await
                .is_err()
            {
                return Err(aborted());
            }
        }
    }

    fn backoff(&self, attempt: u32) -> Duration {
        let exp =
            MAX_BACKOFF_MS.min(BASE_BACKOFF_MS.saturating_mul(1u64 << attempt.min(16))) as f64;
        Duration::from_millis((exp / 2.0 + random_unit() * (exp / 2.0)).round() as u64)
    }

    /// Learn how far the local clock is from the server's, from the error's `Date` header or, failing that,
    /// the timestamp in the public health probe. Returns true when a retry is worthwhile.
    async fn sync_clock(&self, err: &Error, cancel: Option<&CancellationToken>) -> bool {
        let (server_time, local_time) = match err.info().server_time_ms {
            Some(t) => (t, self.now()),
            None => {
                let probe = Call {
                    method: Method::Get,
                    path: "/api/health".to_owned(),
                    query: vec![],
                    body: None,
                    sign: false,
                    auth: false,
                    retry_safe: true,
                    timeout: None,
                    max_retries: None,
                    cancel,
                };
                let before = self.now();
                let reply = match self
                    .attempt(&probe, self.cfg.timeout.min(Duration::from_secs(5)))
                    .await
                {
                    Ok(r) => r,
                    Err(_) => return false,
                };
                let after = self.now();
                let Some(ts) = reply
                    .data
                    .get("timestamp")
                    .and_then(Value::as_f64)
                    .filter(|t| t.is_finite())
                else {
                    return false;
                };
                (ts as i64, (before + after) / 2)
            }
        };
        let offset = server_time.saturating_sub(local_time);
        if offset.abs() < MIN_CLOCK_CORRECTION_MS {
            // The local clock is fine now. If we were compensating for an earlier skew (for example the host
            // clock was since fixed), drop the stale offset and retry; otherwise skew is not the problem.
            if self.clock_offset_ms.load(Ordering::Relaxed) == 0 {
                return false;
            }
            self.clock_offset_ms.store(0, Ordering::Relaxed);
            return true;
        }
        self.clock_offset_ms.store(offset, Ordering::Relaxed);
        true
    }

    async fn attempt(&self, call: &Call<'_>, timeout: Duration) -> Result<Reply, Error> {
        let mut url = Url::parse(&format!("{}{}", self.cfg.base_url, call.path))
            .map_err(|e| Error::config(format!("Could not build the request URL: {e}")))?;
        {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in &call.query {
                if !v.is_empty() {
                    pairs.append_pair(k, v);
                }
            }
        }
        if url.query() == Some("") {
            url.set_query(None);
        }
        let path = url.path().to_owned();

        let mut headers: Vec<(String, String)> = vec![("Accept".into(), "application/json".into())];
        if call.auth {
            headers.push(("X-API-Key".into(), self.cfg.api_key.expose().to_owned()));
        }
        if call.body.is_some() {
            headers.push(("Content-Type".into(), "application/json".into()));
        }
        headers.push(("User-Agent".into(), self.user_agent.clone()));

        if let (true, Some(secret)) = (call.sign, self.cfg.api_secret.as_ref()) {
            // Fresh timestamp + nonce on every attempt: the server rejects reused nonces.
            let timestamp = (self.now() + self.clock_offset_ms.load(Ordering::Relaxed))
                .div_euclid(1000)
                .to_string();
            let nonce = random_nonce()?;
            let signature = sign_request(
                secret.expose(),
                &timestamp,
                &nonce,
                call.body.unwrap_or("").as_bytes(),
            );
            headers.push(("X-Timestamp".into(), timestamp));
            headers.push(("X-Nonce".into(), nonce));
            headers.push(("X-Signature".into(), format!("sha256={signature}")));
        }

        let request = TransportRequest {
            method: call.method,
            url: url.to_string(),
            headers,
            body: call.body.map(|b| b.as_bytes().to_vec()),
        };

        let outcome = tokio::time::timeout(
            timeout,
            race_cancel(self.cfg.transport.send(request), call.cancel),
        )
        .await;
        let response = match outcome {
            Err(_elapsed) => {
                return Err(Error::timeout(format!(
                    "Request to {path} timed out after {} ms",
                    timeout.as_millis()
                )));
            }
            Ok(Err(_cancelled)) => return Err(Error::aborted("The request was aborted")),
            Ok(Ok(Err(e))) => return Err(self.transport_error(e, &path)),
            Ok(Ok(Ok(response))) => response,
        };
        self.interpret(response, &path)
    }

    fn transport_error(&self, e: TransportError, path: &str) -> Error {
        let detail = self.redact(&e.message);
        let source: crate::error::BoxError = Box::new(TransportError {
            kind: e.kind,
            message: detail.clone(),
            source: None,
        });
        match e.kind {
            TransportErrorKind::Body => {
                Error::connection(format!("Connection dropped while reading the response from {path}: {detail}"), Some(source))
            }
            TransportErrorKind::BodyTooLarge => Error::protocol(
                "response_too_large",
                format!("The response from {path} is larger than {} MiB; refusing to read it", MAX_RESPONSE_BYTES / (1024 * 1024)),
            ),
            TransportErrorKind::Redirected => Error::protocol(
                "unexpected_redirect",
                format!("{path} was redirected. The SDK does not follow redirects because that would send your API key to another host. Set base_url to the final URL."),
            ),
            _ => Error::connection(format!("Could not reach {}: {detail}", self.host), Some(source)),
        }
    }

    fn interpret(&self, response: TransportResponse, path: &str) -> Result<Reply, Error> {
        let status = response.status;
        if (300..400).contains(&status) {
            let location = response
                .header("location")
                .map(|l| self.redact(&l.chars().take(200).collect::<String>()));
            let target = location.map(|l| format!(" to {l}")).unwrap_or_default();
            let scheme_hint = if self.cfg.base_url.starts_with("http://") {
                " (use https://)"
            } else {
                ""
            };
            return Err(Error::protocol(
                "unexpected_redirect",
                format!(
                    "{path} was redirected{target}. The SDK does not follow redirects because that would send your API key to another host. Set base_url to the final URL{scheme_hint}."
                ),
            ));
        }
        if response.body.len() > MAX_RESPONSE_BYTES {
            return Err(Error::protocol(
                "response_too_large",
                format!("The response from {path} is larger than 32 MiB; refusing to read it"),
            ));
        }

        let parsed: Option<Value> = if response.body.is_empty() {
            None
        } else {
            serde_json::from_slice(&response.body).ok()
        };

        if !(200..300).contains(&status) {
            let body = match parsed {
                Some(v) => v,
                None => Value::String(String::from_utf8_lossy(&response.body).into_owned()),
            };
            let server_time_ms = response.header("date").and_then(parse_http_date);
            let retry_after = parse_retry_after(response.header("retry-after"), self.now());
            let status_text = reqwest::StatusCode::from_u16(status)
                .ok()
                .and_then(|s| s.canonical_reason());
            let redact = |t: &str| self.redact(t);
            return Err(Error::from_response(
                status,
                body,
                &ResponseContext {
                    has_api_secret: self.has_api_secret(),
                    retry_after,
                    server_time_ms,
                    status_text,
                    redact: &redact,
                },
            ));
        }
        let Some(data) = parsed else {
            return Err(Error::protocol(
                "invalid_response",
                format!("Unexpected non-JSON response from {path} (HTTP {status}). Is base_url pointing at your Unsent deployment?"),
            ));
        };
        let replayed_header = response
            .header("idempotent-replayed")
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("true"));
        Ok(Reply {
            status,
            data,
            replayed_header,
        })
    }
}
