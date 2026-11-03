-- Migration 0005: Idempotency keys for POST /api/send
-- idempotency_key:  client-supplied key; a repeated key returns the original email instead of queuing again
-- idempotency_hash: SHA-256 of the normalized message, used to reject a reused key with different content
-- SQLite treats NULLs as distinct in a UNIQUE index, so emails sent without a key are unaffected.

ALTER TABLE emails ADD COLUMN idempotency_key TEXT;
ALTER TABLE emails ADD COLUMN idempotency_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_idempotency_key ON emails(idempotency_key);
