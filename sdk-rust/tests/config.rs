//! Client construction: validation, normalization and secret hygiene (SPEC section 1).

mod common;

use std::time::Duration;

use common::*;
use unsent::{Error, SendEmail, Unsent};

fn msg() -> SendEmail {
    SendEmail::builder().to("a@b.co").subject("s").text("t")
}

fn ok_transport() -> MockTransport {
    mock(|_, _| accepted(1)).0
}

fn code_of(r: Result<Unsent, Error>) -> String {
    r.expect_err("expected a config error").code().to_owned()
}

#[test]
fn requires_base_url_and_api_key_with_actionable_messages() {
    let e = Unsent::builder().no_env().api_key("k").build().unwrap_err();
    assert!(matches!(e, Error::Config(_)));
    assert_eq!(e.code(), "invalid_config");
    assert!(
        e.message().contains("base_url") && e.message().contains("UNSENT_BASE_URL"),
        "{e}"
    );
    let e = Unsent::builder()
        .no_env()
        .base_url(BASE)
        .build()
        .unwrap_err();
    assert!(
        e.message().contains("api_key") && e.message().contains("UNSENT_API_KEY"),
        "{e}"
    );
    // whitespace-only values count as missing
    assert!(Unsent::builder()
        .no_env()
        .base_url("  ")
        .api_key("k")
        .build()
        .is_err());
    assert!(Unsent::builder()
        .no_env()
        .base_url(BASE)
        .api_key("\n")
        .build()
        .is_err());
}

#[tokio::test]
async fn from_vars_trims_whitespace_and_reads_all_three_values() {
    // A client built from explicit variables cannot be pointed at the mock, so inspect via a real socket.
    let server = serve(|_, _| {
        Script::Raw(http_bytes(
            202,
            "Accepted",
            &[("Content-Type", "application/json")],
            br#"{"id":1,"status":"queued"}"#,
        ))
    })
    .await;
    let u = Unsent::from_vars([
        ("UNSENT_BASE_URL", format!("{}/\n", server.url())),
        ("UNSENT_API_KEY", format!(" {API_KEY}\n")),
        ("UNSENT_API_SECRET", format!("{API_SECRET}\n")),
    ])
    .unwrap();
    u.send(msg()).await.unwrap();
    let req = server.requests.lock().unwrap()[0].clone();
    assert_eq!(req.target, "/api/send");
    assert_eq!(req.header("X-API-Key"), Some(API_KEY));
    assert!(req.header("X-Signature").is_some());
}

#[test]
fn from_vars_treats_empty_values_as_unset() {
    let e = Unsent::from_vars([("UNSENT_BASE_URL", ""), ("UNSENT_API_KEY", "k")]).unwrap_err();
    assert_eq!(e.code(), "invalid_config");
    assert!(Unsent::from_vars(Vec::<(&str, &str)>::new()).is_err());
    // the secret is optional
    assert!(Unsent::from_vars([
        ("UNSENT_BASE_URL", "https://unsent.test"),
        ("UNSENT_API_KEY", "k"),
        ("UNSENT_API_SECRET", "")
    ])
    .is_ok());
}

#[tokio::test]
async fn keeps_a_path_prefix_and_drops_query_hash_and_trailing_slashes() {
    let (t, calls) = mock(|_, _| accepted(1));
    let u = Unsent::builder()
        .no_env()
        .base_url(format!("{BASE}/mail/?x=1#y"))
        .api_key(API_KEY)
        .transport(t)
        .build()
        .unwrap();
    u.send(msg()).await.unwrap();
    assert_eq!(calls.get(0).url.as_str(), format!("{BASE}/mail/api/send"));
    let (t, calls) = mock(|_, _| accepted(1));
    let u = Unsent::builder()
        .no_env()
        .base_url(format!("  {BASE}///  "))
        .api_key(API_KEY)
        .transport(t)
        .build()
        .unwrap();
    u.send(msg()).await.unwrap();
    assert_eq!(calls.get(0).url.as_str(), format!("{BASE}/api/send"));
}

#[test]
fn rejects_malformed_urls_other_protocols_credentials_and_plain_http_to_remote_hosts() {
    let mk = |url: &str| {
        Unsent::builder()
            .no_env()
            .base_url(url)
            .api_key("k")
            .transport(ok_transport())
            .build()
    };
    let e = mk("not a url").unwrap_err();
    assert!(e.message().contains("not a valid URL"), "{e}");
    assert!(mk("ftp://x.test").unwrap_err().message().contains("https"));
    assert!(mk("http://unsent.example.com")
        .unwrap_err()
        .message()
        .contains("plain http"));
    assert!(mk("https://user:pw@unsent.example.com")
        .unwrap_err()
        .message()
        .contains("credentials"));
    assert!(mk("https://user@unsent.example.com")
        .unwrap_err()
        .message()
        .contains("credentials"));
    assert!(mk("http://localhost.evil.test").is_err());
    assert!(mk("http://127.0.0.2:8787").is_err());
    assert!(mk("http://evil.test/localhost").is_err());
    assert!(mk("javascript:alert(1)").is_err());
    assert!(mk("file:///etc/passwd").is_err());
    assert!(mk("https://").is_err());
    for url in ["not a url", "ftp://x.test", "http://unsent.example.com"] {
        assert_eq!(code_of(mk(url)), "invalid_config");
    }
    // the credentials in the URL are not echoed back
    let leaked = mk("https://user:hunter2hunter2@unsent.example.com").unwrap_err();
    assert!(!format!("{leaked} {leaked:?}").contains("hunter2"));
}

#[test]
fn allows_http_for_loopback_development_servers() {
    for host in [
        "localhost:8787",
        "127.0.0.1:8787",
        "[::1]:8787",
        "app.localhost:8787",
        "LOCALHOST",
    ] {
        let r = Unsent::builder()
            .no_env()
            .base_url(format!("http://{host}"))
            .api_key("k")
            .transport(ok_transport())
            .build();
        assert!(r.is_ok(), "{host}: {:?}", r.err());
    }
}

#[test]
fn validates_timeout_and_max_retries() {
    let base = || {
        Unsent::builder()
            .no_env()
            .base_url(BASE)
            .api_key("k")
            .transport(ok_transport())
    };
    assert_eq!(
        code_of(base().timeout(Duration::ZERO).build()),
        "invalid_config"
    );
    assert_eq!(code_of(base().max_retries(11).build()), "invalid_config");
    assert!(base().max_retries(10).build().is_ok());
    assert!(base().max_retries(0).build().is_ok());
    assert!(base().timeout(Duration::from_nanos(1)).build().is_ok());
    assert!(base().timeout(Duration::MAX).build().is_ok());
}

#[test]
fn rejects_control_and_non_ascii_credentials() {
    let base = || {
        Unsent::builder()
            .no_env()
            .base_url(BASE)
            .transport(ok_transport())
    };
    for bad in [
        "key\r\nX-Evil: 1",
        "ke\ny",
        "ke\0y",
        "k\ty",
        "kéy",
        "🔑",
        "ke\u{7f}y",
        "a\u{85}b",
    ] {
        assert_eq!(
            code_of(base().api_key(bad).build()),
            "invalid_config",
            "{bad:?}"
        );
        assert_eq!(
            code_of(base().api_key("k").api_secret(bad).build()),
            "invalid_config",
            "{bad:?}"
        );
    }
    // surrounding whitespace is trimmed, an interior space is printable ASCII and allowed
    assert!(base()
        .api_key("  key\n")
        .api_secret("\tsecret \r\n")
        .build()
        .is_ok());
    assert!(base().api_key("two words").build().is_ok());
}

#[test]
fn debug_output_never_contains_credentials() {
    let b = Unsent::builder()
        .no_env()
        .base_url(BASE)
        .api_key("SUPER-KEY-123")
        .api_secret("SUPER-SECRET-456")
        .transport(ok_transport());
    let dump = format!("{b:?} {b:#?}");
    assert!(!dump.contains("SUPER"), "{dump}");
    let u = b.build().unwrap();
    for dump in [
        format!("{u:?}"),
        format!("{u:#?}"),
        format!("{:?}", u.emails()),
        format!("{:#?}", u.emails()),
    ] {
        assert!(!dump.contains("SUPER"), "{dump}");
        assert!(dump.contains("***"));
    }
    let secret = unsent::Secret::new("SUPER-KEY-123");
    assert_eq!(format!("{secret}"), "***");
    assert_eq!(format!("{secret:?}"), "Secret(***)");
    assert_eq!(secret.expose(), "SUPER-KEY-123");
}

#[tokio::test]
async fn clones_share_one_client() {
    let (u, calls) = client(|_, _| accepted(1));
    let u2 = u.clone();
    u.send(msg()).await.unwrap();
    u2.send(msg()).await.unwrap();
    assert_eq!(calls.len(), 2);
}

#[test]
fn the_client_is_send_sync_and_futures_are_send() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Unsent>();
    assert_send_sync::<unsent::Emails>();
    assert_send_sync::<Error>();
    assert_send_sync::<unsent::CancellationToken>();
    fn assert_send<T: Send>(_: &T) {}
    let (u, _) = client(|_, _| accepted(1));
    assert_send(&u.send(msg()));
    assert_send(&u.emails().get(1));
    assert_send(&u.emails().list(Default::default()));
    assert_send(&u.emails().wait(1));
    assert_send(&u.status());
    assert_send(&u.health());
}
