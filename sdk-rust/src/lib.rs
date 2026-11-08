//! # unsent
//!
//! The official Rust client for your self-hosted Unsent email service.
//!
//! * **Three lines to send.** HMAC signing, nonces, timestamps and base64 are handled for you.
//! * **Safe retries.** Every send carries an idempotency key, so network errors and 5xx responses are retried
//!   automatically without ever sending the same email twice.
//! * **Async** on `tokio` + `reqwest` (rustls). No `unsafe` code.
//!
//! ```no_run
//! use unsent::{SendEmail, Unsent};
//!
//! # async fn run() -> Result<(), unsent::Error> {
//! let client = Unsent::from_env()?; // UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET
//!
//! let receipt = client
//!     .emails()
//!     .send(
//!         SendEmail::builder()
//!             .to("customer@example.com")
//!             .subject("Welcome!")
//!             .html("<h1>Hello</h1><p>Your account is ready.</p>"),
//!     )
//!     .await?;
//!
//! let email = client.emails().wait(receipt.id).await?; // polls until delivered
//! println!("{} via {:?}", email.status, email.provider_used);
//! # Ok(())
//! # }
//! ```
//!
//! See the crate README for the full guide: attachments, idempotency, error handling, cancellation, and recipes
//! for axum and actix-web.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

mod address;
mod attachment;
mod cancel;
mod client;
mod config;
mod crypto;
mod error;
mod http;
mod mapping;
mod secret;
mod send;
mod time;
mod transport;
mod types;

pub use address::Address;
pub use attachment::Attachment;
pub use cancel::CancellationToken;
pub use client::{EmailIter, Emails, Unsent};
pub use config::UnsentBuilder;
pub use error::{Error, ErrorInfo};
pub use secret::Secret;
pub use send::SendEmail;
pub use transport::{
    BoxFuture, Method, Transport, TransportError, TransportErrorKind, TransportRequest,
    TransportResponse, MAX_RESPONSE_BYTES,
};
pub use types::{
    AttachmentInfo, Day, Email, EmailPage, EmailStatus, FailoverAttempt, Health, ListEmails,
    QueueStatus, RequestOptions, SendResult, Sort, WaitOptions, MAX_DELIVERY_ATTEMPTS,
};

/// The SDK version, also sent in the `User-Agent` header (`unsent-sdk-rust/<version>`).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
