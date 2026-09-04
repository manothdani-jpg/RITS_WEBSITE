-- Membership tiers become a fully admin-managed list (add/rename/archive),
-- instead of a fixed 4-value enum — mirrors event_pricing_options.
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

-- Seed from the old fixed tiers + whatever dues were already configured,
-- so existing members and payment settings carry over unchanged.
INSERT INTO membership_categories (key, label, amount_cents, display_order)
SELECT
  t.tier,
  CASE t.tier
    WHEN 'individual' THEN 'Individual'
    WHEN 'family' THEN 'Family'
    WHEN 'student' THEN 'Student'
    WHEN 'lifetime' THEN 'Lifetime'
    ELSE initcap(t.tier)
  END,
  t.amount_cents,
  CASE t.tier WHEN 'individual' THEN 0 WHEN 'family' THEN 1 WHEN 'student' THEN 2 WHEN 'lifetime' THEN 3 ELSE 4 END
FROM payment_tier_settings t
ON CONFLICT (key) DO NOTHING;

-- membership_tier stays a plain TEXT key (existing member rows are
-- untouched) but is no longer restricted to a hardcoded list — validity
-- is now enforced in the application layer against membership_categories.
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_membership_tier_check;

DROP TABLE IF EXISTS payment_tier_settings;
