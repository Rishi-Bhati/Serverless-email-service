//! Security properties (SPEC section 7.3): no secret leakage, no header injection, no redirect following,
//! transport hardening against hostile servers, and ReDoS-safe parsing.

mod common;

use std::time::{Duration, Instant};

use common::*;
use serde_json::json;
use unsent::{Address, Attachment, Error, ListEmails, SendEmail, Unsent};

const KEY: &str = "KEY-4f9a1c7e2b8d4036a5";
const SECRET: &str = "SECRET-7d3e91b05a6c48f2e1";

fn msg() -> SendEmail {
    SendEmail::builder().to("a@b.co").subject("s").html("h")
}

fn secret_client(
    handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static,
) -> (Unsent, Calls) {
    let (t, calls) = mock(handler);
    (
        Unsent::builder()
            .no_env()
            .base_url(BASE)
            .api_key(KEY)
            .api_secret(SECRET)
            .transport(t)
            .max_retries(0)
            .build()
            .unwrap(),
        calls,
    )
}

fn assert_clean(label: &str, text: &str) {
    assert!(!text.contains(KEY), "{label} leaks the api key: {text}");
    assert!(
        !text.contains(SECRET),
        "{label} leaks the api secret: {text}"
    );
}

fn dump_error(e: &Error) -> String {
    let mut out = format!(
        "{e} | {e:?} | {e:#?} | {} | {:?} | {:?} | {:?}",
        e.code(),
        e.reason(),
        e.hint(),
        e.body()
    );
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        out.push_str(&format!(" | {s} | {s:?}"));
        src = s.source();
    }
    out
}

#[tokio::test]
async fn secrets_never_appear_in_debug_display_errors_or_results() {
    let (u, calls) = secret_client(|_, _| accepted(1));
    assert_clean("client debug", &format!("{u:?} {u:#?} {:?}", u.emails()));
    let res = u.send(msg()).await.unwrap();
    assert_clean("send result", &format!("{res:?}"));
    let req = calls.get(0);
    // the key is sent as a header, and only there
    assert_eq!(req.header("X-API-Key"), Some(KEY));
    assert!(!req.body.contains(KEY) && !req.body.contains(SECRET));
    assert_clean("url", req.url.as_str());
    for (k, v) in &req.headers {
        assert!(!v.contains(SECRET), "{k} carries the secret");
        if !k.eq_ignore_ascii_case("x-api-key") {
            assert!(!v.contains(KEY), "{k} carries the key");
        }
    }
    // validation errors that echo user input never echo credentials
    let e = u
        .send(SendEmail::builder().subject("s").html("h"))
        .await
        .unwrap_err();
    assert_clean("validation error", &dump_error(&e));
}

#[tokio::test]
async fn server_replies_that_echo_credentials_are_scrubbed_from_errors() {
    for status in [400u16, 401, 403, 404, 409, 429, 500, 502] {
        let (u, _) = secret_client(move |_, _| {
            json_resp_h(
                json!({"error": format!("bad key {KEY}"), "code": "x", "reason": format!("secret was {SECRET}"), "extra": {"k": KEY, "list": [SECRET]}, "id": 3}),
                status,
                &[("Retry-After", "1")],
            )
        });
        let e = u.send(msg()).await.unwrap_err();
        assert_clean(&format!("status {status}"), &dump_error(&e));
        assert!(e.message().contains("***"));
    }
    // a non-JSON body
    let (u, _) = secret_client(|_, _| resp(502, &[], format!("upstream said {KEY} and {SECRET}")));
    assert_clean("text body", &dump_error(&u.status().await.unwrap_err()));
    // redirect Location
    let (u, _) = secret_client(|_, _| {
        resp(
            302,
            &[(
                "Location",
                &format!("https://evil.test/?k={KEY}&s={SECRET}"),
            )],
            "",
        )
    });
    let e = u.status().await.unwrap_err();
    assert_eq!(e.code(), "unexpected_redirect");
    assert_clean("redirect", &dump_error(&e));
    // transport failure detail
    let (u, _) = secret_client(|_, _| {
        Reply::Error(unsent::TransportError::new(
            unsent::TransportErrorKind::Request,
            format!("failed for {KEY}/{SECRET}"),
        ))
    });
    assert_clean("connection", &dump_error(&u.status().await.unwrap_err()));
}

#[tokio::test]
async fn a_real_connection_failure_does_not_leak_either() {
    // a closed local port
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    let u = Unsent::builder()
        .no_env()
        .base_url(format!("http://127.0.0.1:{port}"))
        .api_key(KEY)
        .api_secret(SECRET)
        .max_retries(0)
        .build()
        .unwrap();
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Connection(_)), "{e:?}");
    assert_clean("connect error", &dump_error(&e));
    assert!(e.message().contains("127.0.0.1"));
}

#[test]
fn credentials_with_control_or_non_ascii_characters_are_rejected_at_construction() {
    let mut bad: Vec<String> = (0u8..0x20)
        .filter(|b| *b != b' ')
        .map(|b| format!("ab{}cd", b as char))
        .collect();
    bad.push("ab\u{7f}cd".into());
    bad.extend(
        [
            "kéy",
            "密钥",
            "k\u{200b}y",
            "k\u{202e}y",
            "k\u{a0}y",
            "key\u{2028}x",
            "🔑",
        ]
        .map(String::from),
    );
    for b in &bad {
        let r = Unsent::builder()
            .no_env()
            .base_url(BASE)
            .api_key(b.as_str())
            .build();
        assert!(matches!(r, Err(Error::Config(_))), "api key {b:?}");
        let r = Unsent::builder()
            .no_env()
            .base_url(BASE)
            .api_key("ok-key-1234")
            .api_secret(b.as_str())
            .build();
        assert!(matches!(r, Err(Error::Config(_))), "api secret {b:?}");
    }
}

#[tokio::test]
async fn user_input_cannot_inject_headers_or_split_the_request() {
    let evil = [
        "x\r\nBcc: attacker@evil.test",
        "x\nX-Injected: 1",
        "x\r\n\r\nPOST /api/send HTTP/1.1",
        "x\0y",
        "%0d%0aBcc: a@b.co",
    ];
    for bad in evil {
        let (u, calls) = secret_client(|_, _| accepted(1));
        // recipients, sender and idempotency key must be rejected outright
        assert!(
            u.send(
                SendEmail::builder()
                    .to(format!("a@b.co{bad}"))
                    .subject("s")
                    .html("h")
            )
            .await
            .is_err()
                || !bad.contains(['\r', '\n', '\0'])
        );
        for email in [
            msg().cc(format!("a@b.co{bad}")),
            msg().bcc(format!("a@b.co{bad}")),
            msg().from(format!("a@b.co{bad}")),
            msg().from(Address::with_name("a@b.co", bad)),
        ] {
            let r = u.send(email).await;
            if bad.contains(['\r', '\n', '\0']) {
                assert!(matches!(r, Err(Error::Validation(_))), "{bad:?}");
            }
        }
        assert!(matches!(
            u.send(msg().idempotency_key(format!("k{bad}"))).await,
            Err(Error::Validation(_)) | Ok(_)
        ));
        // free-text fields are allowed but travel only inside the JSON body, escaped
        u.send(
            msg()
                .provider_id("p")
                .attachment(Attachment::from_bytes(format!("f{bad}.txt"), "x")),
        )
        .await
        .ok();
        u.send(
            SendEmail::builder()
                .to("a@b.co")
                .subject(format!("s{bad}"))
                .text(bad),
        )
        .await
        .unwrap();
        u.emails().list(ListEmails::new().search(bad)).await.ok();
        for req in calls.all() {
            for (k, v) in &req.headers {
                assert!(
                    !k.contains(['\r', '\n', '\0']) && !v.contains(['\r', '\n', '\0']),
                    "{k}: {v:?}"
                );
            }
            assert!(!req.url.as_str().contains(['\r', '\n', '\0']));
            if !req.body.is_empty() {
                assert!(
                    !req.body.contains(['\r', '\n', '\0']),
                    "raw control characters in the JSON body: {:?}",
                    req.body
                );
                serde_json::from_str::<serde_json::Value>(&req.body).expect("body is valid JSON");
            }
            assert!(!req.has("Bcc") && !req.has("X-Injected"));
        }
    }
}

#[tokio::test]
async fn search_text_cannot_add_query_parameters() {
    let (u, calls) = secret_client(|_, _| json_resp(json!({"emails": [], "total": 0}), 200));
    u.emails()
        .list(ListEmails::new().search("x&admin=1&limit=9999#frag"))
        .await
        .unwrap();
    let q = calls.get(0).query();
    assert_eq!(q.len(), 1);
    assert_eq!(q["q"], "x&admin=1&limit=9999#frag");
    assert!(calls.get(0).url.fragment().is_none());
}

#[tokio::test]
async fn email_ids_cannot_escape_the_path() {
    let (u, calls) = secret_client(|_, _| json_resp(json!({"email": {"id": 1}}), 200));
    for id in [1i64, 42, i64::MAX] {
        u.emails().get(id).await.unwrap();
    }
    for r in calls.all() {
        let segs: Vec<_> = r.path().split('/').collect();
        assert_eq!(&segs[..3], &["", "api", "emails"]);
        assert_eq!(segs.len(), 4);
    }
}

#[tokio::test]
async fn never_follows_redirects_over_real_sockets() {
    let target = serve(|_, _| {
        Script::Raw(http_bytes(
            200,
            "OK",
            &[("Content-Type", "application/json")],
            b"{\"queued\":1}",
        ))
    })
    .await;
    for status in [301u16, 302, 303, 307, 308] {
        let loc = format!("{}/stolen", target.url());
        let origin =
            serve(move |_, _| Script::Raw(http_bytes(status, "Moved", &[("Location", &loc)], b"")))
                .await;
        let u = real_client(&origin).max_retries(2).build().unwrap();
        let e = u.status().await.unwrap_err();
        assert_eq!(e.code(), "unexpected_redirect", "{status}: {e}");
        let e = u.send(msg()).await.unwrap_err();
        assert_eq!(e.code(), "unexpected_redirect", "{status}: {e}");
        assert_eq!(origin.hits(), 2, "{status}: redirects are not retried");
    }
    assert_eq!(
        target.hits(),
        0,
        "no request, and so no credentials, ever reached the redirect target"
    );
}

#[tokio::test]
async fn sends_the_expected_bytes_over_a_real_socket() {
    let server = serve(|_, _| {
        Script::Raw(http_bytes(
            202,
            "Accepted",
            &[("Content-Type", "application/json")],
            br#"{"id":5,"status":"queued"}"#,
        ))
    })
    .await;
    let u = real_client(&server).build().unwrap();
    let r = u
        .send(
            SendEmail::builder()
                .to("a@b.co")
                .subject("Grüße 🎉")
                .text("日本語"),
        )
        .await
        .unwrap();
    assert_eq!(r.id, 5);
    let req = server.requests.lock().unwrap()[0].clone();
    assert_eq!(
        (req.method.as_str(), req.target.as_str()),
        ("POST", "/api/send")
    );
    assert_eq!(req.header("x-api-key"), Some(API_KEY));
    assert_eq!(req.header("content-type"), Some("application/json"));
    assert_eq!(req.header("accept"), Some("application/json"));
    assert_eq!(
        req.header("user-agent"),
        Some(format!("unsent-sdk-rust/{}", unsent::VERSION).as_str())
    );
    assert_eq!(
        req.header("content-length")
            .map(|v| v.parse::<usize>().unwrap()),
        Some(req.body.len())
    );
    assert!(
        req.header("accept-encoding").is_none(),
        "no transparent decompression"
    );
    // the signature verifies against the exact bytes on the wire
    let body = String::from_utf8(req.body.clone()).unwrap();
    let ts = req.header("x-timestamp").unwrap();
    let nonce = req.header("x-nonce").unwrap();
    let want = hmac_sha256_hex(
        API_SECRET.as_bytes(),
        format!("{ts}\n{nonce}\n{}", sha256_hex(body.as_bytes())).as_bytes(),
    );
    assert_eq!(
        req.header("x-signature"),
        Some(format!("sha256={want}").as_str())
    );
}

#[tokio::test]
async fn refuses_huge_announced_bodies_without_reading_them() {
    let server = serve(|_, _| {
        Script::Raw(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 99999999999\r\nConnection: close\r\n\r\n{".to_vec())
    })
    .await;
    let u = real_client(&server).max_retries(0).build().unwrap();
    let t0 = Instant::now();
    let e = u.status().await.unwrap_err();
    assert_eq!(e.code(), "response_too_large", "{e}");
    assert!(t0.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn caps_a_never_ending_body_at_32_mib() {
    let server = serve(|_, _| {
        Script::Endless(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n"
                .to_vec(),
            b' ',
        )
    })
    .await;
    let u = real_client(&server)
        .max_retries(0)
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap();
    let t0 = Instant::now();
    let e = u.status().await.unwrap_err();
    assert_eq!(e.code(), "response_too_large", "{e}");
    assert!(t0.elapsed() < Duration::from_secs(30), "{:?}", t0.elapsed());
    // the same for an error status
    let server = serve(|_, _| {
        Script::Endless(
            b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n".to_vec(),
            b'x',
        )
    })
    .await;
    let u = real_client(&server)
        .max_retries(0)
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap();
    assert_eq!(u.status().await.unwrap_err().code(), "response_too_large");
}

#[tokio::test]
async fn a_slow_drip_body_cannot_hang_a_call_past_its_timeout() {
    let server = serve(|_, _| {
        Script::Drip(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n"
                .to_vec(),
        )
    })
    .await;
    let u = real_client(&server)
        .max_retries(0)
        .timeout(Duration::from_millis(400))
        .build()
        .unwrap();
    let t0 = Instant::now();
    let e = u.status().await.unwrap_err();
    assert!(e.is_timeout(), "{e:?}");
    assert!(t0.elapsed() < Duration::from_secs(3));
    // a server that never answers at all
    let server = serve(|_, _| Script::Stall).await;
    let u = real_client(&server)
        .max_retries(1)
        .timeout(Duration::from_millis(200))
        .build()
        .unwrap();
    let t0 = Instant::now();
    assert!(u.status().await.unwrap_err().is_timeout());
    assert!(t0.elapsed() < Duration::from_secs(5));
    assert_eq!(server.hits(), 2, "timed-out GETs are retried");
}

#[tokio::test]
async fn hostile_wire_responses_are_survived() {
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("not http", b"\x00\x01\x02 garbage \xff\xfe".to_vec()),
        ("empty", Vec::new()),
        (
            "truncated body",
            b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"a\":".to_vec(),
        ),
        ("bad status line", b"HTTP/9.9 abc\r\n\r\n".to_vec()),
        (
            "huge header",
            format!(
                "HTTP/1.1 200 OK\r\nX-Big: {}\r\nContent-Length: 2\r\n\r\n{{}}",
                "a".repeat(200_000)
            )
            .into_bytes(),
        ),
        (
            "garbage json",
            http_bytes(200, "OK", &[], b"\xff\xfe\x00{{{{"),
        ),
        (
            "deep json",
            http_bytes(200, "OK", &[], "[".repeat(200_000).as_bytes()),
        ),
        (
            "proto json",
            http_bytes(
                200,
                "OK",
                &[],
                br#"{"__proto__":{"polluted":true},"constructor":{"prototype":{}},"queued":"x"}"#,
            ),
        ),
        (
            "giant retry-after",
            http_bytes(
                503,
                "Unavailable",
                &[("Retry-After", "99999999999999999999")],
                b"{}",
            ),
        ),
        ("html 200", http_bytes(200, "OK", &[], b"<html></html>")),
    ];
    for (name, raw) in cases {
        let server = serve(move |_, _| Script::Raw(raw.clone())).await;
        let u = real_client(&server)
            .max_retries(0)
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let t0 = Instant::now();
        let r = u.status().await;
        assert!(t0.elapsed() < Duration::from_secs(5), "{name} hung");
        if let Err(e) = &r {
            assert!(!e.code().is_empty(), "{name}");
        }
        // every public call survives too
        let _ = u.health().await;
        let _ = u.emails().get(1).await;
        let _ = u.emails().list(ListEmails::new()).await;
        let _ = u.send(msg()).await;
    }
}

#[tokio::test]
async fn https_to_a_plain_text_server_fails_cleanly() {
    use tokio::io::AsyncWriteExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        while let Ok((mut s, _)) = listener.accept().await {
            let _ = s
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
                .await;
        }
    });
    let u = Unsent::builder()
        .no_env()
        .base_url(format!("https://127.0.0.1:{port}"))
        .api_key("k")
        .max_retries(0)
        .build()
        .unwrap();
    let e = u.status().await.unwrap_err();
    assert!(matches!(e, Error::Connection(_)), "{e:?}");
    task.abort();
}

#[test]
fn plain_http_to_remote_hosts_is_rejected() {
    for url in [
        "http://unsent.example.com",
        "http://10.0.0.5",
        "http://[2001:db8::1]",
        "http://localhost.example.com",
        "http://127.0.0.1.example.com",
        "http://notlocalhost",
    ] {
        let r = Unsent::builder()
            .no_env()
            .base_url(url)
            .api_key("k")
            .build();
        assert!(matches!(r, Err(Error::Config(_))), "{url}");
    }
}

fn assert_fast(label: &str, f: impl FnOnce()) {
    let t0 = Instant::now();
    f();
    let took = t0.elapsed();
    assert!(took < Duration::from_millis(900), "{label} took {took:?}");
}

#[tokio::test]
async fn pathological_100k_inputs_finish_quickly() {
    let n = 100_000;
    let (u, _) = secret_client(|_, _| accepted(1));
    let inputs: Vec<(&str, String)> = vec![
        ("lt", "<".repeat(n)),
        ("spaces", " ".repeat(n)),
        ("quotes", "\"".repeat(n)),
        (
            "name+angle",
            format!("{}<{}>", "a ".repeat(n / 2), "b".repeat(n / 2)),
        ),
        ("angle pairs", "<>".repeat(n / 2)),
        ("at signs", "@".repeat(n)),
        ("equals", "=".repeat(n)),
        ("base64-like", format!("{}{}", "A".repeat(n), "=".repeat(n))),
        ("unicode", "日".repeat(n)),
        ("crlf", "\r\n".repeat(n / 2)),
        (
            "almost named",
            format!("\"{}\" <a@b>x", "\"\\".repeat(n / 2)),
        ),
        ("backslashes", "\\".repeat(n)),
    ];
    for (label, s) in inputs {
        assert_fast(label, || {
            let _ = Address::parse(&s);
        });
        let t0 = Instant::now();
        let _ = u
            .send(SendEmail::builder().to(s.clone()).subject("s").html("h"))
            .await;
        let _ = u.send(msg().from(s.clone())).await;
        let _ = u.send(msg().cc(s.clone()).bcc(s.clone())).await;
        let _ = u
            .send(msg().attachment(Attachment::from_base64("f", s.clone())))
            .await;
        let _ = u
            .send(msg().attachment(Attachment::from_base64(s.clone(), "QQ==")))
            .await;
        let _ = u
            .send(msg().provider_id(s.clone()).idempotency_key(s.clone()))
            .await;
        let _ = u
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject(s.clone())
                    .text(s.clone()),
            )
            .await;
        let _ = u
            .emails()
            .list(
                ListEmails::new()
                    .search(s.clone())
                    .from(s.as_str())
                    .to(s.as_str()),
            )
            .await;
        assert!(
            t0.elapsed() < Duration::from_secs(3),
            "{label}: sends took {:?}",
            t0.elapsed()
        );
    }
}
