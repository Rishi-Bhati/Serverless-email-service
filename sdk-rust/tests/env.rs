//! Environment-variable configuration. These tests mutate the process environment, so they run serially
//! behind a mutex (this file is its own test binary).

mod common;

use std::sync::Mutex;

use common::*;
use unsent::{SendEmail, Unsent};

static ENV_LOCK: Mutex<()> = Mutex::new(());

const VARS: [&str; 3] = ["UNSENT_BASE_URL", "UNSENT_API_KEY", "UNSENT_API_SECRET"];

fn with_env<R>(pairs: &[(&str, &str)], f: impl FnOnce() -> R) -> R {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for v in VARS {
        std::env::remove_var(v);
    }
    for (k, v) in pairs {
        std::env::set_var(k, v);
    }
    let r = f();
    for v in VARS {
        std::env::remove_var(v);
    }
    r
}

#[tokio::test]
async fn from_env_reads_and_trims_the_environment() {
    let server = serve(|_, _| {
        Script::Raw(http_bytes(
            202,
            "Accepted",
            &[("Content-Type", "application/json")],
            br#"{"id":1}"#,
        ))
    })
    .await;
    let url = format!("{}/\n", server.url());
    let u = with_env(
        &[
            ("UNSENT_BASE_URL", &url),
            ("UNSENT_API_KEY", " k-123456\n"),
            ("UNSENT_API_SECRET", "s-123456\n"),
        ],
        || Unsent::from_env().unwrap(),
    );
    u.send(SendEmail::builder().to("a@b.co").subject("s").text("t"))
        .await
        .unwrap();
    let req = server.requests.lock().unwrap()[0].clone();
    assert_eq!(req.header("X-API-Key"), Some("k-123456"));
    assert!(req.header("X-Signature").is_some());
}

#[test]
fn from_env_fails_clearly_when_variables_are_missing_or_empty() {
    let e = with_env(&[], || Unsent::from_env().unwrap_err());
    assert!(e.message().contains("UNSENT_BASE_URL"), "{e}");
    let e = with_env(
        &[
            ("UNSENT_BASE_URL", "https://x.test"),
            ("UNSENT_API_KEY", ""),
        ],
        || Unsent::from_env().unwrap_err(),
    );
    assert!(e.message().contains("UNSENT_API_KEY"), "{e}");
}

#[test]
fn explicit_options_win_over_the_environment() {
    let (t, _) = mock(|_, _| accepted(1));
    let r = with_env(
        &[
            ("UNSENT_BASE_URL", "https://wrong.test"),
            ("UNSENT_API_KEY", "env-key-1234"),
        ],
        || {
            Unsent::builder()
                .base_url(BASE)
                .api_key(API_KEY)
                .transport(t)
                .build()
        },
    );
    assert!(r.is_ok());
    // an invalid environment value is ignored when the explicit one is valid
    let (t, _) = mock(|_, _| accepted(1));
    let r = with_env(
        &[
            ("UNSENT_BASE_URL", "ftp://bad"),
            ("UNSENT_API_KEY", "bad\r\nkey"),
        ],
        || {
            Unsent::builder()
                .base_url(BASE)
                .api_key(API_KEY)
                .transport(t)
                .build()
        },
    );
    assert!(r.is_ok(), "{:?}", r.err());
}

#[tokio::test]
async fn the_builder_falls_back_to_the_environment_for_unset_values() {
    let (t, calls) = mock(|_, _| accepted(1));
    let u = with_env(
        &[
            ("UNSENT_API_KEY", "env-key-1234"),
            ("UNSENT_API_SECRET", "env-secret-1234"),
        ],
        || {
            Unsent::builder()
                .base_url(BASE)
                .transport(t)
                .build()
                .unwrap()
        },
    );
    u.send(SendEmail::builder().to("a@b.co").subject("s").text("t"))
        .await
        .unwrap();
    assert_eq!(calls.get(0).header("X-API-Key"), Some("env-key-1234"));
    assert!(calls.get(0).has("X-Signature"));
}

#[test]
fn no_env_ignores_the_environment() {
    let r = with_env(
        &[
            ("UNSENT_BASE_URL", BASE),
            ("UNSENT_API_KEY", "env-key-1234"),
        ],
        || Unsent::builder().no_env().build(),
    );
    assert!(r.is_err());
}
