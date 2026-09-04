-- Public "Board of Directors" roster (name/title/photo/term years),
-- separate from the `admins` table (which is login credentials, not
-- public bios). term_end_year IS NULL means currently serving.
CREATE TABLE IF NOT EXISTS board_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  title           TEXT NOT NULL,
  photo_filename  TEXT,
  term_start_year INTEGER NOT NULL,
  term_end_year   INTEGER,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_profiles_current ON board_profiles ((term_end_year IS NULL));

CREATE TRIGGER board_profiles_set_updated_at
  BEFORE UPDATE ON board_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
