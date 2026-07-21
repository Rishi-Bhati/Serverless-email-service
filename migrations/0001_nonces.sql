-- Migration: Nonce store for replay attack prevention

CREATE TABLE IF NOT EXISTS used_nonces (
  nonce     TEXT    PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Index for fast expiry sweeps
CREATE INDEX IF NOT EXISTS idx_nonces_expires ON used_nonces(expires_at);
