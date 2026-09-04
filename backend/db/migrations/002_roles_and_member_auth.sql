-- ============================================================
-- Migration 002: admin roles (superadmin/board) + member login
-- Run once against an existing database that was created before
-- this migration (fresh installs get this via schema.sql instead).
-- ============================================================

-- Rename the old generic 'admin' role to 'board' (board of directors).
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
UPDATE admins SET role = 'board' WHERE role = 'admin';
ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'board';
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('board', 'superadmin'));

-- Members can now log in with their own password (set at signup).
-- Nullable: members added manually by the board (not via public signup)
-- won't have one until they self-register or a future "claim account" flow exists.
ALTER TABLE members ADD COLUMN IF NOT EXISTS password_hash TEXT;
