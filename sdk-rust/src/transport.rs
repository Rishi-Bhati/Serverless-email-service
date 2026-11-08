//! The HTTP transport abstraction and its `reqwest` implementation.

use std::fmt;
use std::future::Future;
use std::pin::Pin;

use crate::error::BoxError;

/// Largest response body the SDK will read (32 MiB).
pub const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// HTTP method of a [`TransportRequest`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// `GET`
    Get,
    /// `POST`
    Post,
}

impl Method {
    /// `"GET"` or `"POST"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
        }
    }
}

/// A request the SDK wants sent.
#[derive(Debug, Clone)]
pub struct TransportRequest {
    /// HTTP method.
    pub method: Method,
    /// Absolute URL.
    pub url: String,
    /// Header names and values. Values may be credentials: do not log them.
    pub headers: Vec<(String, String)>,
    /// Request body, if any.
    pub body: Option<Vec<u8>>,
}

impl TransportRequest {
    /// The value of a header (case-insensitive name).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// A complete HTTP response.
#[derive(Debug, Clone)]
pub struct TransportResponse {
    /// HTTP status code.
    pub status: u16,
    /// Header names and values.
    pub headers: Vec<(String, String)>,
    /// The whole body. Implementations must not read more than [`MAX_RESPONSE_BYTES`].
    pub body: Vec<u8>,
}

impl TransportResponse {
    /// Create a response.
    pub fn new(status: u16, headers: Vec<(String, String)>, body: impl Into<Vec<u8>>) -> Self {
        TransportResponse {
            status,
            headers,
            body: body.into(),
        }
    }

    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// What went wrong when a [`Transport`] could not produce a response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TransportErrorKind {
    /// No response was received (DNS, TCP, TLS, reset...).
    Request,
    /// The response started but the body could not be read completely.
    Body,
    /// The body is larger than [`MAX_RESPONSE_BYTES`] (announced or actual).
    BodyTooLarge,
    /// The transport followed a redirect, which would forward credentials to another host.
    Redirected,
}

/// Failure to obtain a response.
#[derive(Debug)]
pub struct TransportError {
    /// The category of failure.
    pub kind: TransportErrorKind,
    /// Human-readable detail.
    pub message: String,
    /// Underlying error, if any.
    pub source: Option<BoxError>,
}

impl TransportError {
    /// Create an error.
    pub fn new(kind: TransportErrorKind, message: impl Into<String>) -> Self {
        TransportError {
            kind,
            message: message.into(),
            source: None,
        }
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|e| e.as_ref() as &(dyn std::error::Error + 'static))
    }
}

/// A boxed future, as returned by [`Transport::send`].
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Sends one HTTP request and returns the complete response.
///
/// The SDK handles authentication, signing, timeouts, retries and error mapping; a transport only moves bytes.
/// Contract: **never follow redirects** (return the 3xx response as is), and never read more than
/// [`MAX_RESPONSE_BYTES`] of body. Implement it to route through a custom stack, or in tests:
///
/// ```
/// use unsent::{BoxFuture, Transport, TransportError, TransportRequest, TransportResponse};
///
/// struct Canned;
/// impl Transport for Canned {
///     fn send<'a>(&'a self, _req: TransportRequest) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
///         Box::pin(async { Ok(TransportResponse::new(200, vec![], r#"{"status":"ok"}"#)) })
///     }
/// }
/// ```
pub trait Transport: Send + Sync + 'static {
    /// Perform the request. Dropping the returned future must cancel the request.
    fn send<'a>(
        &'a self,
        request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>>;
}

/// The default transport, built on `reqwest` with rustls.
pub(crate) struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub(crate) fn new(client: reqwest::Client) -> Self {
        ReqwestTransport { client }
    }

    /// A client that never follows redirects.
    pub(crate) fn default_client() -> Result<reqwest::Client, reqwest::Error> {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
    }
}

fn root_cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut cur: &dyn std::error::Error = e;
    while let Some(next) = cur.source() {
        cur = next;
    }
    cur.to_string()
}

impl Transport for ReqwestTransport {
    fn send<'a>(
        &'a self,
        request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
        Box::pin(async move {
            let method = match request.method {
                Method::Get => reqwest::Method::GET,
                Method::Post => reqwest::Method::POST,
            };
            let mut builder = self.client.request(method, &request.url);
            for (k, v) in &request.headers {
                builder = builder.header(k.as_str(), v.as_str());
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }
            let mut response = builder.send().await.map_err(|e| TransportError {
                kind: TransportErrorKind::Request,
                message: root_cause(&e),
                source: Some(Box::new(e)),
            })?;
            if response.url().as_str() != request.url {
                return Err(TransportError::new(
                    TransportErrorKind::Redirected,
                    "the HTTP client followed a redirect; build it with redirect::Policy::none()",
                ));
            }
            let status = response.status().as_u16();
            let headers: Vec<(String, String)> = response
                .headers()
                .iter()
                .filter_map(|(k, v)| {
                    v.to_str()
                        .ok()
                        .map(|v| (k.as_str().to_owned(), v.to_owned()))
                })
                .collect();
            if response
                .content_length()
                .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
            {
                return Err(TransportError::new(
                    TransportErrorKind::BodyTooLarge,
                    "the response announces a body larger than 32 MiB",
                ));
            }
            let mut body = Vec::new();
            loop {
                match response.chunk().await {
                    Ok(Some(chunk)) => {
                        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                            return Err(TransportError::new(
                                TransportErrorKind::BodyTooLarge,
                                "the response body exceeds 32 MiB",
                            ));
                        }
                        body.extend_from_slice(&chunk);
                    }
                    Ok(None) => break,
                    Err(e) => {
                        return Err(TransportError {
                            kind: TransportErrorKind::Body,
                            message: root_cause(&e),
                            source: Some(Box::new(e)),
                        })
                    }
                }
            }
            Ok(TransportResponse {
                status,
                headers,
                body,
            })
        })
    }
}
