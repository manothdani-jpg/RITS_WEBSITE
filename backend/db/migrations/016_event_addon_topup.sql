-- Lets a member buy more add-ons (extra food, etc.) for an event they're
-- already registered for, without re-charging for what they already paid.
-- pending_selections holds the add-on picks for an in-flight top-up
-- payment; they're only applied to rsvp_selections/rsvps.amount_cents once
-- the webhook confirms payment, and simply dropped if it fails — the
-- member's original registration is never touched either way.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pending_selections JSONB;
