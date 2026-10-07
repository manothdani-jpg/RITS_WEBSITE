-- Bylaw / governance documents shown in the homepage "Bylaws" section.
-- Files themselves live in backend/uploads/bylaws/ (not in the database).

CREATE TABLE IF NOT EXISTS bylaw_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  filename      TEXT NOT NULL,         -- stored name inside uploads/bylaws/
  original_name TEXT,                  -- what the admin uploaded it as
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
