-- ============================================================
-- Rhode Island Tamil Sangam — database schema
-- PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;   -- for case-insensitive email columns

-- ---------------------------------------------------------------
-- Admins — two tiers:
--   'superadmin' — can manage board/admin accounts, plus everything a board director can do
--   'board'      — board of directors: manage members, events, RSVPs (not other admin accounts)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'board' CHECK (role IN ('board', 'superadmin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Members (primary/household record)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  email             CITEXT UNIQUE NOT NULL,
  password_hash     TEXT, -- null until the member sets a password (self-signup, or a future "claim account" flow)
  reset_token_hash       TEXT, -- sha256 of an active "forgot password" token; null when none is outstanding
  reset_token_expires_at TIMESTAMPTZ,
  phone             TEXT,
  address_line1     TEXT,
  address_line2     TEXT,
  city              TEXT,
  state             TEXT DEFAULT 'RI',
  zip               TEXT,
  membership_tier   TEXT NOT NULL DEFAULT 'individual',
  payment_status    TEXT NOT NULL DEFAULT 'pending'
                      CHECK (payment_status IN ('pending', 'paid', 'overdue', 'waived')),
  join_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  renewal_date      DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_members_email ON members (email);
CREATE INDEX IF NOT EXISTS idx_members_payment_status ON members (payment_status);

-- ---------------------------------------------------------------
-- Family / household members linked to a primary member
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_name     TEXT,
  relationship  TEXT NOT NULL DEFAULT 'child'
                  CHECK (relationship IN ('spouse', 'child', 'parent', 'other')),
  date_of_birth DATE,
  email         TEXT,
  address_line1 TEXT,
  city          TEXT,
  zip           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_members_member_id ON family_members (member_id);

-- ---------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  event_date    TIMESTAMPTZ NOT NULL,
  location      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_event_date ON events (event_date);

-- ---------------------------------------------------------------
-- RSVPs — links members to events
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rsvps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_count   INTEGER NOT NULL DEFAULT 0 CHECK (guest_count >= 0),
  amount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  status        TEXT NOT NULL DEFAULT 'registered'
                  CHECK (status IN ('pending_payment', 'registered', 'attended', 'cancelled', 'no_show')),
  member_at_registration BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_rsvps_event_id ON rsvps (event_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_member_id ON rsvps (member_id);

-- ---------------------------------------------------------------
-- Per-event pricing options — admin-defined, fully flexible.
--   kind='participation' — pick exactly one (e.g. "Single" $20, "Team" $75)
--   kind='addon'         — pick zero or more, with a quantity (e.g. "Food" $15/person)
-- No rows for an event = it's free, RSVP works exactly as before.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_pricing_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('participation', 'addon')),
  label         TEXT NOT NULL,
  member_amount_cents     INTEGER NOT NULL DEFAULT 0 CHECK (member_amount_cents >= 0),
  non_member_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (non_member_amount_cents >= 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_pricing_options_event_id ON event_pricing_options (event_id);

-- What a specific RSVP selected (one participation option, plus zero or more add-ons with quantities).
CREATE TABLE IF NOT EXISTS rsvp_selections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rsvp_id           UUID NOT NULL REFERENCES rsvps(id) ON DELETE CASCADE,
  pricing_option_id UUID NOT NULL REFERENCES event_pricing_options(id) ON DELETE CASCADE,
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  amount_cents      INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsvp_selections_rsvp_id ON rsvp_selections (rsvp_id);

-- ---------------------------------------------------------------
-- updated_at trigger for members
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_members_updated_at ON members;
CREATE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Membership categories — fully admin-managed (add/rename/archive),
-- each with its own dues amount. Read by the public payment.html page,
-- the membership signup form, and the member portal.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE NOT NULL,
  label         TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER membership_categories_set_updated_at
  BEFORE UPDATE ON membership_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO membership_categories (key, label, amount_cents, display_order) VALUES
  ('individual', 'Individual', 0, 0),
  ('family', 'Family', 0, 1),
  ('student', 'Student', 0, 2),
  ('lifetime', 'Lifetime', 0, 3)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_page_content (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  heading       TEXT NOT NULL DEFAULT 'Membership Dues',
  intro_text    TEXT NOT NULL DEFAULT 'Choose your membership tier below and follow the instructions to submit payment. A board member will confirm receipt and update your status.',
  instructions  TEXT NOT NULL DEFAULT '[Add payment instructions here — e.g. Zelle to treasurer@ritamilsangam.org, check payable to "Rhode Island Tamil Sangam", or cash at any event.]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payment_page_content (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- Payments — tracks Square checkout sessions for dues payments.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id               UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  purpose                 TEXT NOT NULL DEFAULT 'membership' CHECK (purpose IN ('membership', 'event')),
  tier                    TEXT, -- set when purpose='membership'; validated against membership_categories in the app layer
  event_id                UUID REFERENCES events(id) ON DELETE SET NULL, -- set when purpose='event'
  rsvp_id                 UUID REFERENCES rsvps(id) ON DELETE SET NULL,  -- set when purpose='event'
  amount_cents            INTEGER NOT NULL CHECK (amount_cents >= 0),
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
  square_order_id         TEXT,
  square_payment_link_id  TEXT,
  square_payment_id       TEXT,
  pending_selections      JSONB, -- add-on top-up picks, applied on webhook confirm (see payments.routes.js)
  refund_of_payment_id    UUID REFERENCES payments(id) ON DELETE SET NULL, -- set on a status='refunded' row, pointing at the payment it refunded
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_member_id ON payments (member_id);
CREATE INDEX IF NOT EXISTS idx_payments_square_order_id ON payments (square_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_rsvp_id ON payments (rsvp_id);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Site content — editable homepage text, board/superadmin only.
-- Generic key/value store so new editable fields don't need a
-- schema change.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Gallery photos + sponsor logos — uploaded files, served from
-- /uploads/gallery/ and /uploads/sponsors/ respectively.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gallery_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      TEXT NOT NULL,
  caption       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sponsors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  filename      TEXT NOT NULL,
  website_url   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Volunteer signups from the public site's "Volunteer" tab.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Board of Directors roster — public bios (name/title/photo/term
-- years), separate from `admins` (login credentials). term_end_year
-- IS NULL means currently serving.
-- ---------------------------------------------------------------
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
