//! Cancel a call with a `CancellationToken`, and cancel by dropping the future.
//!
//! ```bash
//! cargo run --example cancel
//! ```
//!
//! No server is needed: a transport that never answers stands in for a deployment that hangs, so both
//! cancellations are immediate and deterministic.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use unsent::{
    BoxFuture, CancellationToken, Email, Error, RequestOptions, SendEmail, SendResult, Transport,
    TransportError, TransportRequest, TransportResponse, Unsent, WaitOptions,
};

/// A transport that records the request and then never answers.
struct BlackHole {
    calls: Arc<AtomicUsize>,
}

impl Transport for BlackHole {
    fn send<'a>(
        &'a self,
        _request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(std::future::pending()) // never resolves
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let calls = Arc::new(AtomicUsize::new(0));
    let client = Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("example-key-123456")
        .transport(BlackHole {
            calls: calls.clone(),
        })
        .build()?;

    let message = || {
        SendEmail::builder()
            .to("customer@example.com")
            .subject("Hello")
            .html("<p>Hello</p>")
    };

    // ---- 1. cancel from another task (a shutdown signal, a request deadline, ...) ----------------------
    let token = CancellationToken::new();
    let canceller = tokio::spawn({
        let token = token.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            println!("cancelling the send after 50 ms");
            token.cancel();
        }
    });

    let started = Instant::now();
    let result = client
        .emails()
        .send(message().cancellation_token(token.clone()))
        .await;
    report_send("token cancelled mid-flight", &result, started.elapsed());
    canceller.await?;
    println!(
        "token.is_cancelled() = {}; requests attempted so far: {}",
        token.is_cancelled(),
        calls.load(Ordering::SeqCst)
    );

    // An already-cancelled token means the call never starts at all.
    let before = calls.load(Ordering::SeqCst);
    let result = client
        .emails()
        .send(message().cancellation_token(token))
        .await;
    report_send("already-cancelled token", &result, Duration::ZERO);
    assert_eq!(calls.load(Ordering::SeqCst), before, "no request was made");

    // ---- 2. cancel by dropping the future --------------------------------------------------------------
    // Dropping a call's future stops all SDK work for it immediately: no retries, no backoff sleeps.
    let started = Instant::now();
    let dropped =
        tokio::time::timeout(Duration::from_millis(50), client.emails().send(message())).await;
    match dropped {
        Ok(result) => report_send("finished before the deadline", &result, started.elapsed()),
        Err(_elapsed) => println!(
            "future dropped after {:?}: the call is gone and nothing is retried",
            started.elapsed()
        ),
    }

    // ---- 3. reads take per-call options, which carry a token too ---------------------------------------
    let token = CancellationToken::new();
    let options = RequestOptions::new()
        .max_retries(0)
        .cancellation_token(token.clone());
    let reading = client.emails().get_with(1, &options);
    let canceller = tokio::spawn({
        let token = token.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            token.cancel();
        }
    });
    let started = Instant::now();
    report_get("get_with cancelled", &reading.await, started.elapsed());
    canceller.await?;

    // ---- 4. wait() honours a token as well --------------------------------------------------------------
    let token = CancellationToken::new();
    let waiting = client.emails().wait_with(
        1,
        WaitOptions::new()
            .timeout(Duration::from_secs(60))
            .interval(Duration::from_millis(200))
            .cancellation_token(token.clone()),
    );
    let canceller = tokio::spawn({
        let token = token.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(80)).await;
            token.cancel();
        }
    });
    let started = Instant::now();
    report_get("wait() cancelled", &waiting.await, started.elapsed());
    canceller.await?;

    Ok(())
}

fn report_send(label: &str, result: &Result<SendResult, Error>, elapsed: Duration) {
    match result {
        Ok(receipt) => println!("{label} after {elapsed:?}: queued as #{}", receipt.id),
        Err(e) if e.is_aborted() => {
            println!("{label} after {elapsed:?}: {} (code {})", e, e.code());
            assert!(!e.is_retryable(), "an aborted call is never retried");
        }
        Err(e) => println!("{label} after {elapsed:?}: unexpected error {e:?}"),
    }
}

fn report_get(label: &str, result: &Result<Email, Error>, elapsed: Duration) {
    match result {
        Ok(email) => println!(
            "{label} after {elapsed:?}: #{} is {}",
            email.id, email.status
        ),
        Err(e) if e.is_aborted() => {
            println!("{label} after {elapsed:?}: {} (code {})", e, e.code())
        }
        Err(e) => println!("{label} after {elapsed:?}: unexpected error {e:?}"),
    }
}
