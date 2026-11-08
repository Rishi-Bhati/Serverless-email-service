//! Shared test helpers: a mock transport, an independent signature verifier, a raw-socket HTTP server and a
//! seeded random number generator.
#![allow(dead_code)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use unsent::{
    BoxFuture, Method, Transport, TransportError, TransportErrorKind, TransportRequest,
    TransportResponse, Unsent, UnsentBuilder,
};

pub const BASE: &str = "https://unsent.test";
pub const API_KEY: &str = "test-api-key";
pub const API_SECRET: &str = "test-api-secret";

// ---------------------------------------------------------------------------------------------------------
// recorded requests and the mock transport
// ---------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: Method,
    pub url: url::Url,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    pub fn has(&self, name: &str) -> bool {
        self.header(name).is_some()
    }
    pub fn path(&self) -> &str {
        self.url.path()
    }
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }
    pub fn query(&self) -> HashMap<String, String> {
        self.url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }
}

pub enum Reply {
    Response(TransportResponse),
    Error(TransportError),
    /// Never completes.
    Hang,
    /// Completes after a delay.
    Delay(Duration, Box<Reply>),
}

type Handler = dyn Fn(&Recorded, usize) -> Reply + Send + Sync;

pub struct MockTransport {
    calls: Arc<Mutex<Vec<Recorded>>>,
    handler: Arc<Handler>,
}

#[derive(Clone)]
pub struct Calls(Arc<Mutex<Vec<Recorded>>>);

impl Calls {
    pub fn all(&self) -> Vec<Recorded> {
        self.0.lock().unwrap().clone()
    }
    pub fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
    pub fn get(&self, i: usize) -> Recorded {
        self.0.lock().unwrap()[i].clone()
    }
    pub fn paths(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.path().to_owned())
            .collect()
    }
    pub fn sends(&self) -> Vec<Recorded> {
        self.all()
            .into_iter()
            .filter(|r| r.path().ends_with("/api/send"))
            .collect()
    }
}

impl Transport for MockTransport {
    fn send<'a>(
        &'a self,
        request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
        let rec = Recorded {
            method: request.method,
            url: url::Url::parse(&request.url).expect("SDK produced an invalid URL"),
            headers: request.headers.clone(),
            body: String::from_utf8(request.body.clone().unwrap_or_default())
                .expect("body is UTF-8"),
        };
        let n = {
            let mut calls = self.calls.lock().unwrap();
            calls.push(rec.clone());
            calls.len()
        };
        let reply = (self.handler)(&rec, n);
        Box::pin(run_reply(reply))
    }
}

fn run_reply(reply: Reply) -> BoxFuture<'static, Result<TransportResponse, TransportError>> {
    Box::pin(async move {
        match reply {
            Reply::Response(r) => Ok(r),
            Reply::Error(e) => Err(e),
            Reply::Hang => std::future::pending().await,
            Reply::Delay(d, inner) => {
                tokio::time::sleep(d).await;
                run_reply(*inner).await
            }
        }
    })
}

pub fn mock(
    handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static,
) -> (MockTransport, Calls) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    (
        MockTransport {
            calls: calls.clone(),
            handler: Arc::new(handler),
        },
        Calls(calls),
    )
}

/// A builder with test credentials, no environment lookup and the given mock handler.
pub fn builder(
    handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static,
) -> (UnsentBuilder, Calls) {
    let (t, calls) = mock(handler);
    (
        Unsent::builder()
            .no_env()
            .base_url(BASE)
            .api_key(API_KEY)
            .api_secret(API_SECRET)
            .transport(t),
        calls,
    )
}

pub fn client(
    handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static,
) -> (Unsent, Calls) {
    let (b, calls) = builder(handler);
    (b.build().unwrap(), calls)
}

// ---------------------------------------------------------------------------------------------------------
// canned replies
// ---------------------------------------------------------------------------------------------------------

pub fn resp(status: u16, headers: &[(&str, &str)], body: impl Into<Vec<u8>>) -> Reply {
    Reply::Response(TransportResponse::new(
        status,
        headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        body,
    ))
}

pub fn json_resp(data: Value, status: u16) -> Reply {
    json_resp_h(data, status, &[])
}

pub fn json_resp_h(data: Value, status: u16, headers: &[(&str, &str)]) -> Reply {
    let mut h = vec![("Content-Type", "application/json")];
    h.extend_from_slice(headers);
    resp(status, &h, data.to_string())
}

pub fn accepted(id: i64) -> Reply {
    json_resp(
        json!({
            "success": true, "id": id, "status": "queued", "idempotent_replay": false,
            "message": "Email successfully queued for sending", "targetProvider": "Automatic Priority / Default"
        }),
        202,
    )
}

pub fn api_error(
    status: u16,
    code: &str,
    error: &str,
    reason: Option<&str>,
    headers: &[(&str, &str)],
) -> Reply {
    let mut body = json!({ "error": error, "code": code });
    if let Some(r) = reason {
        body["reason"] = json!(r);
    }
    json_resp_h(body, status, headers)
}

pub fn connection_reset() -> Reply {
    Reply::Error(TransportError::new(
        TransportErrorKind::Request,
        "connection reset by peer",
    ))
}

// ---------------------------------------------------------------------------------------------------------
// independent re-implementation of the server's signature checks (src/auth.ts, `full` mode)
// ---------------------------------------------------------------------------------------------------------

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// HMAC-SHA256 written out from RFC 2104 on top of the bare hash, deliberately not using the `hmac` crate.
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut key = key.to_vec();
    if key.len() > 64 {
        key = Sha256::digest(&key).to_vec();
    }
    key.resize(64, 0);
    let ipad: Vec<u8> = key.iter().map(|b| b ^ 0x36).collect();
    let opad: Vec<u8> = key.iter().map(|b| b ^ 0x5c).collect();
    let mut inner = Sha256::new();
    inner.update(&ipad);
    inner.update(msg);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(&opad);
    outer.update(inner);
    outer.finalize().to_vec()
}

pub fn hmac_sha256_hex(key: &[u8], msg: &[u8]) -> String {
    hmac_sha256(key, msg)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Ok,
    Bad(&'static str),
}

pub fn verify_signed(
    req: &Recorded,
    secret: &str,
    used_nonces: Option<&mut std::collections::HashSet<String>>,
) -> Verdict {
    verify_signed_at(req, secret, used_nonces, now_ms())
}

pub fn verify_signed_at(
    req: &Recorded,
    secret: &str,
    used_nonces: Option<&mut std::collections::HashSet<String>>,
    server_now_ms: i64,
) -> Verdict {
    if req.header("X-API-Key") != Some(API_KEY) {
        return Verdict::Bad("invalid_api_key");
    }
    let ts = req.header("X-Timestamp").unwrap_or("");
    if ts.is_empty() || !ts.bytes().all(|b| b.is_ascii_digit()) {
        return Verdict::Bad("timestamp_skew");
    }
    let ts_num: f64 = ts.parse().unwrap();
    if (server_now_ms as f64 / 1000.0 - ts_num).abs() > 180.0 {
        return Verdict::Bad("timestamp_skew");
    }
    let nonce = req.header("X-Nonce").unwrap_or("");
    let nonce_ok = (8..=128).contains(&nonce.len())
        && nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !nonce_ok {
        return Verdict::Bad("invalid_nonce");
    }
    let sig_header = req.header("X-Signature").unwrap_or("");
    let sig = sig_header
        .strip_prefix("sha256=")
        .unwrap_or(sig_header)
        .to_lowercase();
    let expected = hmac_sha256_hex(
        secret.as_bytes(),
        format!("{ts}\n{nonce}\n{}", sha256_hex(req.body.as_bytes())).as_bytes(),
    );
    if sig != expected {
        return Verdict::Bad("invalid_signature");
    }
    if let Some(used) = used_nonces {
        if !used.insert(nonce.to_owned()) {
            return Verdict::Bad("nonce_reused");
        }
    }
    if req.has("X-Provider-Id") || req.has("X-Sender-Email") || req.has("Idempotency-Key") {
        return Verdict::Bad("invalid_signature");
    }
    Verdict::Ok
}

/// IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`) for an epoch-millisecond instant.
pub fn http_date(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // civil from days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let wd = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][days.rem_euclid(7) as usize];
    let mon = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ][(m - 1) as usize];
    format!(
        "{wd}, {d:02} {mon} {y:04} {:02}:{:02}:{:02} GMT",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

// ---------------------------------------------------------------------------------------------------------
// a seeded, dependency-free PRNG (SplitMix64)
// ---------------------------------------------------------------------------------------------------------

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in `0..n` (`n > 0`).
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as u64) as i64
    }
    pub fn chance(&mut self, one_in: u64) -> bool {
        self.below(one_in) == 0
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
    pub fn bytes(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.next_u64() as u8).collect()
    }
    /// Hostile text: ASCII, CR/LF/NUL, control characters, unicode, emoji, RTL, combining marks.
    pub fn junk_string(&mut self) -> String {
        const SNIPPETS: &[&str] = &[
            "",
            " ",
            "\r\n",
            "\n",
            "\0",
            "\t",
            "@",
            "a@b.co",
            "<",
            ">",
            "\"",
            "'",
            "&",
            "\\",
            "{",
            "}",
            "[",
            "]",
            "null",
            "true",
            "__proto__",
            "constructor",
            "../../etc/passwd",
            "%00",
            "%0d%0a",
            "Bcc: x@y.z",
            "ü",
            "日本語",
            "🎉",
            "\u{202e}rtl",
            "e\u{301}",
            "\u{feff}",
            "\u{0}",
            "\u{7f}",
            "Name <x@y.z>",
            "\"Q\" <q@x.co>",
            "=",
            "==",
            "====",
            "+/",
            "ünï",
            "\u{85}",
            "\u{2028}",
        ];
        let mut out = String::new();
        for _ in 0..self.below(6) {
            if self.chance(4) {
                out.push_str(self.pick(SNIPPETS));
            } else {
                for _ in 0..self.below(12) {
                    out.push(char::from_u32(self.below(0x2_0000) as u32).unwrap_or('?'));
                }
            }
        }
        if self.chance(40) {
            let unit = self.pick(SNIPPETS).to_string();
            let reps = self.range(1000, 20_000) as usize;
            out = unit.repeat(reps.max(1));
        }
        out
    }
    /// A random JSON value, nested up to `depth`.
    pub fn junk_json(&mut self, depth: u32) -> Value {
        match self.below(if depth == 0 { 6 } else { 9 }) {
            0 => Value::Null,
            1 => Value::Bool(self.chance(2)),
            2 => json!(self.next_u64() as i64),
            3 => json!(self.next_u64() as f64 / 7.0),
            4 | 5 => Value::String(self.junk_string()),
            6 | 7 => Value::Array(
                (0..self.below(4))
                    .map(|_| self.junk_json(depth - 1))
                    .collect(),
            ),
            _ => {
                let mut m = serde_json::Map::new();
                for _ in 0..self.below(5) {
                    let key = if self.chance(5) {
                        "__proto__".to_owned()
                    } else {
                        self.junk_string().chars().take(20).collect()
                    };
                    m.insert(key, self.junk_json(depth - 1));
                }
                Value::Object(m)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------
// a raw-socket HTTP server for tests that need a real transport
// ---------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RawRequest {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl RawRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

pub enum Script {
    /// Write these bytes, then close.
    Raw(Vec<u8>),
    /// Write a head (which should announce no length), then stream this byte forever.
    Endless(Vec<u8>, u8),
    /// Write the head, then one byte per 20 ms forever.
    Drip(Vec<u8>),
    /// Read the request, never answer.
    Stall,
    /// Close the connection without answering.
    Close,
}

pub fn http_bytes(status: u16, reason: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status} {reason}\r\n");
    for (k, v) in headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    let mut bytes = out.into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

pub struct TestServer {
    pub addr: SocketAddr,
    pub hits: Arc<AtomicUsize>,
    pub requests: Arc<Mutex<Vec<RawRequest>>>,
    task: tokio::task::JoinHandle<()>,
}

impl TestServer {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.addr.port())
    }
    pub fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn read_request<S: AsyncReadExt + Unpin>(stream: &mut S) -> Option<RawRequest> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p;
        }
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_owned();
    let target = first.next()?.to_owned();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| {
            l.split_once(':')
                .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        })
        .collect();
    let len: usize = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Some(RawRequest {
        method,
        target,
        headers,
        body,
    })
}

pub async fn serve(
    handler: impl Fn(&RawRequest, usize) -> Script + Send + Sync + 'static,
) -> TestServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let handler = Arc::new(handler);
    let (h2, r2) = (hits.clone(), requests.clone());
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let (handler, hits, requests) = (handler.clone(), h2.clone(), r2.clone());
            tokio::spawn(async move {
                let Some(req) = read_request(&mut stream).await else {
                    return;
                };
                let n = hits.fetch_add(1, Ordering::SeqCst) + 1;
                let script = handler(&req, n);
                requests.lock().unwrap().push(req);
                match script {
                    Script::Raw(bytes) => {
                        let _ = stream.write_all(&bytes).await;
                        let _ = stream.shutdown().await;
                    }
                    Script::Endless(head, byte) => {
                        if stream.write_all(&head).await.is_err() {
                            return;
                        }
                        let block = vec![byte; 64 * 1024];
                        while stream.write_all(&block).await.is_ok() {}
                    }
                    Script::Drip(head) => {
                        if stream.write_all(&head).await.is_err() {
                            return;
                        }
                        while stream.write_all(b" ").await.is_ok() {
                            tokio::time::sleep(Duration::from_millis(20)).await;
                        }
                    }
                    Script::Stall => {
                        tokio::time::sleep(Duration::from_secs(600)).await;
                    }
                    Script::Close => {}
                }
            });
        }
    });
    TestServer {
        addr,
        hits,
        requests,
        task,
    }
}

/// A client talking to a [`TestServer`] over real sockets.
pub fn real_client(server: &TestServer) -> UnsentBuilder {
    Unsent::builder()
        .no_env()
        .base_url(server.url())
        .api_key(API_KEY)
        .api_secret(API_SECRET)
}

// ---------------------------------------------------------------------------------------------------------
// watchdog: a hang must fail the run instead of blocking it forever
// ---------------------------------------------------------------------------------------------------------

pub struct Watchdog(Arc<std::sync::atomic::AtomicBool>);

impl Watchdog {
    pub fn start(label: &'static str, secs: u64) -> Watchdog {
        let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let d2 = done.clone();
        std::thread::spawn(move || {
            for _ in 0..secs * 10 {
                std::thread::sleep(Duration::from_millis(100));
                if d2.load(Ordering::SeqCst) {
                    return;
                }
            }
            eprintln!("WATCHDOG: {label} did not finish within {secs}s (hang)");
            std::process::exit(101);
        });
        Watchdog(done)
    }
}

impl Drop for Watchdog {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}
