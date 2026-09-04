-- Member vs. non-member pricing on event pricing options.
-- "Non-member" here means a registrant whose dues aren't currently paid
-- (payment_status != 'paid'), not a person with no account at all —
-- registration still requires a portal login either way.

ALTER TABLE event_pricing_options RENAME COLUMN amount_cents TO member_amount_cents;

ALTER TABLE event_pricing_options ADD COLUMN IF NOT EXISTS non_member_amount_cents INTEGER;
UPDATE event_pricing_options SET non_member_amount_cents = member_amount_cents WHERE non_member_amount_cents IS NULL;
ALTER TABLE event_pricing_options ALTER COLUMN non_member_amount_cents SET NOT NULL;
ALTER TABLE event_pricing_options ALTER COLUMN non_member_amount_cents SET DEFAULT 0;
ALTER TABLE event_pricing_options ADD CONSTRAINT event_pricing_options_non_member_amount_check CHECK (non_member_amount_cents >= 0);
