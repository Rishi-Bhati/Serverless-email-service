//! Fuzz / hostile-input tests (SPEC section 7.2). Thousands of seeded-random junk values go into every public
//! method; the only acceptable outcomes are a normal result or one of the SDK's own errors. Hostile servers
//! (garbage bodies, wrong types, odd statuses and headers) must neither crash nor hang the client.

mod common;

use std::time::{Duration, UNIX_EPOCH};

use common::*;
use serde_json::{json, Value};
use unsent::{
    Address, Attachment, EmailStatus, Error, ListEmails, SendEmail, Sort, Unsent, WaitOptions,
};

const SEEDS: [u64; 4] = [0x5eed_0001, 0x5eed_0002, 0xdead_beef, 42];

fn valid_addr(r: &mut Rng) -> String {
    format!("user{}@example{}.com", r.below(1000), r.below(10))
}

fn junk_or_valid_list(r: &mut Rng) -> Vec<String> {
    (0..r.below(5))
        .map(|_| {
            if r.chance(2) {
                valid_addr(r)
            } else {
                r.junk_string()
            }
        })
        .collect()
}

fn random_email(r: &mut Rng) -> SendEmail {
    let mut e = SendEmail::builder();
    let good = r.chance(3);
    if good || r.chance(2) {
        e = e.to_all((0..=r.below(3)).map(|_| valid_addr(r)));
    } else if r.chance(2) {
        e = e.to_all(junk_or_valid_list(r));
    }
    if r.chance(3) {
        e = e.cc_all(junk_or_valid_list(r));
    }
    if r.chance(3) {
        e = e.bcc_all(junk_or_valid_list(r));
    }
    if good || r.chance(2) {
        e = e.subject(if r.chance(4) {
            r.junk_string()
        } else {
            format!("Subject {}", r.below(100))
        });
    } else if r.chance(2) {
        e = e.subject(r.junk_string());
    }
    if r.chance(2) {
        e = e.html(if good {
            "<p>hi</p>".to_owned()
        } else {
            r.junk_string()
        });
    }
    if r.chance(2) || good {
        e = e.text(if good {
            "hello".to_owned()
        } else {
            r.junk_string()
        });
    }
    if r.chance(3) {
        e = match r.below(4) {
            0 => e.from(r.junk_string()),
            1 => e.from(Address::with_name(valid_addr(r), r.junk_string())),
            2 => e.from(format!("{} <{}>", r.junk_string(), valid_addr(r))),
            _ => e.from(Address {
                email: r.junk_string(),
                name: Some(r.junk_string()),
            }),
        };
    }
    if r.chance(4) {
        e = e.provider_id(r.junk_string());
    }
    match r.below(6) {
        0 => e = e.idempotency_key(r.junk_string()),
        1 => e = e.no_idempotency(),
        2 => e = e.idempotency_key(format!("key-{}", r.below(1000))),
        _ => {}
    }
    for _ in 0..r.below(4) {
        let name = if r.chance(3) {
            r.junk_string()
        } else {
            format!("file{}.bin", r.below(10))
        };
        let att = match r.below(3) {
            0 => {
                let n = r.below(3000) as usize;
                Attachment::from_bytes(name, r.bytes(n))
            }
            1 => Attachment::from_base64(name, r.junk_string()),
            _ => Attachment::from_base64(name, "QUJD"),
        };
        e = e.attachment(if r.chance(3) {
            att.content_type(r.junk_string())
        } else {
            att
        });
    }
    if r.chance(10) {
        e = e.timeout(Duration::from_nanos(r.below(3)));
    }
    if r.chance(10) {
        e = e.max_retries(r.below(30) as u32);
    }
    e
}

/// A reply drawn from everything a broken deployment, proxy or attacker might send.
fn hostile_reply(r: &mut Rng, path: &str) -> Reply {
    let statuses = [
        0u16, 99, 100, 200, 200, 200, 201, 202, 202, 204, 206, 299, 300, 301, 304, 307, 308, 399,
        400, 401, 401, 403, 404, 409, 413, 418, 429, 500, 501, 502, 503, 504, 505, 599, 600, 999,
        65535,
    ];
    let status = *r.pick(&statuses);
    let mut headers: Vec<(String, String)> = Vec::new();
    for _ in 0..r.below(4) {
        let name = *r.pick(&[
            "Retry-After",
            "Date",
            "Location",
            "Content-Type",
            "Idempotent-Replayed",
            "X-Junk",
        ]);
        let value = match r.below(6) {
            0 => r.junk_string(),
            1 => "99999999999999999999".to_owned(),
            2 => "-1".to_owned(),
            3 => http_date(now_ms() + r.range(-100_000_000, 100_000_000)),
            4 => "true".to_owned(),
            _ => r.below(100).to_string(),
        };
        headers.push((name.to_owned(), value));
    }
    let body: Vec<u8> = match r.below(10) {
        0 => Vec::new(),
        1 => {
            let n = r.below(500) as usize;
            r.bytes(n)
        }
        2 => r.junk_json(4).to_string().into_bytes(),
        3 => r.junk_string().into_bytes(),
        4 => "[".repeat(r.range(100, 5000) as usize).into_bytes(),
        5 => br#"{"__proto__":{"x":1},"constructor":"y","id":"7","status":{"a":1},"emails":[{"__proto__":1}]}"#.to_vec(),
        6 => format!("{{\"error\":{:?},\"code\":{:?},\"reason\":{:?},\"id\":{}}}", r.junk_string(), r.junk_string(), r.junk_string(), r.next_u64() as i64).into_bytes(),
        _ => valid_shaped(r, path).to_string().into_bytes(),
    };
    match r.below(40) {
        0 => {
            return Reply::Error(unsent::TransportError::new(
                *r.pick(&[
                    unsent::TransportErrorKind::Request,
                    unsent::TransportErrorKind::Body,
                    unsent::TransportErrorKind::BodyTooLarge,
                    unsent::TransportErrorKind::Redirected,
                ]),
                r.junk_string(),
            ))
        }
        1 => return Reply::Hang,
        _ => {}
    }
    Reply::Response(unsent::TransportResponse::new(status, headers, body))
}

/// A plausible response for the endpoint with random fields replaced by junk.
fn valid_shaped(r: &mut Rng, path: &str) -> Value {
    let email = || {
        json!({
            "id": 3, "subject": "s", "body": "<p>x</p>", "html_body": "<p>x</p>", "text_body": "x", "status": "sent", "attempts": 1,
            "to": ["a@b.co"], "cc": null, "bcc": ["c@d.co"], "from_email": "m@x.co", "from_name": "M", "provider_id": null,
            "provider_used": "SES", "failover_history": "[{\"provider\":\"p\",\"type\":\"t\",\"error\":\"e\",\"timestamp\":5}]",
            "idempotency_key": "k", "error": null, "created_at": 1780000000000i64, "updated_at": 1780000005000i64,
            "attachments": [{"filename": "a", "mimeType": "text/plain", "size": 5, "content": "aGVsbG8="}]
        })
    };
    let mut v = if path.ends_with("/api/send") {
        json!({"success": true, "id": 9, "status": "queued", "idempotency_key": "k", "idempotent_replay": false, "message": "m", "targetProvider": "p"})
    } else if path.ends_with("/api/status") {
        json!({"queued": 1, "sending": 2, "sent": 3, "failed": 4})
    } else if path.ends_with("/api/health") {
        json!({"status": "ok", "runtime": "r", "d1": "bound", "timestamp": 1780000000000i64})
    } else if path.ends_with("/api/emails") {
        json!({"emails": [email(), email()], "total": 9, "limit": 2, "offset": 0})
    } else {
        json!({"email": email()})
    };
    // replace a few (possibly nested) fields with junk
    for _ in 0..r.below(4) {
        let junk = r.junk_json(2);
        if let Some(obj) = v.as_object_mut() {
            let keys: Vec<String> = obj.keys().cloned().collect();
            if keys.is_empty() {
                continue;
            }
            let k = r.pick(&keys).clone();
            if let Some(Value::Array(items)) = obj.get_mut(&k) {
                if let Some(Value::Object(inner)) = items.first_mut() {
                    let ik: Vec<String> = inner.keys().cloned().collect();
                    if !ik.is_empty() {
                        inner.insert(r.pick(&ik).clone(), junk);
                    }
                    continue;
                }
            }
            if let Some(Value::Object(inner)) = obj.get_mut(&k) {
                let ik: Vec<String> = inner.keys().cloned().collect();
                if !ik.is_empty() {
                    inner.insert(r.pick(&ik).clone(), junk);
                }
            } else {
                obj.insert(k, junk);
            }
        }
    }
    v
}

fn check_err(e: &Error) {
    assert!(!e.code().is_empty());
    let _ = format!(
        "{e} {e:?} {:?} {:?} {:?} {:?}",
        e.hint(),
        e.reason(),
        e.body(),
        e.status()
    );
    let _ = (e.is_retryable(), e.retry_after(), e.existing_email_id());
    assert!(!e.message().contains(API_SECRET));
}

#[tokio::test(start_paused = true)]
async fn junk_into_send_never_crashes() {
    let _w = Watchdog::start("junk_into_send", 240);
    let mut ok = 0;
    let mut rejected = 0;
    for seed in SEEDS {
        let mut r = Rng::new(seed);
        let (u, calls) = client(|_, _| accepted(1));
        for i in 0..1500 {
            let before = calls.len();
            match u.send(random_email(&mut r)).await {
                Ok(res) => {
                    ok += 1;
                    assert_eq!(res.id, 1);
                    // whatever went out is valid, correctly signed JSON
                    let req = calls.get(calls.len() - 1);
                    assert_eq!(
                        verify_signed(&req, API_SECRET, None),
                        Verdict::Ok,
                        "seed {seed} iteration {i}"
                    );
                    let body: Value = serde_json::from_str(&req.body).expect("valid JSON body");
                    assert!(body["to"].as_array().is_some_and(|a| !a.is_empty()));
                    assert!(body["subject"]
                        .as_str()
                        .is_some_and(|s| !s.trim().is_empty()));
                    assert!(body["html"].as_str().is_some_and(|s| !s.trim().is_empty()));
                    assert!(body.as_object().unwrap().values().all(|v| !v.is_null()));
                    for list in ["to", "cc", "bcc"] {
                        for a in body[list].as_array().into_iter().flatten() {
                            let a = a.as_str().unwrap();
                            assert!(
                                a.contains('@') && !a.contains(['\r', '\n', '\0']) && a == a.trim(),
                                "{a:?}"
                            );
                        }
                    }
                    for (k, v) in &req.headers {
                        assert!(!k.contains(['\r', '\n']) && !v.contains(['\r', '\n', '\0']));
                    }
                }
                Err(e) => {
                    rejected += 1;
                    check_err(&e);
                    assert!(
                        matches!(e, Error::Validation(_)),
                        "seed {seed} iteration {i}: {e:?}"
                    );
                    assert_eq!(calls.len(), before, "validation errors send nothing");
                }
            }
        }
    }
    assert!(
        ok > 300 && rejected > 300,
        "the generator should reach both paths (ok {ok}, rejected {rejected})"
    );
}

#[tokio::test(start_paused = true)]
async fn junk_json_into_from_json_never_crashes() {
    let _w = Watchdog::start("junk_json", 240);
    let mut built = 0;
    for seed in SEEDS {
        let mut r = Rng::new(seed ^ 0xabc);
        let (u, calls) = client(|_, _| accepted(1));
        for _ in 0..1500 {
            // fully random values, and objects with the right keys but wrong values
            let v = if r.chance(3) {
                r.junk_json(4)
            } else {
                let mut o = serde_json::Map::new();
                for k in [
                    "to",
                    "cc",
                    "bcc",
                    "subject",
                    "html",
                    "text",
                    "from",
                    "provider_id",
                    "providerId",
                    "idempotency_key",
                    "attachments",
                    "timeout",
                    "__proto__",
                ] {
                    if r.chance(2) {
                        o.insert(
                            k.to_owned(),
                            if r.chance(3) {
                                r.junk_json(3)
                            } else {
                                json!(valid_addr(&mut r))
                            },
                        );
                    }
                }
                Value::Object(o)
            };
            match SendEmail::from_json(&v) {
                Ok(e) => {
                    built += 1;
                    match u.send(e).await {
                        Ok(_) => {}
                        Err(e) => {
                            check_err(&e);
                            assert!(matches!(e, Error::Validation(_)), "{e:?}");
                        }
                    }
                }
                Err(e) => {
                    check_err(&e);
                    assert!(matches!(e, Error::Validation(_)));
                }
            }
        }
        for req in calls.all() {
            assert_eq!(verify_signed(&req, API_SECRET, None), Verdict::Ok);
        }
    }
    assert!(built > 100, "{built}");
}

#[tokio::test(start_paused = true)]
async fn junk_into_every_other_method_never_crashes() {
    let _w = Watchdog::start("junk_other_methods", 240);
    for seed in SEEDS {
        let mut r = Rng::new(seed ^ 0x77);
        let (u, calls) = client(|req, _| {
            json_resp(
                valid_shaped(&mut Rng::new(req.body.len() as u64 + 3), req.path()),
                200,
            )
        });
        for _ in 0..1200 {
            match r.below(7) {
                0 => {
                    let (x, y) = (r.next_u64() as i64, r.range(-5, 5));
                    let id = *r.pick(&[0i64, 1, -1, i64::MAX, i64::MIN, x, y]);
                    match u.emails().get(id).await {
                        Ok(_) => assert!(id >= 1),
                        Err(e) => check_err(&e),
                    }
                }
                1 => {
                    let mut q = ListEmails::new();
                    if r.chance(2) {
                        q = q.limit(r.next_u64() as u32 >> r.below(32));
                    }
                    if r.chance(2) {
                        q = q.offset(r.next_u64() >> r.below(64));
                    }
                    if r.chance(2) {
                        q = q.search(r.junk_string());
                    }
                    if r.chance(2) {
                        q = q.from(r.junk_string());
                    }
                    if r.chance(2) {
                        q = q
                            .to(UNIX_EPOCH
                                + Duration::from_secs(r.next_u64() >> r.range(1, 20) as u32));
                    }
                    if r.chance(3) {
                        q = q.status(*r.pick(&[
                            EmailStatus::Queued,
                            EmailStatus::Sending,
                            EmailStatus::Sent,
                            EmailStatus::Failed,
                        ]));
                    }
                    if r.chance(3) {
                        q = q.sort(*r.pick(&[
                            Sort::UpdatedAtDesc,
                            Sort::UpdatedAtAsc,
                            Sort::CreatedAtDesc,
                            Sort::CreatedAtAsc,
                            Sort::AttemptsDesc,
                        ]));
                    }
                    if let Err(e) = u.emails().list(q).await {
                        check_err(&e);
                    }
                }
                2 => drop(u.status().await),
                3 => drop(u.health().await),
                4 => {
                    let mut it = u
                        .emails()
                        .iterate(ListEmails::new().limit(r.range(1, 3) as u32));
                    for _ in 0..5 {
                        match it.next().await {
                            Some(Ok(_)) => {}
                            Some(Err(e)) => check_err(&e),
                            None => break,
                        }
                    }
                }
                5 => {
                    let opts = WaitOptions::new()
                        .timeout(Duration::from_millis(r.below(3000)))
                        .interval(Duration::from_millis(r.below(3000)));
                    let id = r.range(-2, 5);
                    if let Err(e) = u.emails().wait_with(id, opts).await {
                        check_err(&e);
                    }
                }
                _ => {
                    let opts = unsent::RequestOptions::new()
                        .timeout(Duration::from_millis(r.below(5)))
                        .max_retries(r.below(14) as u32);
                    let _ = u.status_with(&opts).await;
                    let _ = u.health_with(&opts).await;
                }
            }
        }
        assert!(calls.len() > 500);
    }
}

#[tokio::test(start_paused = true)]
async fn hostile_servers_never_crash_or_hang_any_method() {
    let _w = Watchdog::start("hostile_servers", 280);
    let mut errors = 0;
    let mut successes = 0;
    for seed in SEEDS {
        let mut r = Rng::new(seed ^ 0x1234_5678);
        let state = std::sync::Arc::new(std::sync::Mutex::new(Rng::new(seed)));
        let st = state.clone();
        let (u, calls) = client(move |req, _| hostile_reply(&mut st.lock().unwrap(), req.path()));
        for i in 0..800 {
            let virtual_start = tokio::time::Instant::now();
            let which = r.below(6);
            let res: Result<(), Error> = match which {
                0 => u.send(random_email(&mut r)).await.map(drop),
                1 => u
                    .send(SendEmail::builder().to("a@b.co").subject("s").text("t"))
                    .await
                    .map(drop),
                2 => u.emails().get(r.range(1, 100)).await.map(drop),
                3 => u
                    .emails()
                    .list(ListEmails::new().limit(r.range(1, 5) as u32))
                    .await
                    .map(drop),
                4 => u.status().await.map(drop).and(u.health().await.map(drop)),
                _ => u
                    .emails()
                    .wait_with(
                        3,
                        WaitOptions::new()
                            .timeout(Duration::from_secs(5))
                            .interval(Duration::from_millis(200)),
                    )
                    .await
                    .map(drop),
            };
            match res {
                Ok(()) => successes += 1,
                Err(e) => {
                    errors += 1;
                    check_err(&e);
                }
            }
            // even a hostile Retry-After costs at most a few capped sleeps
            assert!(
                virtual_start.elapsed() < Duration::from_secs(2000),
                "seed {seed} iteration {i} took {:?}",
                virtual_start.elapsed()
            );
        }
        let _ = calls.len();
    }
    assert!(
        errors > 300 && successes > 20,
        "errors {errors}, successes {successes}"
    );
}

#[tokio::test(start_paused = true)]
async fn hostile_headers_and_bodies_never_confuse_error_mapping() {
    let mut r = Rng::new(99);
    for _ in 0..2000 {
        let status = *r.pick(&[
            400u16, 401, 403, 404, 409, 413, 429, 500, 502, 503, 418, 301,
        ]);
        let reply_headers: Vec<(String, String)> = vec![
            ("Retry-After".into(), r.junk_string()),
            ("Date".into(), r.junk_string()),
            ("Location".into(), r.junk_string()),
        ];
        let body = if r.chance(2) {
            r.junk_json(3).to_string()
        } else {
            r.junk_string()
        };
        let (b, _) = builder(move |_, _| {
            Reply::Response(unsent::TransportResponse::new(
                status,
                reply_headers.clone(),
                body.clone(),
            ))
        });
        let u = b.max_retries(1).build().unwrap();
        let e = u
            .send(SendEmail::builder().to("a@b.co").subject("s").text("t"))
            .await
            .unwrap_err();
        check_err(&e);
        if let Some(d) = e.retry_after() {
            assert!(d <= Duration::from_secs(60));
        }
    }
}

#[test]
fn junk_into_the_pure_helpers_never_crashes() {
    let mut r = Rng::new(7);
    for _ in 0..20_000 {
        let s = r.junk_string();
        let a = Address::parse(&s);
        assert_eq!(a.email, a.email.trim());
        let _ = Address::with_name(s.as_str(), r.junk_string());
        let _ = s.parse::<EmailStatus>();
        let _ = s.parse::<Sort>();
        let _ = unsent::Day::from(s.as_str());
        let _ = Attachment::from_base64("f", s.as_str());
        let _ = Unsent::from_vars([("UNSENT_BASE_URL", s.as_str()), ("UNSENT_API_KEY", "k")]);
        let _ = Unsent::from_vars([
            ("UNSENT_BASE_URL", "https://x.test"),
            ("UNSENT_API_KEY", s.as_str()),
            ("UNSENT_API_SECRET", s.as_str()),
        ]);
    }
}
