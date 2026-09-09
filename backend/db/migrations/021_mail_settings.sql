-- SMTP configuration, editable from the admin dashboard (Admin Logins tab,
-- superadmin-only) instead of only via the backend's .env file. The
-- password is encrypted at rest (see src/crypto.js) using ENCRYPTION_KEY
-- from .env — never stored or returned in plain text.
CREATE TABLE IF NOT EXISTS mail_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host            TEXT,
  smtp_port            INTEGER NOT NULL DEFAULT 587,
  smtp_secure          BOOLEAN NOT NULL DEFAULT false,
  smtp_user            TEXT,
  smtp_pass_encrypted  TEXT,
  from_address         TEXT NOT NULL DEFAULT 'RITS <no-reply@ritamilsangam.org>',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mail_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_mail_settings_updated_at ON mail_settings;
CREATE TRIGGER trg_mail_settings_updated_at
  BEFORE UPDATE ON mail_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
