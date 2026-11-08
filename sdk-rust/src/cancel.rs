//! Cooperative cancellation for in-flight calls.

use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::task::Poll;

use tokio::sync::watch;

/// A cloneable cancellation handle.
///
/// Pass a token to a call (for example [`SendEmail::cancellation_token`](crate::SendEmail::cancellation_token));
/// calling [`cancel`](CancellationToken::cancel) from anywhere aborts that call immediately, including while it
/// sleeps between retries, and the call fails with [`Error::Aborted`](crate::Error::Aborted) without further
/// attempts. Dropping the future of a call is the other way to cancel: it also stops all work.
#[derive(Clone, Debug)]
pub struct CancellationToken {
    tx: Arc<watch::Sender<bool>>,
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancellationToken {
    /// Create a token that is not cancelled.
    pub fn new() -> Self {
        let (tx, _rx) = watch::channel(false);
        CancellationToken { tx: Arc::new(tx) }
    }

    /// Cancel every call that holds a clone of this token. Idempotent.
    pub fn cancel(&self) {
        self.tx.send_replace(true);
    }

    /// Whether [`cancel`](CancellationToken::cancel) has been called.
    pub fn is_cancelled(&self) -> bool {
        *self.tx.borrow()
    }

    /// Resolves once the token is cancelled (immediately if it already is).
    pub async fn cancelled(&self) {
        let mut rx = self.tx.subscribe();
        // The sender is owned by `self`, so the channel cannot close while we wait.
        let _ = rx.wait_for(|cancelled| *cancelled).await;
    }
}

/// The marker returned when a [`CancellationToken`] fires first.
pub(crate) struct Cancelled;

/// Drive `fut` unless `cancel` fires first. Cancellation is checked before the future on every poll, so an
/// already-cancelled token never starts any work.
pub(crate) async fn race_cancel<F: Future>(
    fut: F,
    cancel: Option<&CancellationToken>,
) -> Result<F::Output, Cancelled> {
    let Some(token) = cancel else {
        return Ok(fut.await);
    };
    let mut fut = pin!(fut);
    let mut cancelled = pin!(token.cancelled());
    std::future::poll_fn(move |cx| {
        if cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(Cancelled));
        }
        match fut.as_mut().poll(cx) {
            Poll::Ready(v) => Poll::Ready(Ok(v)),
            Poll::Pending => Poll::Pending,
        }
    })
    .await
}
