-- ============================================================
-- Migration 006: editable homepage content
-- Generic key/value store so new editable fields don't need a
-- schema change — just a new key. Seeded with the text currently
-- hardcoded in index.html so nothing changes until a board member
-- edits it from the admin dashboard.
-- ============================================================

CREATE TABLE IF NOT EXISTS site_content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_site_content_updated_at ON site_content;
CREATE TRIGGER trg_site_content_updated_at
  BEFORE UPDATE ON site_content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO site_content (key, value) VALUES
  ('hero.heading', 'Keeping Tamil language, arts & community alive in Rhode Island'),
  ('hero.tamil_motto', 'வாழ்க தமிழ் · தமிழால் இணைவோம்'),
  ('hero.lede', 'RITS brings together Tamil families across Rhode Island to celebrate our language, culture, and festivals — and to pass that heritage on to the next generation.'),
  ('hero.stat_families', '[#]'),
  ('hero.stat_events_per_year', '[#]'),
  ('hero.stat_founded_year', '[YYYY]'),
  ('about.mission', '[Mission statement placeholder — 2–3 sentences describing RITS''s purpose, who it serves, and what makes the community distinct. Replace with your official mission language.]'),
  ('about.bullet_founded', '[Founded in YYYY by local Tamil families]'),
  ('about.bullet_nonprofit', '[Registered as a 501(c)(3) nonprofit — verify status]'),
  ('about.bullet_serving', '[Serving families across Rhode Island and nearby areas]'),
  ('involve.membership_note', '[Membership fee / tiers]'),
  ('involve.sponsor_note', '[Sponsorship tiers / packet]'),
  ('contact.email', '[info@ritamilsangam.org]'),
  ('contact.phone', '[(401) 000-0000]'),
  ('contact.location', '[Meeting location, Rhode Island]')
ON CONFLICT (key) DO NOTHING;
