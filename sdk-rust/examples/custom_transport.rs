//! Test against a fake server by injecting a `Transport` — no sockets, no network.
//!
//! ```bash
//! cargo run --example custom_transport
//! ```
//!
//! A transport only moves bytes: signing, retries, timeouts and error mapping all still happen in the SDK, so the
//! request a transport records is byte-for-byte what a real deployment would receive.

use std::sync::{Arc, Mutex};

use serde_json::json;
use unsent::{
    BoxFuture, Error, Method, SendEmail, Transport, TransportError, TransportErrorKind,
    TransportRequest, TransportResponse, Unsent,
};

/// One scripted reply.
#[derive(Clone)]
enum Reply {
    Response(TransportResponse),
    Failure(TransportErrorKind, String),
}

/// Replies from a queue of scripted replies and keeps every request it saw. Once the script is exhausted the
/// last reply is repeated, which is what makes the retry case below terminate.
#[derive(Clone, Default)]
struct Fake {
    seen: Arc<Mutex<Vec<TransportRequest>>>,
    script: Arc<Mutex<Vec<Reply>>>,
}

impl Fake {
    fn new() -> Self {
        Fake::default()
    }

    fn json(self, status: u16, body: serde_json::Value) -> Self {
        self.respond(
            status,
            vec![("Content-Type".into(), "application/json".into())],
            body.to_string(),
        )
    }

    fn respond(
        self,
        status: u16,
        headers: Vec<(String, String)>,
        body: impl Into<Vec<u8>>,
    ) -> Self {
        self.script
            .lock()
            .unwrap()
            .push(Reply::Response(TransportResponse::new(
                status, headers, body,
            )));
        self
    }

    fn fail(self, message: &str) -> Self {
        self.script.lock().unwrap().push(Reply::Failure(
            TransportErrorKind::Request,
            message.to_owned(),
        ));
        self
    }

    fn requests(&self) -> Vec<TransportRequest> {
        self.seen.lock().unwrap().clone()
    }
}

impl Transport for Fake {
    fn send<'a>(
        &'a self,
        request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
        self.seen.lock().unwrap().push(request);
        let next = {
            let mut script = self.script.lock().unwrap();
            if script.len() > 1 {
                Some(script.remove(0))
            } else {
                script.first().cloned()
            }
        };
        Box::pin(async move {
            match next {
                Some(Reply::Response(response)) => Ok(response),
                Some(Reply::Failure(kind, message)) => Err(TransportError::new(kind, message)),
                // An empty script means "never answer", which is useful for timeout and cancellation tests.
                None => std::future::pending().await,
            }
        })
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let message = || {
        SendEmail::builder()
            .to("customer@example.com")
            .subject("Hello")
            .html("<p>Hello</p>")
    };

    // ---- 1. a 202, as a healthy deployment answers ------------------------------------------------------
    let fake = Fake::new().json(
        202,
        json!({"success": true, "id": 1234, "status": "queued", "targetProvider": "SMTP"}),
    );
    let client = Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("test-key-123456")
        .api_secret("test-secret-123456")
        .transport(fake.clone())
        .build()?;

    let receipt = client.emails().send(message()).await?;
    println!(
        "1. queued as #{} via {}",
        receipt.id, receipt.target_provider
    );

    let request = &fake.requests()[0];
    println!("   {} {}", request.method.as_str(), request.url);
    println!("   signed: {:?}", request.header("X-Signature"));
    println!("   nonce:  {:?}", request.header("X-Nonce"));
    println!(
        "   body:   {}",
        String::from_utf8_lossy(request.body.as_deref().unwrap_or_default())
    );
    assert_eq!(request.method, Method::Post);
    assert!(
        request.header("X-Signature").is_some(),
        "the SDK signed the request for us"
    );
    assert!(
        request.header("Idempotency-Key").is_none(),
        "the key travels inside the signed body, never in a header"
    );

    // ---- 2. a 409 conflict: the key was reused with different content ---------------------------------
    let fake = Fake::new().json(
        409,
        json!({"error": "Idempotency key conflict", "code": "idempotency_key_conflict", "id": 99}),
    );
    let client = fake_client(fake)?;
    match client
        .emails()
        .send(message().idempotency_key("order-123:receipt"))
        .await
    {
        Err(e @ Error::Conflict(_)) => println!(
            "2. conflict: code={} existing_email_id={:?} hint={:?}",
            e.code(),
            e.existing_email_id(),
            e.hint()
        ),
        other => println!("2. unexpected result: {other:?}"),
    }

    // ---- 3. a 503 with Retry-After is retried, then succeeds -------------------------------------------
    // The script is consumed in order: the first attempt gets the 503, the retry gets the 202.
    let fake = Fake::new()
        .respond(
            503,
            vec![
                ("Content-Type".into(), "application/json".into()),
                ("Retry-After".into(), "0".into()),
            ],
            json!({"error": "overloaded", "code": "internal_error"}).to_string(),
        )
        .json(202, json!({"id": 7, "status": "queued"}));
    let client = fake_client(fake.clone())?;
    let receipt = client.emails().send(message()).await?;
    println!(
        "3. {} attempt(s), queued as #{}",
        fake.requests().len(),
        receipt.id
    );

    // ---- 4. a connection failure, mapped to Error::Connection ------------------------------------------
    let fake = Fake::new().fail("connection reset by peer");
    let client = fake_client(fake)?;
    match client.emails().send(message()).await {
        Err(e) => println!(
            "4. connection error: code={} retryable={} message={}",
            e.code(),
            e.is_retryable(),
            e
        ),
        Ok(receipt) => println!("4. unexpected success: #{}", receipt.id),
    }

    // ---- 5. a 200 that is not JSON, e.g. an HTML login page --------------------------------------------
    let fake = Fake::new().respond(
        200,
        vec![("Content-Type".into(), "text/html".into())],
        "<html>not unsent</html>",
    );
    let client = fake_client(fake)?;
    match client.emails().get(1).await {
        Err(e) => println!("5. not an Unsent deployment: code={} ({})", e.code(), e),
        Ok(email) => println!("5. unexpected success: #{}", email.id),
    }

    // ---- 6. a redirect is never followed ---------------------------------------------------------------
    let fake = Fake::new().respond(
        302,
        vec![("Location".into(), "https://elsewhere.test/api/send".into())],
        Vec::new(),
    );
    let client = fake_client(fake)?;
    match client.emails().send(message()).await {
        Err(e) => println!("6. redirect refused: code={} ({})", e.code(), e),
        Ok(receipt) => println!("6. unexpected success: #{}", receipt.id),
    }

    Ok(())
}

fn fake_client(transport: Fake) -> Result<Unsent, unsent::Error> {
    Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("test-key-123456")
        .api_secret("test-secret-123456")
        .max_retries(1)
        .transport(transport)
        .build()
}
