-- Cultural event group registration: a choreographer/trainer registers a
-- performance group with N participants (dance/singing/drama/speech/
-- other), each individually checked against membership and fee-assessed
-- (member vs. non-member — flat per-event fee pair, not per-option like
-- event_pricing_options, since there's exactly one fee pair to configure).
ALTER TABLE events ADD COLUMN IF NOT EXISTS cultural_member_fee_cents INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cultural_non_member_fee_cents INTEGER;
-- NULL/NULL means cultural registration isn't open for that event.

CREATE TABLE IF NOT EXISTS cultural_groups (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_name              TEXT NOT NULL,
  choreographer_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  choreographer_name      TEXT NOT NULL,
  choreographer_email     TEXT NOT NULL,
  choreographer_phone     TEXT,
  performance_type        TEXT NOT NULL CHECK (performance_type IN ('dance', 'singing', 'drama', 'speech', 'other')),
  description             TEXT,
  amount_cents            INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  status                  TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'registered', 'cancelled')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cultural_groups_event_id ON cultural_groups (event_id);

CREATE TABLE IF NOT EXISTS cultural_group_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES cultural_groups(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  age_category  TEXT NOT NULL CHECK (age_category IN ('adult', 'kid')),
  member_id     UUID REFERENCES members(id) ON DELETE SET NULL,
  is_member     BOOLEAN NOT NULL DEFAULT false,
  fee_cents     INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cultural_group_participants_group_id ON cultural_group_participants (group_id);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_check
  CHECK (purpose IN ('membership', 'event', 'cultural_group'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cultural_group_id UUID REFERENCES cultural_groups(id) ON DELETE SET NULL;
