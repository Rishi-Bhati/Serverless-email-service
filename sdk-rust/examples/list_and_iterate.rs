//! List emails page by page, filter them, and iterate over every match.
//!
//! ```bash
//! UNSENT_BASE_URL=https://unsent.example.com UNSENT_API_KEY=... cargo run --example list_and_iterate
//! ```
//!
//! Without `UNSENT_BASE_URL` it prints the queries it would have run and exits successfully.

use unsent::{Day, EmailStatus, ListEmails, Sort, Unsent};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("UNSENT_BASE_URL")
        .unwrap_or_default()
        .is_empty()
    {
        println!("UNSENT_BASE_URL is not set, so there is nothing to list. The queries this example runs:");
        println!(
            "  list(status=Failed, search=\"invoice\", from=\"2026-01-01\", sort=CreatedAtDesc, limit=25, offset=0)"
        );
        println!("  list(status=Queued, limit=100)  -> second page at offset = page.emails.len()");
        println!("  iterate(search=\"invoice\", limit=50)  -> every match, oldest first");
        println!("  status() / health()");
        return Ok(());
    }

    let client = Unsent::from_env()?;

    // ---- one page of failed invoices ---------------------------------------------------------------
    let today = Day::from(std::time::SystemTime::now());
    let page = client
        .emails()
        .list(
            ListEmails::new()
                .status(EmailStatus::Failed)
                .search("invoice")
                .from("2026-01-01") // YYYY-MM-DD, UTC - or a SystemTime, or `today`
                .to(today)
                .sort(Sort::CreatedAtDesc)
                .limit(25),
        )
        .await?;

    println!(
        "{} of {} failed invoices on this page (limit {}, offset {}, more: {})",
        page.emails.len(),
        page.total,
        page.limit,
        page.offset,
        page.has_more
    );
    for email in &page.emails {
        println!(
            "  #{} {} -> {:?} ({} attempts, last error {:?})",
            email.id, email.subject, email.provider_used, email.attempts, email.error
        );
        if email.is_final() {
            println!("     final: the service will not touch it again");
        }
    }

    // ---- page manually when you need to do work between pages ---------------------------------------
    let mut offset = 0u64;
    loop {
        let page = client
            .emails()
            .list(
                ListEmails::new()
                    .status(EmailStatus::Queued)
                    .limit(100)
                    .offset(offset),
            )
            .await?;
        if page.emails.is_empty() {
            break;
        }
        println!(
            "queued page at offset {offset} has {} emails",
            page.emails.len()
        );
        offset += page.emails.len() as u64;
        if !page.has_more {
            break;
        }
    }

    // ---- iterate every match, page by page, oldest first --------------------------------------------
    // `iterate` fetches pages as needed and defaults to `created_at_asc`, so email sent while you iterate does
    // not shift the pages under you.
    let mut matches = client
        .emails()
        .iterate(ListEmails::new().search("invoice").limit(50));
    let mut seen = 0usize;
    while let Some(email) = matches.next().await {
        let email = email?; // the iterator yields Result<Email, Error>
        seen += 1;
        if seen <= 5 {
            println!("iterate: #{} {}", email.id, email.subject);
        }
    }
    println!("iterate saw {seen} matching email(s)");

    // Whole pages instead of single emails, for batch work:
    let mut pages = client.emails().iterate(ListEmails::new().limit(100));
    let mut batches = 0usize;
    while let Some(batch) = pages.next_page().await? {
        batches += 1;
        println!("batch {batches}: {} emails", batch.len());
    }

    // ---- queue counters and the public health probe -------------------------------------------------
    let queue = client.status().await?;
    println!(
        "queue: {} queued, {} sending, {} sent, {} failed",
        queue.queued, queue.sending, queue.sent, queue.failed
    );

    let health = client.health().await?; // needs no credentials, so it does not verify them
    println!(
        "health: {} runtime={} d1={} at {:?}",
        health.status, health.runtime, health.d1, health.timestamp
    );

    // `get` returns attachment contents too; `list` only returns their metadata.
    if let Some(first) = page.emails.first() {
        let full = client.emails().get(first.id).await?;
        for attachment in &full.attachments {
            match attachment.bytes() {
                Some(Ok(bytes)) => println!(
                    "  attachment {} ({:?}) is {} bytes",
                    attachment.filename,
                    attachment.mime_type,
                    bytes.len()
                ),
                Some(Err(e)) => {
                    println!("  attachment {} is not decodable: {e}", attachment.filename)
                }
                None => println!(
                    "  attachment {} ({}) has no content",
                    attachment.filename, attachment.size
                ),
            }
        }
    }
    Ok(())
}
