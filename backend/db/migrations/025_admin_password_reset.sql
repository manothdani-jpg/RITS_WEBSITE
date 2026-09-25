-- ============================================================
-- Migration 025: "forgot password" support for admin/board logins
-- (mirrors migration 003, which added this for members)
-- ============================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;
