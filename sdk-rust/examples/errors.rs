//! Handle every kind of failure: bad options, bad arguments, server errors, timeouts, cancellation.
//!
//! ```bash
//! cargo run --example errors
//! ```
//!
//! Nothing here needs a server: the failures shown are raised client-side. `Error` is `#[non_exhaustive]`, so a
//! `match` needs a catch-all arm - which is exactly how you should write production code, too.

use std::time::Duration;

use unsent::{Error, RequestOptions, SendEmail, Unsent};

/// A short, stable description of an error. Branch on `code()`, never on the message.
fn describe(err: &Error) -> String {
    let mut out = format!("code={} status={:?}", err.code(), err.status());
    if let Some(reason) = err.reason() {
        out.push_str(&format!(" reason={reason:?}"));
    }
    if let Some(hint) = err.hint() {
        out.push_str(&format!(" hint={hint:?}"));
    }
    if let Some(wait) = err.retry_after() {
        out.push_str(&format!(" retry_after={wait:?}"));
    }
    if let Some(id) = err.existing_email_id() {
        out.push_str(&format!(" existing_email_id={id}"));
    }
    out.push_str(&format!(
        " retryable={} timeout={} aborted={}",
        err.is_retryable(),
        err.is_timeout(),
        err.is_aborted()
    ));
    out
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // ---- configuration errors: raised by `build()`, before any client exists -------------------------------
    // Missing credentials.
    report(
        "missing base_url",
        Unsent::builder().no_env().api_key("k").build().err(),
    );

    // Plain http to a remote host would leak the key, so it is refused (loopback is allowed for local dev).
    report(
        "plain http to a remote host",
        Unsent::builder()
            .no_env()
            .base_url("http://unsent.example.com")
            .api_key("key-123456")
            .build()
            .err(),
    );

    // A control character or non-ASCII byte in a credential would end up in a header.
    report(
        "credential with a newline",
        Unsent::builder()
            .no_env()
            .base_url("https://unsent.test")
            .api_key("key\r\nX-Evil: 1")
            .build()
            .err(),
    );

    // A client for the rest of the example. It never reaches the network: every call below fails client-side.
    let client = Unsent::builder()
        .no_env()
        .base_url("https://unsent.test")
        .api_key("example-key-123456")
        .api_secret("example-secret-123456")
        .max_retries(0)
        .build()?;

    // ---- validation errors: raised before any request is made ----------------------------------------------
    for (label, email) in [
        (
            "no recipients",
            SendEmail::builder().subject("Hi").html("<p>Hi</p>"),
        ),
        (
            "a recipient without @",
            SendEmail::builder()
                .to("not-an-address")
                .subject("Hi")
                .html("<p>Hi</p>"),
        ),
        (
            "header injection in a recipient",
            SendEmail::builder()
                .to("a@b.co\r\nBcc: victim@c.co")
                .subject("Hi")
                .html("<p>Hi</p>"),
        ),
        ("no body", SendEmail::builder().to("a@b.co").subject("Hi")),
        (
            "a key with a space",
            SendEmail::builder()
                .to("a@b.co")
                .subject("Hi")
                .html("<p>Hi</p>")
                .idempotency_key("not a valid key"),
        ),
    ] {
        report(label, client.emails().send(email).await.err());
    }

    // A message the server would have to reject because it is too large is caught here first.
    report(
        "oversized message",
        client
            .emails()
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("Big")
                    .html("<p>Big</p>")
                    .attachment(unsent::Attachment::from_bytes(
                        "big.bin",
                        vec![0u8; 3_000_000],
                    )),
            )
            .await
            .err(),
    );

    // Per-call options are validated like the client options.
    report(
        "zero timeout",
        client
            .emails()
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("Hi")
                    .html("<p>Hi</p>")
                    .timeout(Duration::ZERO),
            )
            .await
            .err(),
    );
    report(
        "11 retries",
        client
            .emails()
            .get_with(1, &RequestOptions::new().max_retries(11))
            .await
            .err(),
    );

    // ---- cancellation --------------------------------------------------------------------------------------
    let token = unsent::CancellationToken::new();
    token.cancel();
    report(
        "an already-cancelled call",
        client
            .emails()
            .send(
                SendEmail::builder()
                    .to("a@b.co")
                    .subject("Hi")
                    .html("<p>Hi</p>")
                    .cancellation_token(token),
            )
            .await
            .err(),
    );

    println!("\nEvery one of these was decided by the SDK alone; no request left the process.");
    println!(
        "Unset UNSENT_BASE_URL and build with `Unsent::from_env()` to see server-side errors too."
    );
    Ok(())
}

fn report(label: &str, err: Option<Error>) {
    match err {
        Some(e) => println!("{label:<32} -> {}\n{:33}{}", e, "", describe(&e)),
        None => println!("{label:<32} -> expected an error, got none"),
    }
}
