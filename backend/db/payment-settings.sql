-- Membership tiers + payment page text snapshot taken 2026-10-05 from the dev database.
-- ONE-TIME load for the initial production launch: run it after all migrations
-- (and after homepage-content.sql):
--   psql "$PROD_DATABASE_URL" -f db/payment-settings.sql
-- Safe to re-run, but it OVERWRITES tier labels/prices/renewal rules and the
-- payment page text — don't re-run it after launch or it will undo later
-- edits made in the admin dashboard.
--
-- Deliberately NOT included: the Square mode and payment links (they are
-- environment-specific — set them from Admin > Payment Page > Square Payments
-- on production) and anything with credentials (mail settings).
BEGIN;
INSERT INTO membership_categories (key, label, amount_cents, display_order, is_active, renewal_type, renewal_months, renewal_month, renewal_day) VALUES ('individual', 'Individual', 2500, 0, 't', 'rolling', 12, NULL, NULL) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, amount_cents = EXCLUDED.amount_cents, display_order = EXCLUDED.display_order, is_active = EXCLUDED.is_active, renewal_type = EXCLUDED.renewal_type, renewal_months = EXCLUDED.renewal_months, renewal_month = EXCLUDED.renewal_month, renewal_day = EXCLUDED.renewal_day;
INSERT INTO membership_categories (key, label, amount_cents, display_order, is_active, renewal_type, renewal_months, renewal_month, renewal_day) VALUES ('student', 'STUDENT', 1500, 0, 't', 'rolling', 12, NULL, NULL) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, amount_cents = EXCLUDED.amount_cents, display_order = EXCLUDED.display_order, is_active = EXCLUDED.is_active, renewal_type = EXCLUDED.renewal_type, renewal_months = EXCLUDED.renewal_months, renewal_month = EXCLUDED.renewal_month, renewal_day = EXCLUDED.renewal_day;
INSERT INTO membership_categories (key, label, amount_cents, display_order, is_active, renewal_type, renewal_months, renewal_month, renewal_day) VALUES ('family', 'Family', 3500, 1, 't', 'rolling', 12, NULL, NULL) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, amount_cents = EXCLUDED.amount_cents, display_order = EXCLUDED.display_order, is_active = EXCLUDED.is_active, renewal_type = EXCLUDED.renewal_type, renewal_months = EXCLUDED.renewal_months, renewal_month = EXCLUDED.renewal_month, renewal_day = EXCLUDED.renewal_day;
-- Tiers that exist on a fresh install but were deleted in dev (e.g. the seeded
-- 'lifetime' tier) are removed so production matches. Fine at launch (no members yet).
DELETE FROM membership_categories WHERE key NOT IN ('individual', 'student', 'family');
UPDATE payment_page_content SET heading = 'Membership Benefits', intro_text = '- Free entry for all events.
- First Preference will be given for participation.
- Discounted participation and competition fee.
- Discounted food Price.

Membership will be valid till January 31st 2028.', instructions = 'coming soon..' WHERE id = 1;
COMMIT;
