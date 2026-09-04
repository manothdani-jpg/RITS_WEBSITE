-- Lets a member reduce or remove an add-on they already paid for, issuing
-- a real Square refund for the difference. A refund is recorded as its
-- own payments row (status='refunded', linked back to the payment it
-- refunded via refund_of_payment_id) rather than mutating the original
-- completed payment, preserving a full audit trail.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded'));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_of_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

-- Pre-existing bug fix, unrelated to refunds: this constraint still
-- restricted membership dues payments to the old fixed 4 tiers, even
-- though migration 013 made membership categories admin-flexible — a
-- member on a custom category would fail to check out for dues.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_tier_check;
