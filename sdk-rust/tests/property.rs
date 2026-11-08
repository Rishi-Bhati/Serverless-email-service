//! Property tests with a seeded RNG: invariants that must hold for every input, checked against independent
//! reference models written in the tests themselves.

mod common;

use common::*;
use serde_json::{json, Value};
use unsent::{Address, Attachment, Error, ListEmails, SendEmail};

const SEEDS: [u64; 3] = [1, 0xfeed, 0x0bad_cafe];

// ---- independent reference implementations --------------------------------------------------------------

fn b64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.trim_end_matches('=').bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32;
        buf = buf << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

fn model_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn model_unescape(s: &str) -> String {
    s.replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .replace("&amp;", "&")
}

fn model_recipient_ok(list: &[String]) -> bool {
    let cleaned: Vec<&str> = list
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    !cleaned.is_empty()
        && cleaned.len() <= 100
        && cleaned
            .iter()
            .all(|a| a.contains('@') && !a.contains(['\r', '\n', '\0']))
}

fn model_key_ok(k: &str) -> bool {
    let k = k.trim();
    (1..=255).contains(&k.len()) && k.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

fn plain_word(r: &mut Rng) -> String {
    (0..r.range(1, 12))
        .map(|_| *r.pick(&['a', 'b', 'z', 'Q', '7', '-', '.', 'é', '日']))
        .collect()
}

// ---- properties ------------------------------------------------------------------------------------------

#[tokio::test]
async fn every_request_verifies_under_an_independent_hmac_for_random_messages() {
    let (u, calls) = client(|_, _| accepted(1));
    let mut used = std::collections::HashSet::new();
    for seed in SEEDS {
        let mut r = Rng::new(seed);
        for _ in 0..400 {
            let subject = format!("S{}", r.junk_string().chars().take(200).collect::<String>());
            let html = format!("<p>{}</p>", r.junk_string());
            let text = format!("t{}", r.junk_string());
            u.send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject(subject.clone())
                    .html(html.clone())
                    .text(text.clone()),
            )
            .await
            .unwrap();
            let req = calls.get(calls.len() - 1);
            assert_eq!(
                verify_signed(&req, API_SECRET, Some(&mut used)),
                Verdict::Ok
            );
            let body = req.json();
            assert_eq!(
                (
                    body["subject"].as_str().unwrap(),
                    body["html"].as_str().unwrap(),
                    body["text"].as_str().unwrap()
                ),
                (subject.as_str(), html.as_str(), text.as_str())
            );
        }
    }
    assert_eq!(used.len(), 1200, "all nonces unique");
}

#[tokio::test]
async fn attachments_round_trip_through_an_independent_base64() {
    let (u, calls) = client(|_, _| accepted(1));
    for seed in SEEDS {
        let mut r = Rng::new(seed);
        for _ in 0..150 {
            let n = r.range(1, 5000) as usize;
            let bytes = r.bytes(n);
            u.send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("s")
                    .html("h")
                    .attachment(Attachment::from_bytes("f.bin", bytes.clone())),
            )
            .await
            .unwrap();
            let sent = calls.get(calls.len() - 1).json()["attachments"][0]["content"]
                .as_str()
                .unwrap()
                .to_owned();
            assert_eq!(sent, b64_encode(&bytes));
            assert_eq!(b64_decode(&sent).unwrap(), bytes);
            // the same data supplied as (possibly line-wrapped) base64 is passed through unchanged
            let wrapped: String = sent
                .as_bytes()
                .chunks(76)
                .map(|c| std::str::from_utf8(c).unwrap())
                .collect::<Vec<_>>()
                .join("\r\n");
            u.send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("s")
                    .html("h")
                    .attachment(Attachment::from_base64("g", wrapped)),
            )
            .await
            .unwrap();
            assert_eq!(
                calls.get(calls.len() - 1).json()["attachments"][0]["content"],
                sent.as_str()
            );
        }
    }
}

#[test]
fn named_addresses_round_trip() {
    for seed in SEEDS {
        let mut r = Rng::new(seed);
        for _ in 0..3000 {
            let name = (0..r.range(1, 4))
                .map(|_| plain_word(&mut r))
                .collect::<Vec<_>>()
                .join(*r.pick(&[" ", ", ", "  "]));
            let email = format!(
                "{}@{}.co",
                plain_word(&mut r).replace(['é', '日'], "x"),
                plain_word(&mut r).replace(['é', '日'], "y")
            );
            let forms = [
                (format!("{name} <{email}>"), Some(name.trim().to_owned())),
                (
                    format!("\"{name}\" <{email}>"),
                    Some(name.trim().to_owned()),
                ),
                (
                    format!("  {name}   <  {email}  >  "),
                    Some(name.trim().to_owned()),
                ),
                (format!("<{email}>"), None),
                (email.clone(), None),
                (format!("  {email}\t"), None),
            ];
            for (input, want_name) in forms {
                let a = Address::parse(&input);
                assert_eq!(a.email, email, "{input:?}");
                assert_eq!(a.name, want_name, "{input:?}");
            }
        }
    }
}

#[test]
fn address_parsing_is_total_and_idempotent_on_the_email_part() {
    let mut r = Rng::new(5);
    for _ in 0..20_000 {
        let s = r.junk_string();
        let a = Address::parse(&s);
        assert_eq!(a.email, a.email.trim());
        if let Some(name) = &a.name {
            // a parsed form always came from `name <email>`, and re-parsing the bare email changes nothing
            assert_eq!(Address::parse(&a.email).email, a.email);
            assert!(!name.is_empty());
        }
    }
}

#[tokio::test]
async fn recipient_validation_matches_the_reference_model() {
    let (u, calls) = client(|_, _| accepted(1));
    let mut accepted_n = 0;
    for seed in SEEDS {
        let mut r = Rng::new(seed);
        for _ in 0..1200 {
            let n = if r.chance(30) {
                r.range(95, 105)
            } else {
                r.range(0, 5)
            } as usize;
            let list: Vec<String> = (0..n)
                .map(|_| match r.below(8) {
                    0 => " ".to_owned(),
                    1 => "no-at-sign".to_owned(),
                    2 => format!("x{}@y.co\n", r.below(5)),
                    3 => format!("  a{}@b.co ", r.below(5)),
                    4 => "a@b.co\0".to_owned(),
                    _ => format!("u{}@x.co", r.below(1000)),
                })
                .collect();
            let want = model_recipient_ok(&list);
            let before = calls.len();
            let res = u
                .send(
                    SendEmail::builder()
                        .to_all(list.clone())
                        .subject("s")
                        .html("h"),
                )
                .await;
            // note: trailing "\n" is trimmed as whitespace before the line-break check, exactly like the reference
            match (want, &res) {
                (true, Ok(_)) => {
                    accepted_n += 1;
                    let sent = calls.get(calls.len() - 1).json();
                    let cleaned: Vec<&str> = list
                        .iter()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .collect();
                    assert_eq!(sent["to"], json!(cleaned));
                }
                (false, Err(Error::Validation(_))) => assert_eq!(calls.len(), before),
                other => panic!("model says {want} but got {:?} for {list:?}", other.1),
            }
        }
    }
    assert!(accepted_n > 100);
}

#[tokio::test]
async fn idempotency_key_validation_matches_the_reference_model() {
    let (u, _) = client(|_, _| accepted(1));
    let mut r = Rng::new(11);
    for _ in 0..4000 {
        let key = match r.below(4) {
            0 => r.junk_string(),
            1 => (0..r.range(0, 300))
                .map(|_| char::from(r.range(0x1f, 0x80) as u8))
                .collect(),
            2 => format!(
                " {} ",
                (0..r.range(1, 20))
                    .map(|_| char::from(r.range(0x21, 0x7e) as u8))
                    .collect::<String>()
            ),
            _ => "x".repeat(r.range(250, 260) as usize),
        };
        let res = u
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("s")
                    .html("h")
                    .idempotency_key(key.clone()),
            )
            .await;
        if model_key_ok(&key) {
            let r = res.unwrap_or_else(|e| panic!("{key:?}: {e}"));
            assert_eq!(r.id, 1);
        } else {
            assert_eq!(
                res.unwrap_err().code(),
                "invalid_idempotency_key",
                "{key:?}"
            );
        }
    }
}

#[tokio::test]
async fn text_to_html_derivation_is_exact_and_reversible() {
    let (u, calls) = client(|_, _| accepted(1));
    let mut r = Rng::new(21);
    for _ in 0..1500 {
        let text = format!("x{}", r.junk_string());
        u.send(
            SendEmail::builder()
                .to("a@b.co")
                .subject("s")
                .text(text.clone()),
        )
        .await
        .unwrap();
        let html = calls.get(calls.len() - 1).json()["html"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            html,
            format!(
                "<div style=\"white-space:pre-wrap\">{}</div>",
                model_escape(&text)
            )
        );
        let inner = html
            .strip_prefix("<div style=\"white-space:pre-wrap\">")
            .unwrap()
            .strip_suffix("</div>")
            .unwrap();
        assert!(
            !inner.contains(['<', '>', '"', '\'']),
            "unescaped markup in {inner:?}"
        );
        assert_eq!(model_unescape(inner), text);
    }
}

#[tokio::test]
async fn subject_and_filename_limits_count_utf16_units() {
    let (u, _) = client(|_, _| accepted(1));
    let mut r = Rng::new(31);
    for _ in 0..300 {
        let unit = *r.pick(&["a", "é", "日", "🎉", "𝔘"]);
        let n = r.range(1, 700) as usize;
        let subject = unit.repeat(n);
        let units = subject.encode_utf16().count();
        let res = u
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject(subject.clone())
                    .html("h"),
            )
            .await;
        assert_eq!(res.is_ok(), units <= 1000, "{units} units");
        let res = u
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("s")
                    .html("h")
                    .attachment(Attachment::from_base64(subject, "QQ==")),
            )
            .await;
        assert_eq!(res.is_ok(), units <= 255, "{units} units (filename)");
    }
}

#[tokio::test]
async fn iterate_visits_every_row_exactly_once_for_any_page_size() {
    let mut r = Rng::new(41);
    for _ in 0..120 {
        let total = r.range(0, 60) as usize;
        let limit = r.range(1, 25) as u32;
        let (u, calls) = client(move |req, _| {
            let q = req.query();
            let off: usize = q.get("offset").and_then(|v| v.parse().ok()).unwrap_or(0);
            let lim: usize = q.get("limit").and_then(|v| v.parse().ok()).unwrap_or(100);
            let rows: Vec<Value> = (off..(off + lim).min(total))
                .map(|i| json!({"id": i + 1, "status": "sent"}))
                .collect();
            json_resp(
                json!({"emails": rows, "total": total, "limit": lim, "offset": off}),
                200,
            )
        });
        let mut it = u.emails().iterate(ListEmails::new().limit(limit));
        let mut ids = Vec::new();
        while let Some(e) = it.next().await {
            ids.push(e.unwrap().id);
        }
        assert_eq!(
            ids,
            (1..=total as i64).collect::<Vec<_>>(),
            "total {total} limit {limit}"
        );
        let pages = total.div_ceil(limit as usize).max(1);
        assert_eq!(calls.len(), pages, "total {total} limit {limit}");
    }
}

#[tokio::test]
async fn the_wire_body_never_contains_nulls_and_always_parses() {
    let (u, calls) = client(|_, _| accepted(1));
    let mut r = Rng::new(51);
    for _ in 0..1500 {
        let mut e = SendEmail::builder()
            .to(format!("a{}@b.co", r.below(9)))
            .subject(format!("s{}", r.below(9)))
            .html("<p>x</p>");
        if r.chance(2) {
            e = e.cc(format!("c{}@b.co", r.below(9)));
        }
        if r.chance(2) {
            e = e.text(r.junk_string() + "t");
        }
        if r.chance(2) {
            e = e.from(Address::with_name("f@x.co", plain_word(&mut r)));
        }
        if r.chance(2) {
            e = e.provider_id(plain_word(&mut r));
        }
        u.send(e).await.unwrap();
        let body = calls.get(calls.len() - 1).json();
        assert!(body.as_object().unwrap().values().all(|v| !v.is_null()));
        let allowed = [
            "to",
            "cc",
            "bcc",
            "subject",
            "html",
            "text",
            "attachments",
            "from",
            "provider_id",
            "idempotency_key",
        ];
        assert!(body
            .as_object()
            .unwrap()
            .keys()
            .all(|k| allowed.contains(&k.as_str())));
    }
}
