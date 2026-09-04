-- Snapshot the amount actually charged for each individual pricing
-- selection (unit price * quantity, using whichever member/non-member
-- price applied at checkout), so revenue can be broken down by option
-- later without recomputing from prices that may have since changed.
ALTER TABLE rsvp_selections ADD COLUMN IF NOT EXISTS amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0);

-- Best-effort backfill for any selections that predate this column —
-- uses the option's current member/non-member price (per the RSVP's
-- member_at_registration snapshot), which may not exactly match what was
-- charged if prices were edited since.
UPDATE rsvp_selections s
SET amount_cents = s.quantity * (
  CASE WHEN r.member_at_registration THEN o.member_amount_cents ELSE o.non_member_amount_cents END
)
FROM rsvps r, event_pricing_options o
WHERE s.rsvp_id = r.id AND s.pricing_option_id = o.id AND s.amount_cents = 0;
