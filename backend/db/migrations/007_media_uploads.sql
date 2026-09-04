-- ============================================================
-- Migration 007: gallery photos + sponsor logos
-- ============================================================

CREATE TABLE IF NOT EXISTS gallery_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      TEXT NOT NULL, -- served from /uploads/gallery/<filename>
  caption       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sponsors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  filename      TEXT NOT NULL, -- served from /uploads/sponsors/<filename>
  website_url   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
