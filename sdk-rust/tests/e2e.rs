//! End-to-end tests against a real Unsent worker (SPEC section 7.4). They are skipped (they return early) unless
//! `UNSENT_E2E_BASE_URL` is set:
//!
//! ```text
//! eval "$(scripts/e2e-server.sh start 8814)"      # exports UNSENT_E2E_* variables
//! cargo test --test e2e
//! scripts/e2e-server.sh stop 8814
//! ```
//!
//! The server mode (`UNSENT_E2E_MODE`: full | signed | api-key-only) is honoured, so the same suite can run
//! against all three.

mod common;

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use unsent::{
    Address, Attachment, EmailStatus, Error, ListEmails, SendEmail, Unsent, UnsentBuilder,
};

struct E2e {
    base_url: String,
    api_key: String,
    api_secret: String,
    from: String,
    mode: String,
    mails_file: Option<String>,
}

fn e2e() -> Option<E2e> {
    let base_url = std::env::var("UNSENT_E2E_BASE_URL")
        .ok()
        .filter(|v| !v.is_empty());
    let Some(base_url) = base_url else {
        eprintln!("skipping: UNSENT_E2E_BASE_URL is not set");
        return None;
    };
    let var = |n: &str| std::env::var(n).unwrap_or_default();
    Some(E2e {
        base_url,
        api_key: var("UNSENT_E2E_API_KEY"),
        api_secret: var("UNSENT_E2E_API_SECRET"),
        from: std::env::var("UNSENT_E2E_FROM").unwrap_or_else(|_| "noreply@e2e.test".into()),
        mode: std::env::var("UNSENT_E2E_MODE").unwrap_or_else(|_| "full".into()),
        mails_file: std::env::var("UNSENT_E2E_MAILS_FILE")
            .ok()
            .filter(|v| !v.is_empty()),
    })
}

impl E2e {
    fn builder(&self) -> UnsentBuilder {
        Unsent::builder()
            .no_env()
            .base_url(&self.base_url)
            .api_key(&self.api_key)
            .api_secret(&self.api_secret)
            .default_from(self.from.as_str())
    }
    fn client(&self) -> Unsent {
        self.builder().build().unwrap()
    }
    fn signed(&self) -> bool {
        self.mode != "api-key-only"
    }
}

fn uid() -> String {
    use std::sync::atomic::AtomicU64;
    static N: AtomicU64 = AtomicU64::new(0);
    format!(
        "{:x}{:x}{}",
        now_ms(),
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    )
}

async fn count_matching(u: &Unsent, tag: &str) -> u64 {
    u.emails()
        .list(ListEmails::new().search(tag).limit(200))
        .await
        .unwrap()
        .total
}

#[tokio::test]
async fn health_and_authenticated_status() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let h = u.health().await.unwrap();
    assert_eq!((h.status.as_str(), h.runtime.as_str()), ("ok", "cf_worker"));
    let s = u.status().await.unwrap();
    assert!(s.queued + s.sending + s.sent + s.failed < u64::MAX);
}

#[tokio::test]
async fn sends_a_text_only_email_and_sees_it_delivered() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let tag = uid();
    let res = u
        .send(
            SendEmail::builder()
                .to(format!("rcpt-{tag}@example.com"))
                .subject(format!("e2e text {tag}"))
                .text("Plain *text* <ok>"),
        )
        .await
        .unwrap();
    assert_eq!(res.status, EmailStatus::Queued);
    assert!(!res.idempotent_replay);
    let email = u
        .emails()
        .wait_with(
            res.id,
            unsent::WaitOptions::new()
                .timeout(Duration::from_secs(30))
                .interval(Duration::from_millis(200)),
        )
        .await
        .unwrap();
    assert_eq!(email.status, EmailStatus::Sent, "{:?}", email.error);
    assert_eq!(email.to, vec![format!("rcpt-{tag}@example.com")]);
    assert_eq!(email.text_body.as_deref(), Some("Plain *text* <ok>"));
    assert!(
        email.html_body.contains("Plain *text* &lt;ok&gt;"),
        "{}",
        email.html_body
    );
    assert_eq!(email.idempotency_key, res.idempotency_key);
    assert!(
        email.attempts <= 1,
        "attempts counts failed deliveries: {}",
        email.attempts
    );
    assert!(email.created_at <= email.updated_at);
    if let Some(path) = &e.mails_file {
        let mails = std::fs::read_to_string(path).unwrap_or_default();
        assert!(mails.contains(&tag), "the SMTP sink received the message");
    }
}

#[tokio::test]
async fn round_trips_html_text_cc_bcc_unicode_and_binary_attachments_byte_exactly() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let tag = uid();
    let all_bytes: Vec<u8> = (0..=255u8).collect();
    let mut rng = Rng::new(now_ms() as u64);
    let random = rng.bytes(50_000);
    let res = u
        .send(
            SendEmail::builder()
                .from(Address::with_name(e.from.as_str(), "E2E Sender é 日本"))
                .to_all([
                    format!("a-{tag}@example.com"),
                    format!("b-{tag}@example.com"),
                ])
                .cc(format!("c-{tag}@example.com"))
                .bcc(format!("d-{tag}@example.com"))
                .subject(format!("e2e full Grüße 🎉 {tag}"))
                .html(format!("<h1>{tag}</h1><p>日本語 — \"quotes\"</p>"))
                .text(format!("text {tag} ü"))
                .attachment(
                    Attachment::from_bytes("bytes.bin", all_bytes.clone())
                        .content_type("application/octet-stream"),
                )
                .attachment(
                    Attachment::from_base64("hello.txt", "aGVsbG8=").content_type("text/plain"),
                )
                .attachment(Attachment::from_bytes("random.dat", random.clone())),
        )
        .await
        .unwrap();
    let email = u
        .emails()
        .wait_with(
            res.id,
            unsent::WaitOptions::new()
                .timeout(Duration::from_secs(30))
                .interval(Duration::from_millis(200)),
        )
        .await
        .unwrap();
    assert_eq!(email.status, EmailStatus::Sent, "{:?}", email.error);
    assert_eq!(email.from_name.as_deref(), Some("E2E Sender é 日本"));
    assert_eq!(email.from_email.as_deref(), Some(e.from.as_str()));
    assert_eq!(email.cc, Some(vec![format!("c-{tag}@example.com")]));
    assert_eq!(email.bcc, Some(vec![format!("d-{tag}@example.com")]));
    assert_eq!(email.subject, format!("e2e full Grüße 🎉 {tag}"));
    assert_eq!(
        email.html_body,
        format!("<h1>{tag}</h1><p>日本語 — \"quotes\"</p>")
    );
    assert_eq!(email.text_body, Some(format!("text {tag} ü")));
    let meta: Vec<_> = email
        .attachments
        .iter()
        .map(|a| (a.filename.as_str(), a.size, a.mime_type.as_deref()))
        .collect();
    assert_eq!(
        meta,
        vec![
            ("bytes.bin", 256, Some("application/octet-stream")),
            ("hello.txt", 5, Some("text/plain")),
            ("random.dat", 50_000, None)
        ]
    );
    assert_eq!(email.attachments[0].bytes().unwrap().unwrap(), all_bytes);
    assert_eq!(email.attachments[1].bytes().unwrap().unwrap(), b"hello");
    assert_eq!(email.attachments[2].bytes().unwrap().unwrap(), random);

    let listed = u
        .emails()
        .list(ListEmails::new().search(&tag))
        .await
        .unwrap();
    let row = listed
        .emails
        .iter()
        .find(|m| m.id == res.id)
        .expect("listed");
    let meta: Vec<_> = row
        .attachments
        .iter()
        .map(|a| {
            (
                a.filename.as_str(),
                a.size,
                a.mime_type.as_deref(),
                a.content.is_none(),
            )
        })
        .collect();
    assert_eq!(
        meta,
        vec![
            ("bytes.bin", 256, Some("application/octet-stream"), true),
            ("hello.txt", 5, Some("text/plain"), true),
            ("random.dat", 50_000, None, true)
        ]
    );
    if let Some(path) = &e.mails_file {
        let mails = std::fs::read_to_string(path).unwrap_or_default();
        assert!(mails.contains(&tag));
    }
}

#[tokio::test]
async fn is_idempotent_replay_returns_the_same_email_and_a_changed_message_conflicts() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let key = format!("e2e-{}", uid());
    let msg = |text: &str| {
        SendEmail::builder()
            .to("idem@example.com")
            .subject("idem")
            .text(text)
            .idempotency_key(key.clone())
    };
    let first = u.send(msg("same")).await.unwrap();
    let again = u.send(msg("same")).await.unwrap();
    assert_eq!((again.id, again.idempotent_replay), (first.id, true));
    assert_eq!(again.idempotency_key.as_deref(), Some(key.as_str()));
    let err = u.send(msg("different")).await.unwrap_err();
    assert!(matches!(err, Error::Conflict(_)), "{err:?}");
    assert_eq!(err.code(), "idempotency_key_conflict");
    assert_eq!(err.existing_email_id(), Some(first.id));
    assert_eq!(err.status(), Some(409));
}

#[tokio::test]
async fn six_parallel_sends_with_one_key_create_exactly_one_email() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let tag = uid();
    let key = format!("e2e-par-{tag}");
    let mut set = tokio::task::JoinSet::new();
    for _ in 0..6 {
        let u = u.clone();
        let (key, tag) = (key.clone(), tag.clone());
        set.spawn(async move {
            u.send(
                SendEmail::builder()
                    .to("par@example.com")
                    .subject(format!("par {tag}"))
                    .text("x")
                    .idempotency_key(key),
            )
            .await
        });
    }
    let mut results = Vec::new();
    while let Some(r) = set.join_next().await {
        results.push(r.unwrap().unwrap());
    }
    let ids: std::collections::HashSet<_> = results.iter().map(|r| r.id).collect();
    assert_eq!(ids.len(), 1);
    assert_eq!(results.iter().filter(|r| !r.idempotent_replay).count(), 1);
    assert_eq!(count_matching(&u, &tag).await, 1);
}

#[tokio::test]
async fn twenty_five_concurrent_signed_sends_all_pass_nonce_replay_protection() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let tag = uid();
    let mut set = tokio::task::JoinSet::new();
    for i in 0..25 {
        let u = u.clone();
        let tag = tag.clone();
        set.spawn(async move {
            u.send(
                SendEmail::builder()
                    .to("burst@example.com")
                    .subject(format!("burst {tag} {i}"))
                    .text("x"),
            )
            .await
        });
    }
    let mut ids = std::collections::HashSet::new();
    while let Some(r) = set.join_next().await {
        ids.insert(r.unwrap().unwrap().id);
    }
    assert_eq!(ids.len(), 25);
    assert_eq!(count_matching(&u, &tag).await, 25);
}

#[tokio::test]
async fn corrects_a_skewed_local_clock_automatically() {
    let Some(e) = e2e() else { return };
    for skew in [-10 * 60_000i64, 30 * 60_000, -7 * 24 * 3_600_000] {
        let u = e.builder().clock(move || now_ms() + skew).build().unwrap();
        let tag = uid();
        let res = u
            .send(
                SendEmail::builder()
                    .to("skew@example.com")
                    .subject(format!("skew {tag}"))
                    .text("x"),
            )
            .await
            .unwrap();
        assert!(res.id > 0);
        if e.signed() {
            let off = u.clock_offset_ms();
            assert!(
                (off + skew).abs() < 5_000,
                "learned offset {off} for skew {skew}"
            );
        }
        // later calls reuse the learned offset
        u.send(
            SendEmail::builder()
                .to("skew@example.com")
                .subject(format!("skew2 {tag}"))
                .text("x"),
        )
        .await
        .unwrap();
        assert_eq!(count_matching(&e.client(), &tag).await, 2);
    }
}

#[tokio::test]
async fn rejects_wrong_credentials_with_actionable_errors() {
    let Some(e) = e2e() else { return };
    let msg = || {
        SendEmail::builder()
            .to("a@example.com")
            .subject("s")
            .text("t")
    };

    let bad_key = e
        .builder()
        .api_key("nope-nope-nope")
        .max_retries(0)
        .build()
        .unwrap();
    let err = bad_key.send(msg()).await.unwrap_err();
    assert!(matches!(err, Error::Authentication(_)), "{err:?}");
    assert_eq!(err.code(), "invalid_api_key");
    assert!(err.hint().unwrap().contains("api_key"));
    let err = bad_key.status().await.unwrap_err();
    assert_eq!((err.status(), err.code()), (Some(401), "unauthorized"));
    assert!(err.hint().unwrap().contains("api_key"));
    assert!(!err.message().contains("nope-nope-nope"));

    if e.signed() {
        let bad_secret = e
            .builder()
            .api_secret("wrong-secret-value")
            .max_retries(0)
            .build()
            .unwrap();
        let err = bad_secret.send(msg()).await.unwrap_err();
        assert!(matches!(err, Error::Authentication(_)), "{err:?}");
        assert_eq!(err.code(), "invalid_signature");
        assert!(err.hint().unwrap().contains("api_secret"));
        assert!(!format!("{err:?}").contains("wrong-secret-value"));

        let no_secret = Unsent::builder()
            .no_env()
            .base_url(&e.base_url)
            .api_key(&e.api_key)
            .max_retries(0)
            .build()
            .unwrap();
        let err = no_secret.send(msg()).await.unwrap_err();
        assert!(matches!(err, Error::Authentication(_)), "{err:?}");
        assert!(err.hint().unwrap().contains("signed requests"), "{err}");
        // reading needs only the key
        no_secret.status().await.unwrap();
    } else {
        // api-key-only servers accept unsigned and wrongly signed sends
        let no_secret = Unsent::builder()
            .no_env()
            .base_url(&e.base_url)
            .api_key(&e.api_key)
            .default_from(e.from.as_str())
            .build()
            .unwrap();
        no_secret.send(msg()).await.unwrap();
        e.builder()
            .api_secret("wrong-secret-value")
            .build()
            .unwrap()
            .send(msg())
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn rejects_unauthorized_senders_and_unknown_emails() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let err = u
        .send(
            SendEmail::builder()
                .from("stranger@evil.test")
                .to("a@example.com")
                .subject("s")
                .text("t"),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Request(_)), "{err:?}");
    assert_eq!(err.code(), "unauthorized_sender");
    assert_eq!(err.status(), Some(400));
    assert!(err.hint().unwrap().contains("not an active provider"));
    let err = u.emails().get(99_999_999).await.unwrap_err();
    assert!(matches!(err, Error::NotFound(_)), "{err:?}");
    assert_eq!(err.code(), "not_found");
    let err = u
        .send(
            SendEmail::builder()
                .to("a@example.com")
                .subject("s")
                .text("t")
                .provider_id("no-such-provider"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.status(), Some(400), "{err:?}");
}

#[tokio::test]
async fn the_server_rejects_what_the_client_would_not_catch() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    // The client allows ~3 MiB; the server stores ~1.9 MB, so a 2 MB attachment is a 413 from the server.
    let err = u
        .send(
            SendEmail::builder()
                .to("big@example.com")
                .subject("big")
                .text("x")
                .attachment(Attachment::from_bytes("big.bin", vec![7u8; 1_600_000])),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Request(_)), "{err:?}");
    assert_eq!((err.status(), err.code()), (Some(413), "payload_too_large"));
}

#[tokio::test]
async fn paginates_with_iterate_and_filters() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let tag = uid();
    let mut sent = Vec::new();
    for i in 0..16 {
        sent.push(
            u.send(
                SendEmail::builder()
                    .to("page@example.com")
                    .subject(format!("page {tag} {i}"))
                    .text("x"),
            )
            .await
            .unwrap()
            .id,
        );
    }
    let mut it = u.emails().iterate(ListEmails::new().search(&tag).limit(7));
    let mut ids = Vec::new();
    while let Some(m) = it.next().await {
        ids.push(m.unwrap().id);
    }
    assert_eq!(ids.len(), 16);
    let mut sorted = ids.clone();
    sorted.sort_unstable();
    assert_eq!(ids, sorted, "oldest first");
    assert_eq!(sorted, {
        let mut s = sent.clone();
        s.sort_unstable();
        s
    });
    // filters and sort order reach the server correctly
    let page = u
        .emails()
        .list(
            ListEmails::new()
                .search(&tag)
                .limit(5)
                .sort(unsent::Sort::CreatedAtDesc),
        )
        .await
        .unwrap();
    assert_eq!(
        (page.emails.len(), page.total, page.has_more),
        (5, 16, true)
    );
    assert!(page.emails.windows(2).all(|w| w[0].id > w[1].id));
    let today = unsent::Day::from(std::time::SystemTime::now());
    assert_eq!(
        u.emails()
            .list(ListEmails::new().search(&tag).from(today.clone()).to(today))
            .await
            .unwrap()
            .total,
        16
    );
    assert_eq!(
        u.emails()
            .list(ListEmails::new().search(&tag).to("2000-01-01"))
            .await
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        u.emails()
            .list(ListEmails::new().search(format!("{tag} no-such-text")))
            .await
            .unwrap()
            .total,
        0
    );
    let done = u.emails().wait(*ids.last().unwrap()).await.unwrap();
    assert_eq!(done.status, EmailStatus::Sent);
}

#[tokio::test]
async fn a_cancelled_call_stops_and_the_client_stays_usable() {
    let Some(e) = e2e() else { return };
    let u = e.client();
    let token = unsent::CancellationToken::new();
    token.cancel();
    let err = u
        .send(
            SendEmail::builder()
                .to("a@example.com")
                .subject("s")
                .text("t")
                .cancellation_token(token),
        )
        .await
        .unwrap_err();
    assert!(err.is_aborted());
    // dropping a call mid-flight is safe, too
    let _ = tokio::time::timeout(Duration::from_millis(1), u.status()).await;
    u.status().await.unwrap();
}

/// A TCP proxy to the worker that forwards the first `POST /api/send` upstream, then kills the connection before
/// relaying the reply: the "lost response" failure.
async fn lost_response_proxy(
    upstream: String,
    kill_first_n: usize,
) -> (
    SocketAddr,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let forwarded = Arc::new(AtomicUsize::new(0));
    let killed = Arc::new(AtomicUsize::new(0));
    let (f2, k2) = (forwarded.clone(), killed.clone());
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut client, _)) = listener.accept().await else {
                return;
            };
            let (upstream, f, k) = (upstream.clone(), f2.clone(), k2.clone());
            tokio::spawn(async move {
                let Some(req) = read_request(&mut client).await else {
                    return;
                };
                let Ok(mut up) = TcpStream::connect(&upstream).await else {
                    return;
                };
                let mut raw = format!(
                    "{} {} HTTP/1.1\r\nHost: {upstream}\r\nConnection: close\r\n",
                    req.method, req.target
                )
                .into_bytes();
                for (name, value) in &req.headers {
                    if !["host", "connection", "proxy-connection"]
                        .contains(&name.to_lowercase().as_str())
                    {
                        raw.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
                    }
                }
                raw.extend_from_slice(b"\r\n");
                raw.extend_from_slice(&req.body);
                if up.write_all(&raw).await.is_err() {
                    return;
                }
                let mut response = Vec::new();
                let _ = up.read_to_end(&mut response).await;
                f.fetch_add(1, Ordering::SeqCst);
                let is_send = req.method == "POST" && req.target.ends_with("/api/send");
                if is_send && k.load(Ordering::SeqCst) < kill_first_n {
                    k.fetch_add(1, Ordering::SeqCst);
                    // the email was accepted upstream; the client never learns about it
                    drop(client);
                    return;
                }
                // make sure the client does not try to reuse this connection
                if let Some(end) = response.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&response[..end]).into_owned();
                    let mut out = String::new();
                    for line in head.split("\r\n") {
                        if !line.to_lowercase().starts_with("connection:") {
                            out.push_str(line);
                            out.push_str("\r\n");
                        }
                    }
                    out.push_str("Connection: close\r\n\r\n");
                    let mut bytes = out.into_bytes();
                    bytes.extend_from_slice(&response[end + 4..]);
                    response = bytes;
                }
                let _ = client.write_all(&response).await;
                let _ = client.shutdown().await;
            });
        }
    });
    (addr, forwarded, killed, task)
}

#[tokio::test]
async fn survives_the_lost_response_failure_with_exactly_one_email() {
    let Some(e) = e2e() else { return };
    let upstream = e
        .base_url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_owned();
    for kills in [1usize, 2] {
        let (addr, forwarded, killed, task) = lost_response_proxy(upstream.clone(), kills).await;
        let tag = uid();
        let u = e
            .builder()
            .base_url(format!("http://{addr}"))
            .max_retries(5)
            .build()
            .unwrap();
        let res = u
            .send(
                SendEmail::builder()
                    .to("lost@example.com")
                    .subject(format!("lost {tag}"))
                    .text("x"),
            )
            .await
            .unwrap();
        assert_eq!(
            killed.load(Ordering::SeqCst),
            kills,
            "the proxy dropped {kills} reply(ies)"
        );
        assert!(forwarded.load(Ordering::SeqCst) > kills);
        assert!(
            res.idempotent_replay,
            "the retry is recognised by its idempotency key"
        );
        assert_eq!(
            count_matching(&e.client(), &tag).await,
            1,
            "exactly one email exists"
        );
        let done = e.client().emails().wait(res.id).await.unwrap();
        assert_eq!(done.status, EmailStatus::Sent);
        task.abort();
    }
}

#[tokio::test]
async fn without_an_idempotency_key_a_lost_response_is_not_retried() {
    let Some(e) = e2e() else { return };
    let upstream = e
        .base_url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_owned();
    let (addr, forwarded, _killed, task) = lost_response_proxy(upstream, 1).await;
    let tag = uid();
    let u = e
        .builder()
        .base_url(format!("http://{addr}"))
        .max_retries(5)
        .build()
        .unwrap();
    let err = u
        .send(
            SendEmail::builder()
                .to("lost@example.com")
                .subject(format!("lost-nokey {tag}"))
                .text("x")
                .no_idempotency(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Connection(_)), "{err:?}");
    assert_eq!(
        forwarded.load(Ordering::SeqCst),
        1,
        "no retry, so no duplicate"
    );
    assert_eq!(count_matching(&e.client(), &tag).await, 1);
    task.abort();
}
