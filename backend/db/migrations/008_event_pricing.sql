-- ============================================================
-- Migration 008: per-event pricing (participation types + add-ons)
-- and paid event registration through Square.
-- ============================================================

-- ---------------------------------------------------------------
-- Admin-defined pricing options per event.
--   kind='participation' — pick exactly one (e.g. "Single" $20, "Team" $75)
--   kind='addon'         — pick zero or more, with a quantity (e.g. "Food" $15/person)
-- No rows for an event = it's free, RSVP works exactly as before.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_pricing_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('participation', 'addon')),
  label         TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_pricing_options_event_id ON event_pricing_options (event_id);

-- ---------------------------------------------------------------
-- What a specific RSVP selected (one participation option, plus
-- zero or more add-ons with quantities).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rsvp_selections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rsvp_id           UUID NOT NULL REFERENCES rsvps(id) ON DELETE CASCADE,
  pricing_option_id UUID NOT NULL REFERENCES event_pricing_options(id) ON DELETE CASCADE,
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsvp_selections_rsvp_id ON rsvp_selections (rsvp_id);

-- ---------------------------------------------------------------
-- rsvps: track the computed total and whether a paid registration
-- has been paid yet. Free RSVPs (amount_cents=0) go straight to
-- 'registered' as before; paid ones sit at 'pending_payment' until
-- the Square webhook confirms.
-- ---------------------------------------------------------------
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0);

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check
  CHECK (status IN ('pending_payment', 'registered', 'attended', 'cancelled', 'no_show'));

-- ---------------------------------------------------------------
-- payments: generalize from "always a membership payment" to
-- optionally an event-registration payment.
-- ---------------------------------------------------------------
ALTER TABLE payments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'membership';
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('membership', 'event'));

ALTER TABLE payments ALTER COLUMN tier DROP NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rsvp_id UUID REFERENCES rsvps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_rsvp_id ON payments (rsvp_id);
