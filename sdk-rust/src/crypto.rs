//! Hashing, signing and randomness.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::error::Error;

pub(crate) fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub(crate) fn hmac_sha256_hex(secret: &[u8], message: &[u8]) -> String {
    // HMAC accepts keys of any length, so this cannot fail.
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(message);
    hex::encode(mac.finalize().into_bytes())
}

/// `HMAC-SHA256(secret, timestamp + "\n" + nonce + "\n" + SHA256(body))`, lowercase hex.
pub(crate) fn sign_request(secret: &str, timestamp: &str, nonce: &str, body: &[u8]) -> String {
    let body_hash = sha256_hex(body);
    hmac_sha256_hex(
        secret.as_bytes(),
        format!("{timestamp}\n{nonce}\n{body_hash}").as_bytes(),
    )
}

fn random_bytes<const N: usize>() -> Result<[u8; N], Error> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| {
        Error::config_code(
            "entropy_unavailable",
            format!("The operating system random number generator failed: {e}"),
        )
    })?;
    Ok(buf)
}

/// 32 lowercase hex characters from the OS CSPRNG; satisfies the server's `[a-zA-Z0-9_-]{8,128}` nonce rule.
pub(crate) fn random_nonce() -> Result<String, Error> {
    Ok(hex::encode(random_bytes::<16>()?))
}

/// A uniformly distributed value in `[0, 1)`, used for retry jitter.
pub(crate) fn random_unit() -> f64 {
    match random_bytes::<8>() {
        Ok(b) => (u64::from_le_bytes(b) >> 11) as f64 / (1u64 << 53) as f64,
        // Jitter is not security relevant; fall back to the midpoint rather than failing a retry.
        Err(_) => 0.5,
    }
}

/// A random RFC 4122 version 4 UUID, valid as an idempotency key.
pub(crate) fn random_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}
