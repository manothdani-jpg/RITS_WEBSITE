-- Per-membership-category renewal rule, so how a member's expiry date is
-- calculated on payment can be configured by the board instead of always
-- being "exactly 1 year from the payment date":
--   'rolling'    — renewal_months from the date payment is received.
--   'fixed_date' — the next occurrence of renewal_month/renewal_day on or
--                  after the payment date (e.g. everyone's membership
--                  expires Dec 31 regardless of when they paid).
ALTER TABLE membership_categories
  ADD COLUMN IF NOT EXISTS renewal_type TEXT NOT NULL DEFAULT 'rolling'
    CHECK (renewal_type IN ('rolling', 'fixed_date')),
  ADD COLUMN IF NOT EXISTS renewal_months INTEGER NOT NULL DEFAULT 12
    CHECK (renewal_months > 0),
  ADD COLUMN IF NOT EXISTS renewal_month INTEGER CHECK (renewal_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS renewal_day INTEGER CHECK (renewal_day BETWEEN 1 AND 31);

ALTER TABLE membership_categories
  ADD CONSTRAINT membership_categories_renewal_fixed_date_check CHECK (
    renewal_type = 'rolling' OR (renewal_month IS NOT NULL AND renewal_day IS NOT NULL)
  );
