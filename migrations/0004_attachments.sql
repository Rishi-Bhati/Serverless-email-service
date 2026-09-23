-- Migration 0004: Add separate text_body and attachments_json columns to emails
-- text_body: plain-text alternative body (multipart/alternative alongside html)
-- attachments_json: JSON array of { filename, content (base64), mimeType } objects

ALTER TABLE emails ADD COLUMN text_body TEXT;
ALTER TABLE emails ADD COLUMN attachments_json TEXT;
