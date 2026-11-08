//! Retries, backoff, `Retry-After`, clock skew, timeouts, cancellation and error mapping (SPEC sections 4 and 5).
//! Time is paused, so backoff sleeps cost nothing and their lengths can be asserted exactly.

mod common;

use std::collections::HashSet;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use serde_json::{json, Value};
use tokio::time::Instant;
use unsent::{
    CancellationToken, Error, SendEmail, Transport, TransportError, TransportErrorKind, Unsent,
};

fn msg() -> SendEmail {
    SendEmail::builder().to("a@b.co").subject("s").html("h")
}

fn setup(handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static) -> (Unsent, Calls) {
    client(handler)
}

// ---------------------------------------------------------------------------------------------------------
// retries
// ---------------------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn retries_5xx_with_the_same_key_but_a_fresh_nonce_and_signature() {
    let (u, calls) = setup(|_, n| {
        if n < 3 {
            api_error(500, "internal_error", "Internal server error", None, &[])
        } else {
            accepted(5)
        }
    });
    let res = u.send(msg()).await.unwrap();
    assert_eq!(res.id, 5);
    assert_eq!(calls.len(), 3);
    let keys: HashSet<_> = calls
        .all()
        .iter()
        .map(|c| c.json()["idempotency_key"].as_str().unwrap().to_owned())
        .collect();
    let nonces: HashSet<_> = calls
        .all()
        .iter()
        .map(|c| c.header("X-Nonce").unwrap().to_owned())
        .collect();
    assert_eq!(keys.len(), 1);
    assert_eq!(nonces.len(), 3);
    let bodies: HashSet<_> = calls.all().iter().map(|c| c.body.clone()).collect();
    assert_eq!(bodies.len(), 1, "the body is identical across attempts");
    let mut used = HashSet::new();
    for c in calls.all() {
        assert_eq!(verify_signed(&c, API_SECRET, Some(&mut used)), Verdict::Ok);
    }
    assert_eq!(
        res.idempotency_key.as_deref(),
        keys.iter().next().map(String::as_str)
    );
}

#[tokio::test(start_paused = true)]
async fn retries_each_retryable_status_and_honors_retry_after() {
    for status in [408u16, 425, 429, 500, 502, 503, 504, 599] {
        let (u, calls) = setup(move |_, n| {
            if n == 1 {
                api_error(status, "x", "e", None, &[("Retry-After", "2")])
            } else {
                accepted(1)
            }
        });
        let t0 = Instant::now();
        let h = tokio::spawn({
            let u = u.clone();
            async move { u.send(msg()).await }
        });
        tokio::time::sleep(Duration::from_millis(1900)).await;
        assert_eq!(
            calls.len(),
            1,
            "{status}: still waiting for Retry-After: 2s"
        );
        h.await.unwrap().unwrap();
        assert_eq!(calls.len(), 2, "{status}");
        let waited = t0.elapsed();
        assert!(
            waited >= Duration::from_secs(2) && waited < Duration::from_millis(2100),
            "{status}: {waited:?}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn retries_network_errors() {
    let (u, calls) = setup(|_, n| {
        if n < 3 {
            connection_reset()
        } else {
            accepted(1)
        }
    });
    u.send(msg()).await.unwrap();
    assert_eq!(calls.len(), 3);
}

#[tokio::test(start_paused = true)]
async fn gives_up_after_max_retries_and_surfaces_the_last_error() {
    let (b, calls) = builder(|_, _| api_error(503, "x", "Unavailable", None, &[]));
    let u = b.max_retries(2).build().unwrap();
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Server(_)));
    assert_eq!(e.status(), Some(503));
    assert_eq!(calls.len(), 3);
}

#[tokio::test(start_paused = true)]
async fn max_retries_zero_on_the_client_or_per_call_disables_retries() {
    let (b, calls) = builder(|_, _| api_error(500, "internal_error", "e", None, &[]));
    let u = b.max_retries(0).build().unwrap();
    assert!(matches!(u.send(msg()).await.unwrap_err(), Error::Server(_)));
    assert_eq!(calls.len(), 1);
    let (u, calls) = setup(|_, _| api_error(500, "internal_error", "e", None, &[]));
    assert!(matches!(
        u.send(msg().max_retries(0)).await.unwrap_err(),
        Error::Server(_)
    ));
    assert_eq!(calls.len(), 1);
    // a per-call value can also raise the limit
    let (b, calls) = builder(|_, _| api_error(500, "internal_error", "e", None, &[]));
    let u = b.max_retries(0).build().unwrap();
    let _ = u.send(msg().max_retries(2)).await;
    assert_eq!(calls.len(), 3);
}

#[tokio::test(start_paused = true)]
async fn does_not_retry_these_statuses() {
    let cases: [(u16, &str); 14] = [
        (400, "validation_error"),
        (400, "unauthorized_sender"),
        (401, "invalid_api_key"),
        (401, "invalid_signature"),
        (403, "forbidden"),
        (404, "not_found"),
        (409, "idempotency_key_conflict"),
        (413, "payload_too_large"),
        (422, "x"),
        (500, "server_misconfigured"),
        (501, "x"),
        (505, "x"),
        (418, "x"),
        (410, "x"),
    ];
    for (status, code) in cases {
        let (u, calls) = setup(move |_, _| api_error(status, code, "nope", None, &[]));
        let e = u.send(msg()).await.unwrap_err();
        assert_eq!((e.status(), e.code()), (Some(status), code));
        assert_eq!(calls.len(), 1, "{status} {code}");
        assert!(!e.is_retryable(), "{status} {code}");
    }
    // 3xx are never retried either
    let (u, calls) = setup(|_, _| resp(307, &[("Location", "https://elsewhere.test/")], ""));
    assert_eq!(
        u.send(msg()).await.unwrap_err().code(),
        "unexpected_redirect"
    );
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn is_retryable_matches_the_retry_policy() {
    for (status, code, expect) in [
        (408, "x", true),
        (425, "x", true),
        (429, "x", true),
        (500, "internal_error", true),
        (502, "x", true),
        (503, "x", true),
        (504, "x", true),
        (501, "x", false),
        (505, "x", false),
        (500, "server_misconfigured", false),
        (400, "x", false),
        (401, "x", false),
    ] {
        let (b, _) = builder(move |_, _| api_error(status, code, "e", None, &[]));
        let u = b.max_retries(0).build().unwrap();
        assert_eq!(
            u.status().await.unwrap_err().is_retryable(),
            expect,
            "{status} {code}"
        );
    }
    let (b, _) = builder(|_, _| connection_reset());
    assert!(b
        .max_retries(0)
        .build()
        .unwrap()
        .status()
        .await
        .unwrap_err()
        .is_retryable());
    let (b, _) = builder(|_, _| Reply::Hang);
    let e = b
        .max_retries(0)
        .timeout(Duration::from_millis(5))
        .build()
        .unwrap()
        .status()
        .await
        .unwrap_err();
    assert!(e.is_retryable() && e.is_timeout());
    let (u, _) = setup(|_, _| accepted(1));
    assert!(!u
        .send(SendEmail::builder())
        .await
        .unwrap_err()
        .is_retryable());
}

#[tokio::test(start_paused = true)]
async fn a_send_without_an_idempotency_key_is_never_retried() {
    let (u, calls) = setup(|_, _| connection_reset());
    assert!(matches!(
        u.send(msg().no_idempotency()).await.unwrap_err(),
        Error::Connection(_)
    ));
    assert_eq!(calls.len(), 1);
    let (u, calls) = setup(|_, _| api_error(500, "internal_error", "e", None, &[]));
    assert!(matches!(
        u.send(msg().no_idempotency()).await.unwrap_err(),
        Error::Server(_)
    ));
    assert_eq!(calls.len(), 1);
    let (u, calls) = setup(|_, _| Reply::Hang);
    assert!(u
        .send(msg().no_idempotency().timeout(Duration::from_secs(1)))
        .await
        .unwrap_err()
        .is_timeout());
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn get_requests_are_retried_too() {
    for which in 0..4 {
        let (u, calls) = setup(|_, n| {
            if n < 3 {
                connection_reset()
            } else {
                json_resp(
                    json!({"queued": 1, "emails": [], "total": 0, "email": {"id": 1}, "status": "ok"}),
                    200,
                )
            }
        });
        match which {
            0 => drop(u.status().await.unwrap()),
            1 => drop(u.health().await.unwrap()),
            2 => drop(u.emails().get(1).await.unwrap()),
            _ => drop(u.emails().list(Default::default()).await.unwrap()),
        }
        assert_eq!(calls.len(), 3, "{which}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_retried_send_whose_first_attempt_landed_resolves_as_a_replay() {
    let (u, calls) = setup(|_, n| {
        if n == 1 {
            api_error(502, "x", "Bad gateway", None, &[])
        } else {
            json_resp_h(
                json!({"success": true, "id": 4, "status": "queued", "idempotent_replay": true, "message": "m", "targetProvider": "p"}),
                200,
                &[("Idempotent-Replayed", "true")],
            )
        }
    });
    let res = u.send(msg()).await.unwrap();
    assert_eq!((res.id, res.idempotent_replay), (4, true));
    assert_eq!(calls.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn backoff_is_exponential_with_jitter_and_capped() {
    let times = Arc::new(Mutex::new(Vec::new()));
    let t2 = times.clone();
    let (b, calls) = builder(move |_, _| {
        t2.lock().unwrap().push(Instant::now());
        api_error(503, "x", "e", None, &[])
    });
    let u = b.max_retries(10).build().unwrap();
    let _ = u.send(msg()).await;
    assert_eq!(calls.len(), 11);
    let times = times.lock().unwrap();
    for attempt in 0..10u32 {
        let delay = times[attempt as usize + 1] - times[attempt as usize];
        let exp = (500u64 * 2u64.pow(attempt)).min(8000);
        let (lo, hi) = (Duration::from_millis(exp / 2), Duration::from_millis(exp));
        assert!(
            delay >= lo && delay <= hi + Duration::from_millis(1),
            "attempt {attempt}: {delay:?} not in {lo:?}..={hi:?}"
        );
    }
    // jitter really varies
    let distinct: HashSet<_> = (0..10)
        .map(|i| {
            (times[i + 1] - times[i]).as_millis() * 1000 / (500u128 * 2u128.pow(i as u32)).min(8000)
        })
        .collect();
    assert!(distinct.len() > 3, "{distinct:?}");
}

#[tokio::test(start_paused = true)]
async fn retry_after_accepts_seconds_dates_and_ignores_garbage() {
    async fn delay_for(header: &str) -> Duration {
        let h = header.to_owned();
        let (u, _) = client(move |_, n| {
            if n == 1 {
                api_error(503, "x", "e", None, &[("Retry-After", &h)])
            } else {
                accepted(1)
            }
        });
        let t0 = Instant::now();
        u.send(msg()).await.unwrap();
        t0.elapsed()
    }
    // seconds, with fractions and surrounding spaces
    assert_eq!(delay_for("3").await, Duration::from_secs(3));
    assert_eq!(delay_for(" 1.5 ").await, Duration::from_millis(1500));
    // capped at 60 s
    assert_eq!(delay_for("99999").await, Duration::from_secs(60));
    assert_eq!(delay_for("1e308").await, Duration::from_secs(60));
    // garbage falls back to the ordinary backoff (at most 500 ms for the first retry)
    for bad in [
        "soon",
        "",
        "-5",
        "NaN",
        "inf",
        "1e999",
        "Infinity",
        "0x10",
        "3 seconds",
        "\u{1F4A5}",
    ] {
        assert!(
            delay_for(bad).await <= Duration::from_millis(500),
            "{bad:?}"
        );
    }
    // an HTTP date in the near future is converted using the client's clock
    let when = http_date(now_ms() + 10_000);
    let d = delay_for(&when).await;
    assert!(
        d >= Duration::from_secs(8) && d <= Duration::from_secs(10),
        "{d:?}"
    );
    // a date in the past means "now"
    assert!(delay_for(&http_date(now_ms() - 60_000)).await <= Duration::from_millis(500));
    // a far-future date is capped
    assert_eq!(
        delay_for(&http_date(now_ms() + 3_600_000)).await,
        Duration::from_secs(60)
    );
}

#[tokio::test(start_paused = true)]
async fn retry_after_is_exposed_on_the_error_in_seconds_capped() {
    let (b, _) = builder(|_, _| {
        api_error(
            429,
            "rate_limited",
            "slow down",
            None,
            &[("Retry-After", "7")],
        )
    });
    let e = b
        .max_retries(0)
        .build()
        .unwrap()
        .send(msg())
        .await
        .unwrap_err();
    assert!(matches!(e, Error::RateLimited(_)));
    assert_eq!(e.retry_after(), Some(Duration::from_secs(7)));
    let (b, _) = builder(|_, _| {
        api_error(
            429,
            "rate_limited",
            "slow down",
            None,
            &[("Retry-After", "100000")],
        )
    });
    let e = b
        .max_retries(0)
        .build()
        .unwrap()
        .send(msg())
        .await
        .unwrap_err();
    assert_eq!(e.retry_after(), Some(Duration::from_secs(60)));
    let (b, _) = builder(|_, _| api_error(429, "rate_limited", "slow down", None, &[]));
    assert_eq!(
        b.max_retries(0)
            .build()
            .unwrap()
            .send(msg())
            .await
            .unwrap_err()
            .retry_after(),
        None
    );
}

// ---------------------------------------------------------------------------------------------------------
// clock skew
// ---------------------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn learns_the_server_clock_from_the_date_header_and_retries_once() {
    // the client clock is ten minutes slow
    let (b, calls) = builder(|req, _| {
        let server_now = now_ms();
        match verify_signed_at(req, API_SECRET, None, server_now) {
            Verdict::Ok => accepted(8),
            Verdict::Bad(code) => api_error(
                401,
                code,
                "Unauthorized",
                Some("Timestamp out of range"),
                &[("Date", &http_date(server_now))],
            ),
        }
    });
    let u = b.clock(|| now_ms() - 600_000).build().unwrap();
    let res = u.send(msg()).await.unwrap();
    assert_eq!(res.id, 8);
    assert_eq!(
        calls.len(),
        2,
        "no health probe is needed when the Date header is present"
    );
    let off = u.clock_offset_ms();
    assert!((off - 600_000).abs() < 2_000, "{off}");
    // the offset is remembered, so later calls succeed first time
    u.send(msg()).await.unwrap();
    assert_eq!(calls.len(), 3);
    // the correction costs no retry
    let (b, calls) = builder(|req, _| {
        let server_now = now_ms();
        match verify_signed_at(req, API_SECRET, None, server_now) {
            Verdict::Ok => accepted(9),
            Verdict::Bad(code) => api_error(
                401,
                code,
                "Unauthorized",
                None,
                &[("Date", &http_date(server_now))],
            ),
        }
    });
    let u = b
        .clock(|| now_ms() + 3_600_000)
        .max_retries(0)
        .build()
        .unwrap();
    assert_eq!(u.send(msg()).await.unwrap().id, 9);
    assert_eq!(calls.len(), 2);
}

fn skewed_server(
    skew_ms: Arc<AtomicI64>,
) -> impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static {
    move |req, _| {
        let server_now = now_ms() + skew_ms.load(Ordering::SeqCst);
        if req.path() == "/api/health" {
            return json_resp(json!({"status": "ok", "timestamp": server_now}), 200);
        }
        match verify_signed_at(req, API_SECRET, None, server_now) {
            Verdict::Ok => accepted(11),
            Verdict::Bad(code) => api_error(
                401,
                code,
                "Unauthorized",
                Some("Timestamp out of range"),
                &[],
            ),
        }
    }
}

#[tokio::test(start_paused = true)]
async fn falls_back_to_the_health_probe_when_the_response_has_no_date_header() {
    let (u, calls) = setup(skewed_server(Arc::new(AtomicI64::new(600_000))));
    let res = u.send(msg()).await.unwrap();
    assert_eq!(res.id, 11);
    assert_eq!(calls.paths(), vec!["/api/send", "/api/health", "/api/send"]);
    assert!(
        !calls.get(1).has("X-API-Key"),
        "the probe carries no credentials"
    );
    assert!(!calls.get(1).has("X-Signature"));
}

#[tokio::test(start_paused = true)]
async fn drops_a_stale_offset_when_the_host_clock_has_since_been_fixed() {
    let skew = Arc::new(AtomicI64::new(600_000));
    let (u, calls) = setup(skewed_server(skew.clone()));
    u.send(msg()).await.unwrap(); // learns +10 minutes
    assert!(u.clock_offset_ms() > 500_000);
    skew.store(0, Ordering::SeqCst); // the operator fixes the clock
    u.send(msg()).await.unwrap(); // the stale offset is now wrong and must self-heal
    assert_eq!(u.clock_offset_ms(), 0);
    assert_eq!(
        calls.sends().len(),
        4,
        "2 + 2: each call needed one corrected retry"
    );
    u.send(msg()).await.unwrap();
    assert_eq!(calls.sends().len(), 5, "healthy again");
}

#[tokio::test(start_paused = true)]
async fn gives_up_cleanly_when_the_health_probe_is_unreachable() {
    let (u, calls) = setup(|req, _| {
        if req.path() == "/api/health" {
            connection_reset()
        } else {
            api_error(
                401,
                "timestamp_skew",
                "Unauthorized",
                Some("Timestamp out of range"),
                &[],
            )
        }
    });
    let e = u.send(msg()).await.unwrap_err();
    assert_eq!(e.code(), "timestamp_skew");
    assert!(matches!(e, Error::Authentication(_)));
    assert_eq!(calls.sends().len(), 1);
    assert!(e.hint().unwrap().contains("3 minutes"));
}

#[tokio::test(start_paused = true)]
async fn a_hostile_health_probe_cannot_break_the_correction() {
    for reply in [
        json!({"timestamp": "soon"}),
        json!({}),
        json!([1]),
        json!(null),
        json!({"timestamp": null}),
        json!({"timestamp": 1e300}),
    ] {
        let (u, calls) = setup(move |req, _| {
            if req.path() == "/api/health" {
                json_resp(reply.clone(), 200)
            } else {
                api_error(401, "timestamp_skew", "Unauthorized", None, &[])
            }
        });
        let e = u.send(msg()).await.unwrap_err();
        assert_eq!(e.code(), "timestamp_skew");
        assert!(calls.sends().len() <= 2);
    }
}

#[tokio::test(start_paused = true)]
async fn does_not_loop_when_the_skew_persists() {
    let (u, calls) = setup(|_, _| {
        api_error(
            401,
            "timestamp_skew",
            "Unauthorized",
            Some("bad"),
            &[("Date", &http_date(now_ms() + 3_600_000))],
        )
    });
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Authentication(_)));
    assert_eq!(e.code(), "timestamp_skew");
    assert_eq!(calls.len(), 2, "at most one correction per call");
}

#[tokio::test(start_paused = true)]
async fn ignores_small_skews_it_cannot_be_the_cause_of() {
    let (u, calls) = setup(|_, _| {
        api_error(
            401,
            "timestamp_skew",
            "Unauthorized",
            Some("bad"),
            &[("Date", &http_date(now_ms()))],
        )
    });
    assert_eq!(u.send(msg()).await.unwrap_err().code(), "timestamp_skew");
    assert_eq!(calls.len(), 1);
    assert_eq!(u.clock_offset_ms(), 0);
}

#[tokio::test(start_paused = true)]
async fn skew_correction_needs_a_secret_and_applies_to_unkeyed_sends() {
    // no secret: nothing to correct
    let (t, calls) = mock(|_, _| {
        api_error(
            401,
            "timestamp_skew",
            "Unauthorized",
            Some("Invalid or missing X-Timestamp header"),
            &[("Date", &http_date(now_ms() + 3_600_000))],
        )
    });
    let u = Unsent::builder()
        .no_env()
        .base_url(BASE)
        .api_key(API_KEY)
        .transport(t)
        .build()
        .unwrap();
    let e = u.send(msg()).await.unwrap_err();
    assert_eq!(calls.len(), 1);
    assert!(
        e.hint().unwrap().contains("requires signed requests"),
        "{e}"
    );
    // an unkeyed send may still be corrected: the failed attempt consumed no nonce
    let (b, calls) = builder(|req, _| {
        let server_now = now_ms();
        match verify_signed_at(req, API_SECRET, None, server_now) {
            Verdict::Ok => accepted(2),
            Verdict::Bad(code) => api_error(
                401,
                code,
                "Unauthorized",
                None,
                &[("Date", &http_date(server_now))],
            ),
        }
    });
    let u = b.clock(|| now_ms() - 600_000).build().unwrap();
    assert_eq!(u.send(msg().no_idempotency()).await.unwrap().id, 2);
    assert_eq!(calls.len(), 2);
}

// ---------------------------------------------------------------------------------------------------------
// timeouts and cancellation
// ---------------------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn times_out_a_hung_request_and_retries_it() {
    let (b, calls) = builder(|_, n| if n == 1 { Reply::Hang } else { accepted(1) });
    let u = b.timeout(Duration::from_millis(1000)).build().unwrap();
    assert_eq!(u.send(msg()).await.unwrap().id, 1);
    assert_eq!(calls.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn surfaces_a_timeout_error_when_every_attempt_hangs() {
    let (b, calls) = builder(|_, _| Reply::Hang);
    let u = b
        .timeout(Duration::from_millis(500))
        .max_retries(1)
        .build()
        .unwrap();
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Timeout(_)));
    assert_eq!(e.code(), "timeout");
    assert!(
        e.message().contains("/api/send") && e.message().contains("500 ms"),
        "{e}"
    );
    assert_eq!(calls.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_slow_but_in_time_response_succeeds() {
    let (b, _) = builder(|_, _| Reply::Delay(Duration::from_millis(900), Box::new(accepted(1))));
    assert!(b
        .timeout(Duration::from_secs(1))
        .max_retries(0)
        .build()
        .unwrap()
        .send(msg())
        .await
        .is_ok());
    let (b, _) = builder(|_, _| Reply::Delay(Duration::from_millis(1100), Box::new(accepted(1))));
    assert!(b
        .timeout(Duration::from_secs(1))
        .max_retries(0)
        .build()
        .unwrap()
        .send(msg())
        .await
        .unwrap_err()
        .is_timeout());
}

#[tokio::test(start_paused = true)]
async fn honors_a_per_call_timeout() {
    let (b, _) = builder(|_, _| Reply::Hang);
    let u = b.max_retries(0).build().unwrap();
    let t0 = Instant::now();
    let e = u
        .send(msg().timeout(Duration::from_millis(50)))
        .await
        .unwrap_err();
    assert!(e.is_timeout());
    assert_eq!(t0.elapsed(), Duration::from_millis(50));
}

#[tokio::test(start_paused = true)]
async fn cancelling_stops_immediately_without_retrying() {
    let (u, calls) = setup(|_, _| Reply::Hang);
    let token = CancellationToken::new();
    let h = tokio::spawn({
        let (u, t) = (u.clone(), token.clone());
        async move { u.send(msg().cancellation_token(t)).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!token.is_cancelled());
    token.cancel();
    assert!(token.is_cancelled());
    let e = h.await.unwrap().unwrap_err();
    assert!(matches!(e, Error::Aborted(_)));
    assert!(e.is_aborted());
    assert_eq!(e.code(), "aborted");
    assert!(!e.is_retryable());
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn cancelling_during_backoff_stops_waiting() {
    let (u, calls) = setup(|_, _| api_error(500, "internal_error", "e", None, &[]));
    let token = CancellationToken::new();
    let h = tokio::spawn({
        let (u, t) = (u.clone(), token.clone());
        async move { u.send(msg().cancellation_token(t)).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await; // first attempt done, now backing off
    token.cancel();
    let e = h.await.unwrap().unwrap_err();
    assert_eq!(e.code(), "aborted");
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn cancelling_during_a_long_retry_after_wait_is_immediate() {
    let (u, calls) =
        setup(|_, _| api_error(429, "rate_limited", "e", None, &[("Retry-After", "60")]));
    let token = CancellationToken::new();
    let t0 = Instant::now();
    let h = tokio::spawn({
        let (u, t) = (u.clone(), token.clone());
        async move { u.send(msg().cancellation_token(t)).await }
    });
    tokio::time::sleep(Duration::from_secs(1)).await;
    token.cancel();
    assert_eq!(h.await.unwrap().unwrap_err().code(), "aborted");
    assert!(t0.elapsed() < Duration::from_secs(2));
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn an_already_cancelled_token_never_touches_the_network() {
    let (u, calls) = setup(|_, _| accepted(1));
    let token = CancellationToken::new();
    token.cancel();
    token.cancel(); // idempotent
    let e = u
        .send(msg().cancellation_token(token.clone()))
        .await
        .unwrap_err();
    assert_eq!(e.code(), "aborted");
    let opts = unsent::RequestOptions::new().cancellation_token(token.clone());
    assert_eq!(u.status_with(&opts).await.unwrap_err().code(), "aborted");
    assert_eq!(u.health_with(&opts).await.unwrap_err().code(), "aborted");
    assert_eq!(
        u.emails().get_with(1, &opts).await.unwrap_err().code(),
        "aborted"
    );
    assert_eq!(
        u.emails()
            .list(unsent::ListEmails::new().cancellation_token(token.clone()))
            .await
            .unwrap_err()
            .code(),
        "aborted"
    );
    assert_eq!(calls.len(), 0);
    token.cancelled().await; // resolves immediately
}

#[tokio::test(start_paused = true)]
async fn cancelling_one_call_does_not_affect_others() {
    let (u, calls) = setup(|_, _| accepted(1));
    let token = CancellationToken::new();
    token.cancel();
    assert!(u.send(msg().cancellation_token(token)).await.is_err());
    assert!(u.send(msg()).await.is_ok());
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn dropping_the_future_cancels_the_call_and_its_retries() {
    let (u, calls) = setup(|_, _| api_error(500, "internal_error", "e", None, &[]));
    let r = tokio::time::timeout(Duration::from_millis(100), u.send(msg())).await;
    assert!(r.is_err(), "still retrying when the caller gave up");
    let n = calls.len();
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(
        calls.len(),
        n,
        "no attempts happen after the future is dropped"
    );
}

#[tokio::test(start_paused = true)]
async fn cancelling_during_the_clock_probe_aborts() {
    let (u, _) = setup(|req, _| {
        if req.path() == "/api/health" {
            Reply::Hang
        } else {
            api_error(401, "timestamp_skew", "Unauthorized", None, &[])
        }
    });
    let token = CancellationToken::new();
    let h = tokio::spawn({
        let (u, t) = (u.clone(), token.clone());
        async move { u.send(msg().cancellation_token(t)).await }
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    token.cancel();
    assert_eq!(h.await.unwrap().unwrap_err().code(), "aborted");
}

#[tokio::test(start_paused = true)]
async fn concurrent_sends_each_get_their_own_nonce_and_key() {
    let (u, calls) = setup(|_, _| accepted(1));
    let mut set = tokio::task::JoinSet::new();
    for _ in 0..50 {
        let u = u.clone();
        set.spawn(async move { u.send(msg()).await });
    }
    while let Some(r) = set.join_next().await {
        r.unwrap().unwrap();
    }
    let all = calls.all();
    assert_eq!(
        all.iter()
            .map(|c| c.header("X-Nonce").unwrap().to_owned())
            .collect::<HashSet<_>>()
            .len(),
        50
    );
    assert_eq!(
        all.iter()
            .map(|c| c.json()["idempotency_key"].as_str().unwrap().to_owned())
            .collect::<HashSet<_>>()
            .len(),
        50
    );
}

// ---------------------------------------------------------------------------------------------------------
// error mapping
// ---------------------------------------------------------------------------------------------------------

fn no_retry(handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static) -> Unsent {
    builder(handler).0.max_retries(0).build().unwrap()
}

#[tokio::test]
async fn exposes_status_code_reason_body_and_a_helpful_hint() {
    let u = no_retry(|_, _| {
        api_error(
            401,
            "invalid_signature",
            "Unauthorized",
            Some("Invalid signature (request headers or body may have been tampered with)"),
            &[],
        )
    });
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Authentication(_)));
    assert_eq!(e.status(), Some(401));
    assert_eq!(e.code(), "invalid_signature");
    assert!(e.reason().unwrap().contains("tampered"));
    assert!(e.hint().unwrap().contains("api_secret"));
    let m = e.message();
    assert!(m.starts_with("Unauthorized: Invalid signature") && m.contains("tampered") && m.ends_with("(Check that api_secret matches the API_SECRET secret of your Unsent deployment (no extra whitespace).)"), "{m}");
    assert_eq!(e.to_string(), m);
    assert_eq!(
        e.body().unwrap(),
        &json!({"error": "Unauthorized", "code": "invalid_signature", "reason": "Invalid signature (request headers or body may have been tampered with)"})
    );
    assert_eq!(e.existing_email_id(), None);
}

#[tokio::test]
async fn every_documented_code_has_its_hint() {
    let table = [
        ("invalid_api_key", "api_key matches the API_KEY"),
        ("unauthorized", "api_key matches the API_KEY"),
        ("invalid_signature", "api_secret matches the API_SECRET"),
        ("missing_signature", "requires signed requests"),
        ("unauthorized_sender", "not an active provider"),
        ("forbidden", "admin dashboard session"),
        ("nonce_reused", "nonce was replayed"),
        ("server_misconfigured", "missing configuration"),
    ];
    for (code, needle) in table {
        let u = no_retry(move |_, _| api_error(400, code, "Err", None, &[]));
        let e = u.status().await.unwrap_err();
        assert!(
            e.hint().is_some_and(|h| h.contains(needle)),
            "{code}: {:?}",
            e.hint()
        );
        assert!(e.message().ends_with(')'));
    }
    let u = no_retry(|_, _| api_error(400, "something_else", "Err", None, &[]));
    assert_eq!(u.status().await.unwrap_err().hint(), None);
}

#[tokio::test]
async fn timestamp_skew_and_nonce_hints_depend_on_whether_a_secret_is_configured() {
    let (t, _) = mock(|_, _| {
        api_error(
            401,
            "timestamp_skew",
            "Unauthorized",
            Some("Invalid or missing X-Timestamp header"),
            &[],
        )
    });
    let no_secret = Unsent::builder()
        .no_env()
        .base_url(BASE)
        .api_key(API_KEY)
        .transport(t)
        .max_retries(0)
        .build()
        .unwrap();
    assert!(no_secret
        .send(msg())
        .await
        .unwrap_err()
        .hint()
        .unwrap()
        .contains("requires signed requests"));
    let (t, _) = mock(|_, _| {
        api_error(
            401,
            "invalid_nonce",
            "Unauthorized",
            Some("Missing X-Nonce header"),
            &[],
        )
    });
    let no_secret = Unsent::builder()
        .no_env()
        .base_url(BASE)
        .api_key(API_KEY)
        .transport(t)
        .max_retries(0)
        .build()
        .unwrap();
    assert!(no_secret
        .send(msg())
        .await
        .unwrap_err()
        .hint()
        .unwrap()
        .contains("requires signed requests"));
    let u = no_retry(|_, _| api_error(401, "invalid_nonce", "Unauthorized", None, &[]));
    assert_eq!(u.send(msg()).await.unwrap_err().hint(), None);
}

#[tokio::test]
async fn the_reason_is_appended_only_when_the_message_lacks_it() {
    let u = no_retry(|_, _| {
        api_error(
            400,
            "validation_error",
            "Missing subject",
            Some("subject is blank"),
            &[],
        )
    });
    assert_eq!(
        u.status().await.unwrap_err().message(),
        "Missing subject: subject is blank"
    );
    let u = no_retry(|_, _| {
        api_error(
            400,
            "validation_error",
            "Missing subject field",
            Some("subject"),
            &[],
        )
    });
    assert_eq!(
        u.status().await.unwrap_err().message(),
        "Missing subject field"
    );
}

#[tokio::test]
async fn maps_every_status_to_its_variant() {
    type Check = fn(&Error) -> bool;
    let table: Vec<(u16, Check)> = vec![
        (400, |e| matches!(e, Error::Request(_))),
        (401, |e| matches!(e, Error::Authentication(_))),
        (403, |e| matches!(e, Error::PermissionDenied(_))),
        (404, |e| matches!(e, Error::NotFound(_))),
        (409, |e| matches!(e, Error::Conflict(_))),
        (413, |e| matches!(e, Error::Request(_))),
        (418, |e| matches!(e, Error::Api(_))),
        (422, |e| matches!(e, Error::Api(_))),
        (429, |e| matches!(e, Error::RateLimited(_))),
        (500, |e| matches!(e, Error::Server(_))),
        (503, |e| matches!(e, Error::Server(_))),
        (599, |e| matches!(e, Error::Server(_))),
        (199, |e| matches!(e, Error::Api(_))),
    ];
    for (status, check) in table {
        let u = no_retry(move |_, _| api_error(status, "x", "e", None, &[]));
        let e = u.status().await.unwrap_err();
        assert!(check(&e), "{status}: {e:?}");
        assert_eq!(e.status(), Some(status));
    }
}

#[tokio::test]
async fn surfaces_the_conflicting_email_id_on_idempotency_conflicts() {
    let u = no_retry(|_, _| {
        json_resp(
            json!({"error": "Idempotency key was already used for a different email", "code": "idempotency_key_conflict", "id": 77}),
            409,
        )
    });
    let e = u.send(msg().idempotency_key("k")).await.unwrap_err();
    assert!(matches!(e, Error::Conflict(_)));
    assert_eq!(e.existing_email_id(), Some(77));
    for id in [json!("77"), json!(null), json!(1.5), json!([1])] {
        let u = no_retry(move |_, _| {
            json_resp(
                json!({"error": "x", "code": "idempotency_key_conflict", "id": id.clone()}),
                409,
            )
        });
        assert_eq!(u.status().await.unwrap_err().existing_email_id(), None);
    }
}

#[tokio::test]
async fn handles_non_json_error_bodies_from_proxies_and_cdns() {
    let u = no_retry(|_, _| resp(502, &[], "<html>Bad gateway</html>"));
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Server(_)));
    assert_eq!((e.status(), e.code()), (Some(502), "internal_error"));
    assert_eq!(e.message(), "<html>Bad gateway</html>");
    assert_eq!(
        e.body(),
        Some(&Value::String("<html>Bad gateway</html>".into()))
    );
    // very long proxy pages are truncated in the message
    let u = no_retry(|_, _| resp(502, &[], "x".repeat(10_000)));
    assert_eq!(u.status().await.unwrap_err().message().len(), 200);
}

#[tokio::test]
async fn handles_an_empty_error_body() {
    let u = no_retry(|_, _| resp(404, &[], ""));
    let e = u.status().await.unwrap_err();
    assert_eq!(
        (e.status(), e.code(), e.message()),
        (Some(404), "http_404", "Not Found")
    );
    let u = no_retry(|_, _| resp(599, &[], ""));
    assert_eq!(u.status().await.unwrap_err().message(), "HTTP 599");
}

#[tokio::test]
async fn error_bodies_with_unexpected_shapes_do_not_break_mapping() {
    for body in [
        json!([1, 2]),
        json!(null),
        json!(5),
        json!(true),
        json!({"error": 5, "code": 7, "reason": [1]}),
        json!({"error": "", "code": ""}),
        json!({"__proto__": {"code": "x"}}),
    ] {
        let b2 = body.clone();
        let u = no_retry(move |_, _| json_resp(b2.clone(), 400));
        let e = u.status().await.unwrap_err();
        assert_eq!(e.status(), Some(400), "{body}");
        assert_eq!(e.code(), "http_400", "{body}");
    }
}

#[tokio::test]
async fn flags_a_200_with_a_non_json_body_as_a_wrong_base_url() {
    for body in ["<!doctype html>hi", "", "not json", "{\"a\":"] {
        let u = no_retry(move |_, _| resp(200, &[], body));
        let e = u.status().await.unwrap_err();
        assert!(matches!(e, Error::Protocol(_)));
        assert_eq!(e.code(), "invalid_response", "{body:?}");
        assert!(e.message().contains("base_url"));
        assert!(!e.is_retryable());
    }
}

#[tokio::test]
async fn describes_connection_failures_with_the_host_and_root_cause() {
    let u = no_retry(|_, _| {
        Reply::Error(TransportError::new(
            TransportErrorKind::Request,
            "dns error: failed to lookup address information",
        ))
    });
    let e = u.send(msg()).await.unwrap_err();
    assert!(matches!(e, Error::Connection(_)));
    assert_eq!(e.code(), "connection_error");
    assert!(
        e.message().contains("unsent.test") && e.message().contains("failed to lookup"),
        "{e}"
    );
    assert!(std::error::Error::source(&e).is_some());
    let u = no_retry(|_, _| {
        Reply::Error(TransportError::new(
            TransportErrorKind::Body,
            "connection closed before message completed",
        ))
    });
    let e = u.status().await.unwrap_err();
    assert!(matches!(e, Error::Connection(_)));
    assert!(
        e.message()
            .contains("Connection dropped while reading the response from /api/status"),
        "{e}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_response_that_is_too_large_is_refused_and_not_retried() {
    let (u, calls) =
        setup(|_, _| Reply::Error(TransportError::new(TransportErrorKind::BodyTooLarge, "big")));
    let e = u.status().await.unwrap_err();
    assert_eq!(e.code(), "response_too_large");
    assert!(matches!(e, Error::Protocol(_)));
    assert_eq!(calls.len(), 1);
    // a transport that ignores the contract is caught too
    let (u, calls) = setup(|_, _| resp(200, &[], vec![b' '; 33 * 1024 * 1024]));
    assert_eq!(u.status().await.unwrap_err().code(), "response_too_large");
    assert_eq!(calls.len(), 1);
    let (u, _) = setup(|_, _| resp(500, &[], vec![b'x'; 33 * 1024 * 1024]));
    assert_eq!(u.status().await.unwrap_err().code(), "response_too_large");
}

#[tokio::test(start_paused = true)]
async fn a_transport_that_followed_a_redirect_is_reported() {
    let (u, calls) = setup(|_, _| {
        Reply::Error(TransportError::new(
            TransportErrorKind::Redirected,
            "followed",
        ))
    });
    let e = u.status().await.unwrap_err();
    assert_eq!(e.code(), "unexpected_redirect");
    assert_eq!(calls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn never_follows_redirects() {
    let (u, calls) = setup(|_, _| {
        resp(
            308,
            &[("Location", "https://elsewhere.test/api/status")],
            "",
        )
    });
    let e = u.status().await.unwrap_err();
    assert!(matches!(e, Error::Protocol(_)));
    assert_eq!(e.code(), "unexpected_redirect");
    assert!(
        e.message().contains("redirected to https://elsewhere.test"),
        "{e}"
    );
    assert_eq!(calls.len(), 1, "not retried");
    for status in [300u16, 301, 302, 303, 304, 307, 308, 399] {
        let (u, calls) = setup(move |_, _| resp(status, &[], ""));
        assert_eq!(
            u.send(msg()).await.unwrap_err().code(),
            "unexpected_redirect",
            "{status}"
        );
        assert_eq!(calls.len(), 1);
    }
}

#[tokio::test]
async fn error_values_can_be_sent_across_threads_and_boxed() {
    let u = no_retry(|_, _| api_error(500, "internal_error", "e", None, &[]));
    let e = u.status().await.unwrap_err();
    let boxed: Box<dyn std::error::Error + Send + Sync> = Box::new(e);
    assert!(boxed.to_string().contains('e'));
    let _: Box<dyn Transport> = Box::new(mock(|_, _| accepted(1)).0);
}
