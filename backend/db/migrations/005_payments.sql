-- ============================================================
-- Migration 005: Square payment tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id               UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tier                    TEXT NOT NULL CHECK (tier IN ('individual', 'family', 'lifetime', 'student')),
  amount_cents            INTEGER NOT NULL CHECK (amount_cents >= 0),
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  square_order_id         TEXT,
  square_payment_link_id  TEXT,
  square_payment_id       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_member_id ON payments (member_id);
CREATE INDEX IF NOT EXISTS idx_payments_square_order_id ON payments (square_order_id);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
