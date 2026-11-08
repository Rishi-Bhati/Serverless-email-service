//! Attach files from raw bytes, from a base64 string and from disk.
//!
//! ```bash
//! cargo run --example attachments            # builds the message, sends nothing
//! UNSENT_BASE_URL=... UNSENT_API_KEY=... cargo run --example attachments
//! ```
//!
//! The service stores the body and the attachments in one database row, so keep the total under about
//! **1.4 MB of raw attachment data**; larger messages are rejected with `413 payload_too_large`.

use std::io::Write as _;

use unsent::{Attachment, Error, SendEmail, Unsent};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Raw bytes: the SDK base64-encodes them for you. `&str`, `[u8; N]` and `Vec<u8>` all work.
    let csv = Attachment::from_bytes("report.csv", "id,total\n1,9\n2,4\n").content_type("text/csv");

    // A typed binary payload.
    let binary = Attachment::from_bytes("payload.bin", [0u8, 1, 2, 250, 255])
        .content_type("application/octet-stream");

    // Content that is *already* base64 (whitespace is ignored, but it must be valid and padded).
    let hello = Attachment::from_base64("hello.txt", "aGVsbG8=").content_type("text/plain");

    // A file on disk: the name comes from the path and the MIME type from its extension.
    let path = std::env::temp_dir().join(format!("unsent-example-{}.txt", std::process::id()));
    std::fs::File::create(&path)?.write_all(b"written by examples/attachments.rs\n")?;
    let from_disk = Attachment::from_path(&path)?.filename("notes.txt");
    let _ = std::fs::remove_file(&path);

    let email = SendEmail::builder()
        .to("customer@example.com")
        .subject("Your attachments")
        .html("<p>Everything is attached.</p>")
        .attachments([csv, binary, hello, from_disk]);

    // Debug shows the filename, the MIME type and the content *length* - never the content itself.
    println!("{email:#?}");

    let client = client()?;

    // Non-base64 text is a validation error, caught before any request is made.
    let bad = SendEmail::builder()
        .to("customer@example.com")
        .subject("Bad")
        .html("<p>Bad</p>")
        .attachment(Attachment::from_base64("notes.txt", "this is not base64"));
    match client.emails().send(bad).await {
        Err(e @ Error::Validation(_)) => {
            println!("\nrejected before sending, as expected ({}): {e}", e.code());
        }
        other => println!("\nunexpected result: {other:?}"),
    }

    if std::env::var("UNSENT_BASE_URL")
        .unwrap_or_default()
        .is_empty()
    {
        println!("\nUNSENT_BASE_URL is not set, so nothing was sent.");
        return Ok(());
    }
    let receipt = client.emails().send(email).await?;
    println!("queued as #{}", receipt.id);
    Ok(())
}

/// The real client when a deployment is configured; otherwise one that fails validation before it ever
/// touches the network, so the example runs anywhere.
fn client() -> Result<Unsent, unsent::Error> {
    if std::env::var("UNSENT_BASE_URL")
        .unwrap_or_default()
        .is_empty()
    {
        return Unsent::builder()
            .no_env()
            .base_url("https://unsent.test")
            .api_key("example-key")
            .build();
    }
    Unsent::from_env()
}
