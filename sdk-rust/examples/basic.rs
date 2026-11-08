//! Send one email and wait for it to be delivered.
//!
//! ```bash
//! UNSENT_BASE_URL=https://unsent.example.com UNSENT_API_KEY=... UNSENT_API_SECRET=... \
//!     cargo run --example basic
//! ```
//!
//! Without `UNSENT_BASE_URL` the example prints the message it would have sent and exits successfully, so it can
//! be run anywhere.

use std::time::Duration;

use unsent::{EmailStatus, SendEmail, Unsent, WaitOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let email = SendEmail::builder()
        .to("customer@example.com")
        .subject("Welcome!")
        .html("<h1>Hello</h1><p>Your account is ready.</p>")
        .text("Hello, your account is ready.")
        // A stable key means a retry of this example never sends a second copy.
        .idempotency_key("example-basic-welcome");

    println!("{email:#?}");

    if std::env::var("UNSENT_BASE_URL")
        .unwrap_or_default()
        .is_empty()
    {
        println!("\nUNSENT_BASE_URL is not set, so nothing was sent.");
        println!("Export UNSENT_BASE_URL, UNSENT_API_KEY and (unless the server is api-key-only)");
        println!("UNSENT_API_SECRET to send this message for real.");
        return Ok(());
    }

    // One client per process: it owns the connection pool and any learned clock correction, and is cheap to clone.
    let client = Unsent::from_env()?;

    // `send` returns as soon as the service has accepted the email (HTTP 202); delivery happens in the background.
    let receipt = client.emails().send(email).await?;
    println!(
        "queued as #{} ({}) for {}",
        receipt.id, receipt.status, receipt.target_provider
    );
    if receipt.idempotent_replay {
        println!("this key had already been used, so the earlier email was returned");
    }

    // Poll until the email is final (`sent`, or `failed` after all delivery attempts).
    let delivered = client
        .emails()
        .wait_with(
            receipt.id,
            WaitOptions::new()
                .timeout(Duration::from_secs(30))
                .interval(Duration::from_millis(250)),
        )
        .await?;

    if delivered.status == EmailStatus::Sent {
        println!(
            "delivered via {} in {} attempt(s)",
            delivered.provider_used.as_deref().unwrap_or("-"),
            delivered.attempts
        );
    } else {
        // A permanent delivery failure is a normal return value, not an error.
        println!("not delivered: {:?}", delivered.error);
        for attempt in &delivered.failover_history {
            println!(
                "  {} ({}) -> {}",
                attempt.provider, attempt.kind, attempt.error
            );
        }
    }
    Ok(())
}
