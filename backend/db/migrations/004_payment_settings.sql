-- ============================================================
-- Migration 004: customizable payment/dues info page
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_tier_settings (
  tier          TEXT PRIMARY KEY CHECK (tier IN ('individual', 'family', 'lifetime', 'student')),
  amount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payment_tier_settings (tier, amount_cents) VALUES
  ('individual', 0),
  ('family', 0),
  ('lifetime', 0),
  ('student', 0)
ON CONFLICT (tier) DO NOTHING;

-- Singleton row for the page's editable text content.
CREATE TABLE IF NOT EXISTS payment_page_content (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  heading       TEXT NOT NULL DEFAULT 'Membership Dues',
  intro_text    TEXT NOT NULL DEFAULT 'Choose your membership tier below and follow the instructions to submit payment. A board member will confirm receipt and update your status.',
  instructions  TEXT NOT NULL DEFAULT '[Add payment instructions here — e.g. Zelle to treasurer@ritamilsangam.org, check payable to "Rhode Island Tamil Sangam", or cash at any event.]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payment_page_content (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
