-- Volunteer signups from the public site's "Volunteer" tab.
CREATE TABLE IF NOT EXISTS volunteers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  interests  TEXT[] NOT NULL DEFAULT '{}',
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_volunteers_status ON volunteers (status);
CREATE INDEX IF NOT EXISTS idx_volunteers_created_at ON volunteers (created_at DESC);

CREATE TRIGGER volunteers_set_updated_at
  BEFORE UPDATE ON volunteers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
