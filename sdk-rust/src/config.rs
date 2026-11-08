//! Client configuration.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use url::{Host, Url};

use crate::address::Address;
use crate::client::Unsent;
use crate::error::Error;
use crate::http::{Clock, HttpClient, HttpConfig};
use crate::secret::Secret;
use crate::time::now_ms;
use crate::transport::{ReqwestTransport, Transport};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_MAX_RETRIES: u32 = 3;
const ENV_BASE_URL: &str = "UNSENT_BASE_URL";
const ENV_API_KEY: &str = "UNSENT_API_KEY";
const ENV_API_SECRET: &str = "UNSENT_API_SECRET";

/// Normalize and vet the deployment URL: trimmed, query and fragment dropped, trailing `/` removed, path prefix
/// kept. Must be `https://` (plain `http://` only for loopback hosts) and carry no credentials.
pub(crate) fn normalize_base_url(raw: &str) -> Result<String, Error> {
    let url = Url::parse(raw.trim()).map_err(|_| {
        Error::config(format!(
            "base_url {} is not a valid URL. Expected something like https://unsent.example.com",
            crate::address::preview(raw)
        ))
    })?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(Error::config(format!(
            "base_url must start with https:// (got {}://)",
            url.scheme()
        )));
    }
    let loopback = match url.host() {
        Some(Host::Domain(d)) => d == "localhost" || d.ends_with(".localhost"),
        Some(Host::Ipv4(ip)) => ip.octets() == [127, 0, 0, 1],
        Some(Host::Ipv6(ip)) => ip == std::net::Ipv6Addr::LOCALHOST,
        None => false,
    };
    if url.scheme() == "http" && !loopback {
        return Err(Error::config(
            "base_url uses plain http://, which would send your API key unencrypted. Use https:// (http:// is only allowed for localhost).",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Error::config(
            "base_url must not contain credentials; pass api_key/api_secret instead.",
        ));
    }
    if url.host().is_none() {
        return Err(Error::config(
            "base_url has no host. Expected something like https://unsent.example.com",
        ));
    }
    let mut url = url;
    url.set_fragment(None);
    url.set_query(None);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

/// Credentials end up in HTTP headers (key) and in an HMAC key (secret): printable ASCII only, so control
/// characters, line breaks and non-ASCII bytes can never reach a header.
fn validate_credential(value: &str, name: &str) -> Result<(), Error> {
    if value.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        Ok(())
    } else {
        Err(Error::config(format!(
            "{name} contains control or non-ASCII characters. Check for stray newlines or a wrongly copied value."
        )))
    }
}

fn clean(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

/// Configures and builds an [`Unsent`] client.
///
/// ```no_run
/// use std::time::Duration;
/// use unsent::Unsent;
///
/// # fn main() -> Result<(), unsent::Error> {
/// let client = Unsent::builder()
///     .base_url("https://unsent.example.com")
///     .api_key("...")
///     .api_secret("...")
///     .timeout(Duration::from_secs(10))
///     .max_retries(2)
///     .build()?;
/// # let _ = client;
/// # Ok(())
/// # }
/// ```
///
/// Values you do not set fall back to the `UNSENT_BASE_URL`, `UNSENT_API_KEY` and `UNSENT_API_SECRET`
/// environment variables (empty variables count as unset); explicit values always win. Call
/// [`no_env`](UnsentBuilder::no_env) to ignore the environment entirely.
#[derive(Clone)]
pub struct UnsentBuilder {
    base_url: Option<String>,
    api_key: Option<Secret>,
    api_secret: Option<Secret>,
    default_from: Option<Address>,
    default_provider_id: Option<String>,
    timeout: Duration,
    max_retries: u32,
    transport: Option<Arc<dyn Transport>>,
    reqwest_client: Option<reqwest::Client>,
    use_env: bool,
    clock: Option<Clock>,
}

impl fmt::Debug for UnsentBuilder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("UnsentBuilder")
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "***"))
            .field("api_secret", &self.api_secret.as_ref().map(|_| "***"))
            .field("default_from", &self.default_from)
            .field("default_provider_id", &self.default_provider_id)
            .field("timeout", &self.timeout)
            .field("max_retries", &self.max_retries)
            .finish_non_exhaustive()
    }
}

impl Default for UnsentBuilder {
    fn default() -> Self {
        UnsentBuilder {
            base_url: None,
            api_key: None,
            api_secret: None,
            default_from: None,
            default_provider_id: None,
            timeout: DEFAULT_TIMEOUT,
            max_retries: DEFAULT_MAX_RETRIES,
            transport: None,
            reqwest_client: None,
            use_env: true,
            clock: None,
        }
    }
}

impl UnsentBuilder {
    /// Your deployment URL, for example `https://unsent.example.com`. `http://` is accepted only for
    /// `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`.
    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = Some(base_url.into());
        self
    }

    /// The `API_KEY` of your deployment.
    pub fn api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(Secret::new(api_key));
        self
    }

    /// The `API_SECRET` of your deployment, used to sign requests. Required unless the server runs with
    /// `SECURITY_MODE=api-key-only`; safe to pass in every mode.
    pub fn api_secret(mut self, api_secret: impl Into<String>) -> Self {
        self.api_secret = Some(Secret::new(api_secret));
        self
    }

    /// Default sender for sends that do not set `from`.
    pub fn default_from(mut self, from: impl Into<Address>) -> Self {
        self.default_from = Some(from.into());
        self
    }

    /// Default provider id for sends that do not set `provider_id`.
    pub fn default_provider_id(mut self, provider_id: impl Into<String>) -> Self {
        self.default_provider_id = Some(provider_id.into());
        self
    }

    /// Per-attempt timeout (default 30 s). Must be greater than zero.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Retries after the first attempt (default 3, maximum 10). `0` disables retries.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Use a custom [`Transport`] (tests, proxies, instrumentation) instead of `reqwest`.
    pub fn transport(mut self, transport: impl Transport) -> Self {
        self.transport = Some(Arc::new(transport));
        self
    }

    /// Use your own `reqwest::Client` (proxy settings, extra root certificates...).
    ///
    /// Build it with `redirect(reqwest::redirect::Policy::none())`: the SDK must never follow redirects, because
    /// that would forward your API key to another host. If the client does follow one, the call fails with
    /// `unexpected_redirect`.
    pub fn reqwest_client(mut self, client: reqwest::Client) -> Self {
        self.reqwest_client = Some(client);
        self
    }

    /// Do not read `UNSENT_*` environment variables; use only what was set on the builder.
    pub fn no_env(mut self) -> Self {
        self.use_env = false;
        self
    }

    #[doc(hidden)]
    /// Override the wall clock (milliseconds since the Unix epoch). Used by tests to simulate clock skew.
    pub fn clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }

    /// Build the client, validating every option. Nothing is sent.
    pub fn build(self) -> Result<Unsent, Error> {
        self.build_with(|name| std::env::var(name).ok())
    }

    pub(crate) fn build_with(self, env: impl Fn(&str) -> Option<String>) -> Result<Unsent, Error> {
        let from_env = |name: &str| if self.use_env { clean(env(name)) } else { None };
        let base_url = clean(self.base_url.clone()).or_else(|| from_env(ENV_BASE_URL));
        let api_key = clean(self.api_key.as_ref().map(|s| s.expose().to_owned()))
            .or_else(|| from_env(ENV_API_KEY));
        let api_secret = clean(self.api_secret.as_ref().map(|s| s.expose().to_owned()))
            .or_else(|| from_env(ENV_API_SECRET));

        let Some(base_url) = base_url else {
            return Err(Error::config(
                "Missing base_url. Pass .base_url(..) or set UNSENT_BASE_URL (e.g. https://unsent.example.com).",
            ));
        };
        let Some(api_key) = api_key else {
            return Err(Error::config(
                "Missing api_key. Pass .api_key(..) or set UNSENT_API_KEY (the API_KEY of your deployment).",
            ));
        };
        validate_credential(&api_key, "api_key")?;
        if let Some(secret) = &api_secret {
            validate_credential(secret, "api_secret")?;
        }

        if self.timeout.is_zero() {
            return Err(Error::config("timeout must be greater than zero"));
        }
        if self.max_retries > 10 {
            return Err(Error::config("max_retries must be an integer from 0 to 10"));
        }
        let base_url = normalize_base_url(&base_url)?;

        let transport: Arc<dyn Transport> = match (self.transport, self.reqwest_client) {
            (Some(t), _) => t,
            (None, Some(client)) => Arc::new(ReqwestTransport::new(client)),
            (None, None) => {
                let client = ReqwestTransport::default_client().map_err(|e| {
                    Error::config_code(
                        "http_client_error",
                        format!("Could not initialise the HTTP client: {e}"),
                    )
                })?;
                Arc::new(ReqwestTransport::new(client))
            }
        };
        let clock: Clock = self.clock.unwrap_or_else(|| Arc::new(now_ms));

        let http = HttpClient::new(HttpConfig {
            base_url,
            api_key: Secret::new(api_key),
            api_secret: api_secret.map(Secret::new),
            timeout: self.timeout,
            max_retries: self.max_retries,
            transport,
            clock,
        });
        Ok(Unsent::from_parts(
            http,
            self.default_from,
            self.default_provider_id,
        ))
    }
}
