//! An axum handler that sends a welcome email, plus a unit test of the handler itself.
//!
//! ```bash
//! cargo run --example axum_handler
//! ```
//!
//! The example builds the router, then drives the handlers directly with a fake `Transport` — no socket, no
//! network, no deployment. That is the pattern to use in your own `#[tokio::test]`s.
//!
//! In a real service, build the client once at startup with `Unsent::from_env()?`, put it in the router state and
//! serve the router with `axum::serve(listener, app)`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::to_bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use unsent::{
    Attachment, BoxFuture, Error, SendEmail, Transport, TransportError, TransportRequest,
    TransportResponse, Unsent,
};

/// One client for the whole process: it is `Clone + Send + Sync` and shares one connection pool.
#[derive(Clone)]
struct AppState {
    unsent: Unsent,
}

#[derive(Debug, Deserialize)]
struct Signup {
    email: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct Accepted {
    id: i64,
    status: String,
}

#[derive(Debug, Serialize)]
struct Failed {
    code: String,
    message: String,
}

/// Queue a welcome email. `SendEmail` validates everything client-side, so a bad address never reaches the
/// network, and the stable idempotency key means a browser retry or a proxy replay cannot send a second welcome.
async fn signup(State(state): State<AppState>, Json(body): Json<Signup>) -> Response {
    let greeting = match &body.name {
        Some(name) => format!("<p>Hello {name}, your account is ready.</p>"),
        None => "<p>Your account is ready.</p>".to_owned(),
    };
    let email = SendEmail::builder()
        .to(body.email.clone())
        .subject("Welcome to Acme")
        .html(greeting)
        .idempotency_key(format!("welcome:{}", body.email));

    match state.unsent.emails().send(email).await {
        Ok(receipt) => (
            StatusCode::ACCEPTED,
            Json(Accepted {
                id: receipt.id,
                status: receipt.status.to_string(),
            }),
        )
            .into_response(),
        // Their problem: the caller can fix the input.
        Err(e @ Error::Validation(_)) | Err(e @ Error::Request(_)) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(Failed {
                code: e.code().to_owned(),
                message: e.to_string(),
            }),
        )
            .into_response(),
        // Our problem. The message never contains credentials.
        Err(e) => {
            eprintln!(
                "welcome email failed: {} (status {:?}, retryable {})",
                e,
                e.status(),
                e.is_retryable()
            );
            (
                StatusCode::BAD_GATEWAY,
                Json(Failed {
                    code: e.code().to_owned(),
                    message: "could not queue the email, try again later".to_owned(),
                }),
            )
                .into_response()
        }
    }
}

/// Send an invoice with the PDF attached.
async fn invoice(State(state): State<AppState>, Json(body): Json<Signup>) -> Response {
    let pdf = Attachment::from_bytes("invoice.pdf", b"%PDF-1.4 example".to_vec())
        .content_type("application/pdf");
    let email = SendEmail::builder()
        .to(body.email.clone())
        .subject("Your invoice")
        .html("<p>Your invoice is attached.</p>")
        .attachment(pdf)
        .idempotency_key(format!("invoice:{}", body.email));

    match state.unsent.emails().send(email).await {
        Ok(receipt) => (
            StatusCode::ACCEPTED,
            Json(Accepted {
                id: receipt.id,
                status: receipt.status.to_string(),
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(Failed {
                code: e.code().to_owned(),
                message: e.to_string(),
            }),
        )
            .into_response(),
    }
}

fn router(unsent: Unsent) -> Router {
    Router::new()
        .route("/signup", post(signup))
        .route("/invoice", post(invoice))
        .with_state(AppState { unsent })
}

/// A fake deployment: always accepts the email, and counts the requests it saw.
#[derive(Clone, Default)]
struct Accepting(Arc<AtomicUsize>);

impl Transport for Accepting {
    fn send<'a>(
        &'a self,
        _request: TransportRequest,
    ) -> BoxFuture<'a, Result<TransportResponse, TransportError>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            Ok(TransportResponse::new(
                202,
                vec![("Content-Type".into(), "application/json".into())],
                r#"{"success":true,"id":4321,"status":"queued","targetProvider":"SMTP"}"#,
            ))
        })
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let accepting = Accepting::default();
    let client = Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("example-key-123456")
        .transport(accepting.clone())
        .build()?;

    // The router a real service would serve.
    let app = router(client.clone());
    println!("router built; mount it with `axum::serve(listener, app)`");
    drop(app); // nothing binds a port in this example

    // Handlers are plain async functions, so they can be called directly in a test.
    let response = signup(
        State(AppState {
            unsent: client.clone(),
        }),
        Json(Signup {
            email: "new-user@example.com".to_owned(),
            name: Some("Ada".to_owned()),
        }),
    )
    .await;
    println!("POST /signup -> {}", response.status());
    let bytes = to_bytes(response.into_body(), 64 * 1024).await?;
    println!("  body: {}", String::from_utf8_lossy(&bytes));

    let response = invoice(
        State(AppState { unsent: client }),
        Json(Signup {
            email: "customer@example.com".to_owned(),
            name: None,
        }),
    )
    .await;
    println!("POST /invoice -> {}", response.status());

    // A bad address is rejected locally: the response is a 422 and no request was made.
    let before = accepting.0.load(Ordering::SeqCst);
    let client = Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("example-key-123456")
        .transport(accepting.clone())
        .build()?;
    let response = signup(
        State(AppState { unsent: client }),
        Json(Signup {
            email: "not-an-address".to_owned(),
            name: None,
        }),
    )
    .await;
    println!("POST /signup (bad address) -> {}", response.status());
    let bytes = to_bytes(response.into_body(), 64 * 1024).await?;
    println!("  body: {}", String::from_utf8_lossy(&bytes));
    assert_eq!(
        accepting.0.load(Ordering::SeqCst),
        before,
        "nothing was sent for invalid input"
    );

    println!("\n{} request(s) reached the fake deployment", before);
    Ok(())
}
