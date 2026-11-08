//! `send()`: wire format, signing, message building, idempotency keys and client-side validation
//! (SPEC sections 2 and 3).

mod common;

use std::collections::HashSet;

use common::*;
use serde_json::{json, Value};
use unsent::{Address, Attachment, Error, SendEmail, Unsent};

fn basic() -> SendEmail {
    SendEmail::builder().to("a@b.co").subject("s").html("h")
}

#[tokio::test]
async fn sends_a_correctly_signed_request_the_server_accepts() {
    let (u, calls) = client(|_, _| accepted(1));
    let res = u
        .emails()
        .send(
            SendEmail::builder()
                .from("me@x.co")
                .to("a@b.co")
                .subject("Hello")
                .html("<p>Hi</p>")
                .text("Hi"),
        )
        .await
        .unwrap();
    let req = calls.get(0);
    assert_eq!(req.method, unsent::Method::Post);
    assert_eq!(req.path(), "/api/send");
    assert_eq!(req.header("Content-Type"), Some("application/json"));
    assert_eq!(req.header("Accept"), Some("application/json"));
    assert_eq!(
        req.header("User-Agent"),
        Some(format!("unsent-sdk-rust/{}", unsent::VERSION).as_str())
    );
    assert_eq!(req.header("X-API-Key"), Some(API_KEY));
    assert_eq!(verify_signed(&req, API_SECRET, None), Verdict::Ok);
    assert_eq!(
        (res.id, res.status, res.idempotent_replay),
        (1, unsent::EmailStatus::Queued, false)
    );
    assert_eq!(res.target_provider, "Automatic Priority / Default");
    assert_eq!(res.message, "Email successfully queued for sending");
}

#[tokio::test]
async fn never_sends_routing_or_idempotency_headers() {
    let (u, calls) = client(|_, _| accepted(1));
    u.send(
        SendEmail::builder()
            .from("me@x.co")
            .to("a@b.co")
            .subject("s")
            .html("h")
            .provider_id("p1"),
    )
    .await
    .unwrap();
    let req = calls.get(0);
    for name in ["X-Provider-Id", "X-Sender-Email", "Idempotency-Key"] {
        assert!(!req.has(name), "{name}");
    }
    let body = req.json();
    assert_eq!(body["provider_id"], "p1");
    assert_eq!(body["from"], json!({"email": "me@x.co"}));
}

#[tokio::test]
async fn signs_unicode_and_large_bodies_byte_exactly() {
    let (u, calls) = client(|_, _| accepted(1));
    let html = "<p>日本語 — \"quotes\" \\ \n</p>".repeat(5000);
    u.send(
        SendEmail::builder()
            .to("a@b.co")
            .subject("Grüße 🎉")
            .html(html.clone()),
    )
    .await
    .unwrap();
    let req = calls.get(0);
    assert_eq!(verify_signed(&req, API_SECRET, None), Verdict::Ok);
    assert_eq!(req.json()["html"], html);
    assert_eq!(req.json()["subject"], "Grüße 🎉");
}

#[tokio::test]
async fn the_signature_matches_a_known_answer() {
    // Fixed clock and a hand-computed expectation, so a wrong implementation cannot agree with itself.
    let (b, calls) = builder(|_, _| accepted(1));
    let u = b.clock(|| 1_780_000_123_456).build().unwrap();
    u.send(basic().idempotency_key("fixed-key")).await.unwrap();
    let req = calls.get(0);
    assert_eq!(req.header("X-Timestamp"), Some("1780000123"));
    let nonce = req.header("X-Nonce").unwrap();
    assert_eq!(nonce.len(), 32);
    assert!(nonce
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    let expected = hmac_sha256_hex(
        API_SECRET.as_bytes(),
        format!("1780000123\n{nonce}\n{}", sha256_hex(req.body.as_bytes())).as_bytes(),
    );
    assert_eq!(
        req.header("X-Signature"),
        Some(format!("sha256={expected}").as_str())
    );
    // the body is the compact JSON that was hashed
    assert_eq!(
        req.body,
        r#"{"to":["a@b.co"],"subject":"s","html":"h","idempotency_key":"fixed-key"}"#
    );
}

#[test]
fn the_independent_hmac_matches_rfc_4231() {
    // test case 2 of RFC 4231
    assert_eq!(
        hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?"),
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
    // a key longer than the block size
    let long = vec![0xaa; 131];
    assert_eq!(
        hmac_sha256_hex(
            &long,
            b"Test Using Larger Than Block-Size Key - Hash Key First"
        ),
        "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
    );
}

#[tokio::test]
async fn uses_a_fresh_nonce_on_every_call() {
    let (u, calls) = client(|_, _| accepted(1));
    for _ in 0..20 {
        u.send(basic()).await.unwrap();
    }
    let mut used = HashSet::new();
    for c in calls.all() {
        assert_eq!(verify_signed(&c, API_SECRET, Some(&mut used)), Verdict::Ok);
    }
    assert_eq!(used.len(), 20);
}

#[tokio::test]
async fn sends_only_the_api_key_when_no_secret_is_configured() {
    let (t, calls) = mock(|_, _| accepted(1));
    let u = Unsent::builder()
        .no_env()
        .base_url(BASE)
        .api_key(API_KEY)
        .transport(t)
        .build()
        .unwrap();
    u.send(basic()).await.unwrap();
    let req = calls.get(0);
    assert_eq!(req.header("X-API-Key"), Some(API_KEY));
    for h in ["X-Signature", "X-Nonce", "X-Timestamp"] {
        assert!(!req.has(h), "{h}");
    }
}

#[tokio::test]
async fn parses_named_senders() {
    let (u, calls) = client(|_, _| accepted(1));
    u.send(basic().from("Acme Support <help@acme.co>"))
        .await
        .unwrap();
    u.send(basic().from(Address::with_name("help@acme.co", "Acme")))
        .await
        .unwrap();
    u.send(basic().from("\"Doe, Jane\" <j@acme.co>"))
        .await
        .unwrap();
    u.send(basic().from(("tuple@acme.co", "Tuple")))
        .await
        .unwrap();
    assert_eq!(
        calls.get(0).json()["from"],
        json!({"email": "help@acme.co", "name": "Acme Support"})
    );
    assert_eq!(
        calls.get(1).json()["from"],
        json!({"email": "help@acme.co", "name": "Acme"})
    );
    assert_eq!(
        calls.get(2).json()["from"],
        json!({"email": "j@acme.co", "name": "Doe, Jane"})
    );
    assert_eq!(
        calls.get(3).json()["from"],
        json!({"email": "tuple@acme.co", "name": "Tuple"})
    );
}

#[tokio::test]
async fn applies_default_from_and_provider_with_per_call_overrides() {
    let (b, calls) = builder(|_, _| accepted(1));
    let u = b
        .default_from("default@x.co")
        .default_provider_id("prov-a")
        .build()
        .unwrap();
    u.send(basic()).await.unwrap();
    u.send(basic().from("other@x.co").provider_id("prov-b"))
        .await
        .unwrap();
    assert_eq!(
        calls.get(0).json()["from"],
        json!({"email": "default@x.co"})
    );
    assert_eq!(calls.get(0).json()["provider_id"], "prov-a");
    assert_eq!(calls.get(1).json()["from"], json!({"email": "other@x.co"}));
    assert_eq!(calls.get(1).json()["provider_id"], "prov-b");
}

#[tokio::test]
async fn derives_an_escaped_html_body_from_text_only_sends() {
    let (u, calls) = client(|_, _| accepted(1));
    u.send(
        SendEmail::builder()
            .to("a@b.co")
            .subject("s")
            .text("Line 1\n<b>& \"x\" 'y'</b>"),
    )
    .await
    .unwrap();
    let body = calls.get(0).json();
    assert_eq!(body["text"], "Line 1\n<b>& \"x\" 'y'</b>");
    assert_eq!(
        body["html"],
        "<div style=\"white-space:pre-wrap\">Line 1\n&lt;b&gt;&amp; &quot;x&quot; &#39;y&#39;&lt;/b&gt;</div>"
    );
    // a blank html alongside real text still derives
    u.send(
        SendEmail::builder()
            .to("a@b.co")
            .subject("s")
            .html("  ")
            .text("hi"),
    )
    .await
    .unwrap();
    assert_eq!(
        calls.get(1).json()["html"],
        "<div style=\"white-space:pre-wrap\">hi</div>"
    );
    // html only: no text field
    u.send(basic()).await.unwrap();
    assert!(calls.get(2).json().get("text").is_none());
}

#[tokio::test]
async fn accepts_lists_cc_bcc_and_omits_empty_optional_fields() {
    let (u, calls) = client(|_, _| accepted(1));
    u.send(
        SendEmail::builder()
            .to_all(["a@b.co", " c@d.co "])
            .cc("e@f.co")
            .bcc_all(Vec::<String>::new())
            .subject("s")
            .html("h"),
    )
    .await
    .unwrap();
    let body = calls.get(0).json();
    assert_eq!(body["to"], json!(["a@b.co", "c@d.co"]));
    assert_eq!(body["cc"], json!(["e@f.co"]));
    for k in ["bcc", "attachments", "from", "provider_id", "text"] {
        assert!(body.get(k).is_none(), "{k}");
    }
    assert!(
        body.as_object().unwrap().values().all(|v| !v.is_null()),
        "no null fields"
    );
}

#[tokio::test]
async fn encodes_attachments_from_every_supported_source() {
    let (u, calls) = client(|_, _| accepted(1));
    let dir = std::env::temp_dir().join(format!("unsent-sdk-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("report.csv");
    std::fs::write(&path, "a,b\n1,2\n").unwrap();
    u.send(
        basic().attachments([
            Attachment::from_bytes("a.txt", "hello").content_type("text/plain"),
            Attachment::from_bytes("b.bin", [0u8, 255, 16])
                .content_type("application/octet-stream"),
            Attachment::from_base64("c.txt", "aGVsbG8=\n"),
            Attachment::from_base64("w.txt", "aGVs\r\n bG8="),
            Attachment::from_bytes("e.bin", vec![7u8; 100_000]),
            Attachment::from_path(&path).unwrap(),
            Attachment::from_path(&path)
                .unwrap()
                .filename("renamed.csv")
                .content_type("text/x-custom"),
        ]),
    )
    .await
    .unwrap();
    let a = calls.get(0).json()["attachments"].clone();
    assert_eq!(
        a[0],
        json!({"filename": "a.txt", "content": "aGVsbG8=", "mimeType": "text/plain"})
    );
    assert_eq!(a[1]["content"], "AP8Q");
    assert_eq!(a[2], json!({"filename": "c.txt", "content": "aGVsbG8="}));
    assert_eq!(a[3]["content"], "aGVsbG8=");
    assert_eq!(a[4]["content"].as_str().unwrap().len(), 133_336);
    assert_eq!(
        a[5],
        json!({"filename": "report.csv", "content": "YSxiCjEsMgo=", "mimeType": "text/csv"})
    );
    assert_eq!(
        a[6],
        json!({"filename": "renamed.csv", "content": "YSxiCjEsMgo=", "mimeType": "text/x-custom"})
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn from_path_reports_unreadable_files_as_validation_errors() {
    let e = Attachment::from_path("/definitely/not/here.pdf").unwrap_err();
    assert!(matches!(e, Error::Validation(_)));
    assert_eq!(e.code(), "attachment_read_error");
    assert!(std::error::Error::source(&e).is_some());
}

#[tokio::test]
async fn maps_the_response_including_replays() {
    let (u, _) = client(|_, _| {
        json_resp_h(
            json!({"success": true, "id": 9, "status": "sent", "idempotency_key": "k-1", "idempotent_replay": true, "message": "m", "targetProvider": "SES"}),
            200,
            &[("Idempotent-Replayed", "true")],
        )
    });
    let r = u.send(basic().idempotency_key("k-1")).await.unwrap();
    assert_eq!(
        r,
        unsent::SendResult {
            id: 9,
            status: unsent::EmailStatus::Sent,
            idempotency_key: Some("k-1".into()),
            idempotent_replay: true,
            target_provider: "SES".into(),
            message: "m".into()
        }
    );
    // replay detected from the header alone
    let (u, _) =
        client(|_, _| json_resp_h(json!({"id": 3}), 200, &[("idempotent-replayed", "true")]));
    assert!(u.send(basic()).await.unwrap().idempotent_replay);
}

#[tokio::test]
async fn a_success_reply_without_an_email_id_is_an_invalid_response() {
    for body in [
        json!({}),
        json!({"id": null}),
        json!({"id": "x"}),
        json!({"id": -3}),
        json!({"id": 0}),
        json!([1]),
        json!(null),
    ] {
        let b2 = body.clone();
        let (u, _) = client(move |_, _| json_resp(b2.clone(), 202));
        let e = u.send(basic()).await.unwrap_err();
        assert_eq!(e.code(), "invalid_response", "{body}");
    }
}

#[tokio::test]
async fn generates_a_uuid_key_per_call_covered_by_the_signed_body() {
    let (u, calls) = client(|_, _| accepted(1));
    let r1 = u.send(basic()).await.unwrap();
    let r2 = u.send(basic()).await.unwrap();
    let k1 = calls.get(0).json()["idempotency_key"]
        .as_str()
        .unwrap()
        .to_owned();
    let k2 = calls.get(1).json()["idempotency_key"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(k1.len(), 36);
    assert!(k1.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    assert_eq!(k1.as_bytes()[14], b'4', "UUID version 4");
    assert_ne!(k1, k2);
    assert_eq!(r1.idempotency_key.as_deref(), Some(k1.as_str()));
    assert_eq!(r2.idempotency_key.as_deref(), Some(k2.as_str()));
}

#[tokio::test]
async fn uses_a_caller_supplied_key_and_trims_it() {
    let (u, calls) = client(|_, _| accepted(1));
    u.send(basic().idempotency_key(" order-123:receipt "))
        .await
        .unwrap();
    assert_eq!(calls.get(0).json()["idempotency_key"], "order-123:receipt");
}

#[tokio::test]
async fn omits_the_key_when_disabled() {
    let (u, calls) = client(|_, _| accepted(1));
    let res = u.send(basic().no_idempotency()).await.unwrap();
    assert!(calls.get(0).json().get("idempotency_key").is_none());
    assert_eq!(res.idempotency_key, None);
}

#[tokio::test]
async fn rejects_invalid_keys_before_any_request() {
    let long = "x".repeat(256);
    for key in [
        "",
        "  ",
        "has space",
        "tab\there",
        "ünï",
        long.as_str(),
        "new\nline",
        "a\u{7f}b",
    ] {
        let (u, calls) = client(|_, _| accepted(1));
        let e = u.send(basic().idempotency_key(key)).await.unwrap_err();
        assert!(matches!(e, Error::Validation(_)));
        assert_eq!(e.code(), "invalid_idempotency_key", "{key:?}");
        assert_eq!(calls.len(), 0);
    }
    let (u, _) = client(|_, _| accepted(1));
    u.send(basic().idempotency_key("x".repeat(255)))
        .await
        .unwrap();
    u.send(basic().idempotency_key("!~")).await.unwrap();
}

fn big(n: usize) -> String {
    "x".repeat(n)
}

#[tokio::test]
async fn validation_errors_are_raised_before_any_network_io() {
    let ok = || SendEmail::builder().to("a@b.co").subject("s").html("h");
    let many = |n: usize| (0..n).map(|i| format!("u{i}@x.co")).collect::<Vec<_>>();
    let att = |n: usize| {
        (0..n)
            .map(|_| Attachment::from_base64("a", "QQ=="))
            .collect::<Vec<_>>()
    };
    let cases: Vec<(&str, SendEmail, &str)> = vec![
        (
            "missing to",
            SendEmail::builder().subject("s").html("h"),
            "\"to\" is required",
        ),
        (
            "empty to list",
            SendEmail::builder()
                .to_all(Vec::<String>::new())
                .subject("s")
                .html("h"),
            "at least one",
        ),
        (
            "blank to",
            SendEmail::builder().to("  ").subject("s").html("h"),
            "at least one",
        ),
        (
            "address without @",
            SendEmail::builder().to("nope").subject("s").html("h"),
            "invalid address",
        ),
        (
            "CRLF in address",
            SendEmail::builder()
                .to("a@b.co\r\nBcc: x@y.z")
                .subject("s")
                .html("h"),
            "line break",
        ),
        ("NUL in cc", ok().cc("a@b.co\0"), "line break"),
        ("LF in bcc", ok().bcc("a@b\n.co"), "line break"),
        (
            "101 recipients",
            SendEmail::builder()
                .to_all(many(101))
                .subject("s")
                .html("h"),
            "maximum 100",
        ),
        ("101 cc", ok().cc_all(many(101)), "maximum 100"),
        (
            "missing subject",
            SendEmail::builder().to("a@b.co").html("h"),
            "\"subject\" is required",
        ),
        (
            "blank subject",
            SendEmail::builder().to("a@b.co").subject("   ").html("h"),
            "\"subject\" is required",
        ),
        (
            "huge subject",
            SendEmail::builder()
                .to("a@b.co")
                .subject(big(1001))
                .html("h"),
            "maximum 1000",
        ),
        (
            "no body",
            SendEmail::builder().to("a@b.co").subject("s"),
            "\"html\", \"text\"",
        ),
        (
            "blank bodies",
            SendEmail::builder()
                .to("a@b.co")
                .subject("s")
                .html(" ")
                .text(" "),
            "\"html\", \"text\"",
        ),
        ("21 attachments", ok().attachments(att(21)), "maximum 20"),
        (
            "attachment without filename",
            ok().attachment(Attachment::from_base64("", "QQ==")),
            "filename is required",
        ),
        (
            "attachment filename of only CRLF",
            ok().attachment(Attachment::from_base64("\r\n\0", "QQ==")),
            "filename is required",
        ),
        (
            "long filename",
            ok().attachment(Attachment::from_base64(big(256), "QQ==")),
            "exceeds 255",
        ),
        (
            "attachment with plain text content",
            ok().attachment(Attachment::from_base64("a.txt", "hello world")),
            "valid base64",
        ),
        (
            "attachment with unpadded base64",
            ok().attachment(Attachment::from_base64("a.txt", "QQ")),
            "valid base64",
        ),
        (
            "attachment with empty base64",
            ok().attachment(Attachment::from_base64("a.txt", " \n ")),
            "valid base64",
        ),
        (
            "empty attachment bytes",
            ok().attachment(Attachment::from_bytes("a", Vec::new())),
            "empty",
        ),
        ("blank from", ok().from(""), "from"),
        (
            "CRLF in from",
            ok().from("a@b.co\r\nBcc: x@y.z"),
            "line break",
        ),
        (
            "CRLF in from name",
            ok().from(Address::with_name("a@b.co", "Evil\r\nBcc: x")),
            "line break",
        ),
        ("blank provider id", ok().provider_id(" "), "provider_id"),
        (
            "long provider id",
            ok().provider_id(big(256)),
            "provider_id",
        ),
        (
            "zero timeout",
            ok().timeout(std::time::Duration::ZERO),
            "timeout",
        ),
        ("11 retries", ok().max_retries(11), "max_retries"),
    ];
    for (name, email, needle) in cases {
        let (u, calls) = client(|_, _| accepted(1));
        let err = u.send(email).await.expect_err(name);
        assert!(matches!(err, Error::Validation(_)), "{name}: {err:?}");
        assert_eq!(err.code(), "validation_error", "{name}");
        assert!(err.message().contains(needle), "{name}: {err}");
        assert_eq!(calls.len(), 0, "{name}: nothing may be sent");
    }
}

#[tokio::test]
async fn rejects_a_message_over_3_mib_before_sending() {
    let (u, calls) = client(|_, _| accepted(1));
    let e = u
        .send(basic().attachment(Attachment::from_bytes("big.bin", vec![1u8; 2_400_000])))
        .await
        .unwrap_err();
    assert!(matches!(e, Error::Validation(_)));
    assert_eq!(e.code(), "payload_too_large");
    // enormous input is refused without encoding it
    let e = u
        .send(basic().attachment(Attachment::from_bytes("huge.bin", vec![0u8; 40_000_000])))
        .await
        .unwrap_err();
    assert_eq!(e.code(), "payload_too_large");
    // a huge body
    let e = u
        .send(
            SendEmail::builder()
                .to("a@b.co")
                .subject("s")
                .html(big(3 * 1024 * 1024 + 1)),
        )
        .await
        .unwrap_err();
    assert_eq!(e.code(), "payload_too_large");
    // just under the limit goes through
    u.send(
        SendEmail::builder()
            .to("a@b.co")
            .subject("s")
            .html(big(3 * 1024 * 1024 - 1000)),
    )
    .await
    .unwrap();
    assert_eq!(calls.len(), 1);
}

#[tokio::test]
async fn subject_length_counts_utf16_units_like_the_server() {
    let (u, calls) = client(|_, _| accepted(1));
    // 500 emoji = 1000 UTF-16 units: allowed; 501 = 1002: rejected
    u.send(
        SendEmail::builder()
            .to("a@b.co")
            .subject("🎉".repeat(500))
            .html("h"),
    )
    .await
    .unwrap();
    let e = u
        .send(
            SendEmail::builder()
                .to("a@b.co")
                .subject("🎉".repeat(501))
                .html("h"),
        )
        .await
        .unwrap_err();
    assert!(e.message().contains("1002"), "{e}");
    assert_eq!(calls.len(), 1);
}

#[tokio::test]
async fn from_json_accepts_a_full_message_and_rejects_wrong_types() {
    let (u, calls) = client(|_, _| accepted(1));
    let v = json!({
        "to": ["a@b.co", "c@d.co"], "cc": "e@f.co", "subject": "Hi", "text": "hello",
        "from": {"email": "me@x.co", "name": "Me"}, "provider_id": "p", "idempotency_key": "k-1",
        "attachments": [{"filename": "a.txt", "content": "aGVsbG8=", "content_type": "text/plain"}]
    });
    u.send(SendEmail::from_json(&v).unwrap()).await.unwrap();
    let body = calls.get(0).json();
    assert_eq!(body["to"], json!(["a@b.co", "c@d.co"]));
    assert_eq!(body["from"], json!({"email": "me@x.co", "name": "Me"}));
    assert_eq!(body["attachments"][0]["mimeType"], "text/plain");
    assert_eq!(body["idempotency_key"], "k-1");

    let bad: Vec<Value> = vec![
        json!(null),
        json!(5),
        json!("str"),
        json!([]),
        json!({"to": 5}),
        json!({"to": [1]}),
        json!({"to": {"a": 1}}),
        json!({"to": "a@b.co", "subject": 5}),
        json!({"to": "a@b.co", "subject": "s", "html": 5}),
        json!({"to": "a@b.co", "subject": "s", "text": ["x"]}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "attachments": {}}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "attachments": [1]}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "attachments": [{"filename": "a", "content": 42}]}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "from": 5}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "from": {"name": "x"}}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "idempotency_key": 5}),
        json!({"to": "a@b.co", "subject": "s", "html": "h", "provider_id": 5}),
    ];
    for v in bad {
        let r = match SendEmail::from_json(&v) {
            Ok(e) => u.send(e).await,
            Err(e) => Err(e),
        };
        let e = r.expect_err(&v.to_string());
        assert!(matches!(e, Error::Validation(_)), "{v}: {e:?}");
    }
    assert_eq!(calls.len(), 1, "nothing was sent for invalid input");
}
