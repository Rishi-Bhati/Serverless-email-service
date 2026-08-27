-- Migration: Multi-provider support, priority ordering, and failover tracking

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'smtp', 'resend', 'sendgrid', 'mailgun', 'postmark'
  credentials_json TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  daily_sent_count INTEGER NOT NULL DEFAULT 0,
  last_reset_date TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_active_priority ON providers(is_active, priority);
CREATE INDEX IF NOT EXISTS idx_providers_from_email ON providers(from_email);

-- Add provider and failover columns to emails table
ALTER TABLE emails ADD COLUMN from_email TEXT;
ALTER TABLE emails ADD COLUMN from_name TEXT;
ALTER TABLE emails ADD COLUMN provider_id TEXT;
ALTER TABLE emails ADD COLUMN provider_used TEXT;
ALTER TABLE emails ADD COLUMN failover_history TEXT;
