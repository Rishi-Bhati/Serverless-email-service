//! `get`, `list`, `iterate`, `wait`, `status` and `health` (SPEC sections 2 and 6).

mod common;

use std::time::{Duration, UNIX_EPOCH};

use common::*;
use serde_json::{json, Value};
use unsent::{
    CancellationToken, EmailStatus, Error, ListEmails, RequestOptions, Sort, WaitOptions,
    MAX_DELIVERY_ATTEMPTS,
};

/// Shape copied from GET /api/emails and GET /api/emails/:id in src/index.ts.
fn row(over: Value) -> Value {
    let mut base = json!({
        "id": 3, "to_json": "[\"a@b.co\"]", "subject": "Hello", "body": "<p>Hi</p>", "html_body": "<p>Hi</p>",
        "text_body": "<p>Hi</p>", "from_email": "me@x.co", "from_name": "Me", "provider_id": null, "provider_used": "SES",
        "failover_history": "[{\"provider\":\"SMTP\",\"type\":\"smtp\",\"error\":\"timeout\",\"timestamp\":1780000000000}]",
        "idempotency_key": "k-1", "status": "sent", "attempts": 1, "error": null, "error_message": null,
        "created_at": 1_780_000_000_000i64, "updated_at": 1_780_000_005_000i64, "to": ["a@b.co"],
        "attachments": [{"filename": "a.pdf", "mimeType": "application/pdf", "size": 1234}], "attachment_count": 1
    });
    for (k, v) in over.as_object().unwrap() {
        base[k] = v.clone();
    }
    base
}

fn no_retry(
    handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static,
) -> (unsent::Unsent, Calls) {
    let (b, calls) = builder(handler);
    (b.max_retries(0).build().unwrap(), calls)
}

fn at(ms: u64) -> std::time::SystemTime {
    UNIX_EPOCH + Duration::from_millis(ms)
}

#[tokio::test]
async fn get_maps_the_detail_response() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"email": row(json!({
                "text_body": "Hi", "cc": ["c@d.co"],
                "attachments": [{"filename": "a.txt", "mimeType": "text/plain", "content": "aGVsbG8="}]
            }))}),
            200,
        )
    });
    let e = u.emails().get(3).await.unwrap();
    let req = calls.get(0);
    assert_eq!(req.path(), "/api/emails/3");
    assert_eq!(req.header("X-API-Key"), Some(API_KEY));
    assert!(!req.has("X-Signature"), "GET calls are not signed");
    assert!(req.body.is_empty());
    assert_eq!((e.id, e.status), (3, EmailStatus::Sent));
    assert_eq!(e.to, vec!["a@b.co"]);
    assert_eq!(e.cc, Some(vec!["c@d.co".to_string()]));
    assert_eq!(e.bcc, None);
    assert_eq!(
        (
            e.subject.as_str(),
            e.html_body.as_str(),
            e.text_body.as_deref()
        ),
        ("Hello", "<p>Hi</p>", Some("Hi"))
    );
    assert_eq!(
        (e.from_email.as_deref(), e.from_name.as_deref()),
        (Some("me@x.co"), Some("Me"))
    );
    assert_eq!(
        (e.provider_used.as_deref(), e.provider_id.as_deref()),
        (Some("SES"), None)
    );
    assert_eq!(
        (e.idempotency_key.as_deref(), e.attempts, e.error.as_deref()),
        (Some("k-1"), 1, None)
    );
    assert_eq!(
        (e.created_at, e.updated_at),
        (at(1_780_000_000_000), at(1_780_000_005_000))
    );
    assert_eq!(e.failover_history.len(), 1);
    assert_eq!(e.failover_history[0].provider, "SMTP");
    assert_eq!(e.failover_history[0].kind, "smtp");
    assert_eq!(e.failover_history[0].error, "timeout");
    assert_eq!(e.failover_history[0].timestamp, at(1_780_000_000_000));
    assert_eq!(e.attachments.len(), 1);
    let a = &e.attachments[0];
    assert_eq!(
        (
            a.filename.as_str(),
            a.mime_type.as_deref(),
            a.size,
            a.content.as_deref()
        ),
        ("a.txt", Some("text/plain"), 5, Some("aGVsbG8="))
    );
    assert_eq!(a.bytes().unwrap().unwrap(), b"hello");
}

#[tokio::test]
async fn get_reports_text_body_as_none_when_the_api_only_echoed_the_html() {
    let (u, _) = no_retry(|_, _| json_resp(json!({"email": row(json!({}))}), 200));
    assert_eq!(u.emails().get(3).await.unwrap().text_body, None);
    let (u, _) = no_retry(|_, _| json_resp(json!({"email": row(json!({"text_body": ""}))}), 200));
    assert_eq!(u.emails().get(3).await.unwrap().text_body, None);
}

#[tokio::test]
async fn get_maps_not_found() {
    let (u, _) = no_retry(|_, _| api_error(404, "not_found", "Email not found", None, &[]));
    let e = u.emails().get(999).await.unwrap_err();
    assert!(matches!(e, Error::NotFound(_)));
    assert_eq!((e.status(), e.code()), (Some(404), "not_found"));
}

#[tokio::test]
async fn get_rejects_invalid_ids_without_a_request() {
    for id in [0i64, -1, i64::MIN] {
        let (u, calls) = no_retry(|_, _| json_resp(json!({}), 200));
        let e = u.emails().get(id).await.unwrap_err();
        assert!(matches!(e, Error::Validation(_)), "{id}");
        assert_eq!(calls.len(), 0);
    }
    // the largest id still builds a valid URL
    let (u, calls) = no_retry(|_, _| json_resp(json!({"email": row(json!({}))}), 200));
    u.emails().get(i64::MAX).await.unwrap();
    assert_eq!(calls.get(0).path(), format!("/api/emails/{}", i64::MAX));
}

#[tokio::test]
async fn get_tolerates_a_malformed_failover_history() {
    for bad in [
        json!("{not json"),
        json!(5),
        json!(null),
        json!({"a": 1}),
        json!("[1,2,{\"provider\":5}]"),
    ] {
        let (u, _) = no_retry(move |_, _| {
            json_resp(
                json!({"email": row(json!({"failover_history": bad.clone()}))}),
                200,
            )
        });
        let e = u.emails().get(3).await.unwrap();
        assert!(e.failover_history.len() <= 3);
    }
    // an array (not a string) works too
    let (u, _) = no_retry(|_, _| {
        json_resp(
            json!({"email": row(json!({"failover_history": [{"provider": "P", "type": "t", "error": "e", "timestamp": 5}]}))}),
            200,
        )
    });
    let e = u.emails().get(3).await.unwrap();
    assert_eq!(e.failover_history[0].provider, "P");
    assert_eq!(e.failover_history[0].timestamp, at(5));
}

#[tokio::test]
async fn get_requires_an_email_object() {
    for body in [
        json!({}),
        json!({"email": 5}),
        json!({"email": [1]}),
        json!({"email": null}),
        json!([]),
    ] {
        let b2 = body.clone();
        let (u, _) = no_retry(move |_, _| json_resp(b2.clone(), 200));
        let e = u.emails().get(3).await.unwrap_err();
        assert_eq!(e.code(), "invalid_response", "{body}");
    }
}

#[tokio::test]
async fn list_builds_the_query_and_maps_the_page() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"emails": [row(json!({})), row(json!({"id": 2}))], "results": [], "total": 5, "limit": 2, "offset": 0}),
            200,
        )
    });
    let page = u
        .emails()
        .list(
            ListEmails::new()
                .limit(2)
                .offset(0)
                .status(EmailStatus::Failed)
                .search("invoice")
                .from(UNIX_EPOCH + Duration::from_secs(1_767_654_000)) // 2026-01-05T23:00:00Z
                .to("2026-02-01")
                .sort(Sort::CreatedAtAsc),
        )
        .await
        .unwrap();
    let q = calls.get(0).query();
    let want: std::collections::HashMap<String, String> = [
        ("limit", "2"),
        ("offset", "0"),
        ("status", "failed"),
        ("q", "invoice"),
        ("from", "2026-01-05"),
        ("to", "2026-02-01"),
        ("sort", "created_at_asc"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    assert_eq!(q, want);
    assert_eq!(
        page.emails.iter().map(|e| e.id).collect::<Vec<_>>(),
        vec![3, 2]
    );
    assert_eq!(
        (page.total, page.limit, page.offset, page.has_more),
        (5, 2, 0, true)
    );
    let a = &page.emails[0].attachments[0];
    assert_eq!(
        (
            a.filename.as_str(),
            a.mime_type.as_deref(),
            a.size,
            a.content.as_ref()
        ),
        ("a.pdf", Some("application/pdf"), 1234, None)
    );
}

#[tokio::test]
async fn list_omits_unset_and_empty_params_and_reports_the_last_page() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"emails": [row(json!({}))], "total": 1, "limit": 100, "offset": 0}),
            200,
        )
    });
    let page = u.emails().list(ListEmails::new().search("")).await.unwrap();
    assert_eq!(calls.get(0).url.query(), None);
    assert!(!page.has_more);
}

#[tokio::test]
async fn list_encodes_search_text_safely() {
    let (u, calls) = no_retry(|_, _| json_resp(json!({"emails": [], "total": 0}), 200));
    u.emails()
        .list(ListEmails::new().search("a&b=c d+e%20\r\n#x ü 🎉"))
        .await
        .unwrap();
    assert_eq!(
        calls.get(0).query().get("q").map(String::as_str),
        Some("a&b=c d+e%20\r\n#x ü 🎉")
    );
    assert_eq!(calls.get(0).query().len(), 1);
    assert!(!calls.get(0).url.as_str().contains('\n'));
}

#[tokio::test]
async fn list_rejects_invalid_arguments_without_a_request() {
    let bad = vec![
        ListEmails::new().limit(0),
        ListEmails::new().limit(201),
        ListEmails::new().limit(u32::MAX),
        ListEmails::new().from("yesterday"),
        ListEmails::new().from("2026-1-05"),
        ListEmails::new().from("20260105"),
        ListEmails::new().to("2026-01-0x"),
        ListEmails::new().to(""),
        ListEmails::new().from("日本語日本語日本語日本語"),
        ListEmails::new().from(UNIX_EPOCH + Duration::from_secs(400_000_000_000)),
        ListEmails::new().timeout(Duration::ZERO),
        ListEmails::new().max_retries(99),
    ];
    for q in bad {
        let (u, calls) = no_retry(|_, _| json_resp(json!({}), 200));
        let e = u
            .emails()
            .list(q.clone())
            .await
            .expect_err(&format!("{q:?}"));
        assert!(matches!(e, Error::Validation(_)), "{q:?}");
        assert_eq!(calls.len(), 0);
    }
    assert_eq!(
        "bogus".parse::<EmailStatus>().unwrap_err().code(),
        "validation_error"
    );
    assert_eq!(
        "bogus".parse::<Sort>().unwrap_err().code(),
        "validation_error"
    );
    assert_eq!(
        "created_at_desc".parse::<Sort>().unwrap(),
        Sort::CreatedAtDesc
    );
    assert_eq!(
        "sending".parse::<EmailStatus>().unwrap().to_string(),
        "sending"
    );
}

#[tokio::test]
async fn list_accepts_dates_with_a_time_suffix_like_the_reference() {
    let (u, calls) = no_retry(|_, _| json_resp(json!({"emails": [], "total": 0}), 200));
    u.emails()
        .list(
            ListEmails::new()
                .from("2026-01-05T10:00:00Z")
                .to("1970-01-01"),
        )
        .await
        .unwrap();
    let q = calls.get(0).query();
    assert_eq!(
        (q["from"].as_str(), q["to"].as_str()),
        ("2026-01-05", "1970-01-01")
    );
}

#[tokio::test]
async fn list_rejects_malformed_server_replies_instead_of_panicking() {
    for body in [
        json!([]),
        json!(5),
        json!(null),
        json!({"emails": 5}),
        json!({"emails": {"a": 1}}),
        json!({"emails": [5]}),
        json!({"emails": [null]}),
    ] {
        let b2 = body.clone();
        let (u, _) = no_retry(move |_, _| json_resp(b2.clone(), 200));
        let e = u.emails().list(ListEmails::new()).await.unwrap_err();
        assert_eq!(e.code(), "invalid_response", "{body}");
    }
    // missing emails means no emails
    let (u, _) = no_retry(|_, _| json_resp(json!({"total": 0}), 200));
    assert!(u
        .emails()
        .list(ListEmails::new())
        .await
        .unwrap()
        .emails
        .is_empty());
}

fn paged_server(total: usize) -> impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static {
    let all: Vec<Value> = (0..total).map(|i| row(json!({"id": i + 1}))).collect();
    move |req, _| {
        let q = req.query();
        let off: usize = q.get("offset").and_then(|v| v.parse().ok()).unwrap_or(0);
        let lim: usize = q.get("limit").and_then(|v| v.parse().ok()).unwrap_or(100);
        let end = (off + lim).min(all.len());
        json_resp(
            json!({"emails": all[off.min(end)..end], "total": all.len(), "limit": lim, "offset": off}),
            200,
        )
    }
}

#[tokio::test]
async fn iterate_walks_every_page_oldest_first_and_stops() {
    let (u, calls) = no_retry(paged_server(5));
    let mut it = u.emails().iterate(ListEmails::new().limit(2));
    let mut ids = Vec::new();
    while let Some(e) = it.next().await {
        ids.push(e.unwrap().id);
    }
    assert_eq!(ids, vec![1, 2, 3, 4, 5]);
    let offsets: Vec<_> = calls
        .all()
        .iter()
        .map(|c| c.query()["offset"].clone())
        .collect();
    assert_eq!(offsets, vec!["0", "2", "4"]);
    assert_eq!(calls.get(0).query()["sort"], "created_at_asc");
    assert!(it.next().await.is_none(), "stays finished");
    assert_eq!(calls.len(), 3);
}

#[tokio::test]
async fn iterate_honors_a_custom_sort_and_pages() {
    let (u, calls) = no_retry(paged_server(5));
    let mut it = u.emails().iterate(
        ListEmails::new()
            .limit(2)
            .sort(Sort::UpdatedAtDesc)
            .status(EmailStatus::Sent),
    );
    let mut sizes = Vec::new();
    while let Some(p) = it.next_page().await.unwrap() {
        sizes.push(p.len());
    }
    assert_eq!(sizes, vec![2, 2, 1]);
    assert_eq!(calls.get(0).query()["sort"], "updated_at_desc");
    assert_eq!(calls.get(0).query()["status"], "sent");
}

#[tokio::test]
async fn iterate_ends_on_an_empty_collection_and_on_a_server_that_over_reports_total() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"emails": [], "total": 10, "limit": 100, "offset": 0}),
            200,
        )
    });
    let mut it = u.emails().iterate(ListEmails::new());
    assert!(it.next().await.is_none());
    assert_eq!(calls.len(), 1);
}

#[tokio::test]
async fn iterate_stops_after_an_error() {
    let (u, calls) = no_retry(|_, n| {
        if n == 1 {
            json_resp(json!({"emails": [row(json!({}))], "total": 9}), 200)
        } else {
            api_error(500, "internal_error", "boom", None, &[])
        }
    });
    let mut it = u.emails().iterate(ListEmails::new().limit(1));
    assert!(it.next().await.unwrap().is_ok());
    assert!(it.next().await.unwrap().is_err());
    assert!(it.next().await.is_none());
    assert_eq!(calls.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn wait_polls_until_sent() {
    let seq = ["queued", "sending", "sent"];
    let (u, calls) =
        no_retry(move |_, n| json_resp(json!({"email": row(json!({"status": seq[n - 1]}))}), 200));
    let e = u.emails().wait(3).await.unwrap();
    assert_eq!(e.status, EmailStatus::Sent);
    assert_eq!(calls.len(), 3);
}

#[tokio::test(start_paused = true)]
async fn wait_keeps_waiting_on_a_failed_email_with_retries_left() {
    let seq = [
        (1, "failed"),
        (2, "failed"),
        (MAX_DELIVERY_ATTEMPTS, "failed"),
    ];
    let (u, calls) = no_retry(move |_, n| {
        json_resp(
            json!({"email": row(json!({"status": seq[n - 1].1, "attempts": seq[n - 1].0, "error": "boom"}))}),
            200,
        )
    });
    let e = u.emails().wait(3).await.unwrap();
    assert_eq!(
        (e.status, e.attempts, e.error.as_deref()),
        (EmailStatus::Failed, 3, Some("boom"))
    );
    assert_eq!(calls.len(), 3);
    assert!(e.is_final());
}

#[tokio::test(start_paused = true)]
async fn wait_backs_off_between_polls() {
    let t0 = tokio::time::Instant::now();
    let (u, calls) = no_retry(|_, n| {
        json_resp(
            json!({"email": row(json!({"status": if n < 5 { "queued" } else { "sent" }}))}),
            200,
        )
    });
    u.emails()
        .wait_with(3, WaitOptions::new().interval(Duration::from_secs(1)))
        .await
        .unwrap();
    // 1.0 + 1.5 + 2.25 + 3.375 seconds between five polls
    assert_eq!(calls.len(), 5);
    let waited = t0.elapsed();
    assert!(
        waited >= Duration::from_millis(8_100) && waited <= Duration::from_millis(8_200),
        "{waited:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn wait_times_out() {
    let (u, _) = no_retry(|_, _| {
        json_resp(
            json!({"email": row(json!({"status": "queued", "attempts": 0}))}),
            200,
        )
    });
    let e = u
        .emails()
        .wait_with(3, WaitOptions::new().timeout(Duration::from_secs(3)))
        .await
        .unwrap_err();
    assert!(matches!(e, Error::Timeout(_)));
    assert!(e.is_timeout());
    assert_eq!(e.code(), "timeout");
    assert!(
        e.message().contains("Email 3")
            && e.message().contains("queued")
            && e.message().contains("3000"),
        "{e}"
    );
}

#[tokio::test(start_paused = true)]
async fn wait_can_be_cancelled() {
    let (u, _) = no_retry(|_, _| {
        json_resp(
            json!({"email": row(json!({"status": "queued", "attempts": 0}))}),
            200,
        )
    });
    let token = CancellationToken::new();
    let t2 = token.clone();
    let h = tokio::spawn({
        let u = u.clone();
        async move {
            u.emails()
                .wait_with(3, WaitOptions::new().cancellation_token(t2))
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    token.cancel();
    let e = h.await.unwrap().unwrap_err();
    assert!(e.is_aborted());
    assert_eq!(e.code(), "aborted");
}

#[tokio::test(start_paused = true)]
async fn wait_propagates_lookup_errors() {
    let (u, _) = no_retry(|_, _| api_error(404, "not_found", "Email not found", None, &[]));
    assert!(matches!(
        u.emails().wait(3).await.unwrap_err(),
        Error::NotFound(_)
    ));
    let e = u.emails().wait(0).await.unwrap_err();
    assert!(matches!(e, Error::Validation(_)));
}

#[tokio::test(start_paused = true)]
async fn wait_works_when_dropped_mid_flight() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"email": row(json!({"status": "queued", "attempts": 0}))}),
            200,
        )
    });
    let fut = u.emails().wait(3);
    // poll it briefly then drop it: no further requests may happen
    let r = tokio::time::timeout(Duration::from_millis(1500), fut).await;
    assert!(r.is_err());
    let n = calls.len();
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(calls.len(), n);
}

#[tokio::test]
async fn status_returns_counters_with_defaults() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"queued": 1, "sending": 2, "sent": 3, "failed": 4}),
            200,
        )
    });
    let s = u.status().await.unwrap();
    assert_eq!((s.queued, s.sending, s.sent, s.failed), (1, 2, 3, 4));
    assert_eq!(calls.get(0).path(), "/api/status");
    assert_eq!(calls.get(0).header("X-API-Key"), Some(API_KEY));
    let (u, _) =
        no_retry(|_, _| json_resp(json!({"queued": "7", "sent": -3, "failed": null}), 200));
    let s = u.status().await.unwrap();
    assert_eq!((s.queued, s.sending, s.sent, s.failed), (7, 0, 0, 0));
}

#[tokio::test]
async fn health_needs_no_credentials() {
    let (u, calls) = no_retry(|_, _| {
        json_resp(
            json!({"status": "ok", "runtime": "cf_worker", "d1": "bound", "timestamp": 1_780_000_000_000i64}),
            200,
        )
    });
    let h = u.health().await.unwrap();
    assert_eq!(
        (
            h.status.as_str(),
            h.runtime.as_str(),
            h.d1.as_str(),
            h.timestamp
        ),
        ("ok", "cf_worker", "bound", at(1_780_000_000_000))
    );
    assert!(!calls.get(0).has("X-API-Key"));
    assert!(!calls.get(0).has("X-Signature"));
}

#[tokio::test]
async fn status_rejects_bad_credentials_with_a_hint() {
    let (u, _) = no_retry(|_, _| {
        api_error(
            401,
            "invalid_api_key",
            "Unauthorized: Invalid credentials or expired session",
            None,
            &[],
        )
    });
    let e = u.status().await.unwrap_err();
    assert!(matches!(e, Error::Authentication(_)));
    assert_eq!((e.status(), e.code()), (Some(401), "invalid_api_key"));
    assert!(e.hint().unwrap().contains("api_key"));
}

#[tokio::test]
async fn per_call_options_are_validated_for_status_get_and_health() {
    let (u, calls) = no_retry(|_, _| json_resp(json!({}), 200));
    let bad = RequestOptions::new().timeout(Duration::ZERO);
    assert!(matches!(
        u.status_with(&bad).await.unwrap_err(),
        Error::Validation(_)
    ));
    assert!(matches!(
        u.health_with(&bad).await.unwrap_err(),
        Error::Validation(_)
    ));
    assert!(matches!(
        u.emails().get_with(1, &bad).await.unwrap_err(),
        Error::Validation(_)
    ));
    assert_eq!(calls.len(), 0);
}
