-- ============================================================
-- Migration 003: "forgot password" support for members
-- ============================================================

ALTER TABLE members ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;
