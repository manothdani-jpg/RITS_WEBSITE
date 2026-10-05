-- Square payment configuration editable from the admin Payment Page.
--   square_mode = 'api'   — the site creates a Square checkout per payment via
--                           the API (needs SQUARE_ACCESS_TOKEN/LOCATION_ID in
--                           .env); Square's webhook confirms payments
--                           automatically. This is the existing behavior.
--   square_mode = 'links' — members are sent to the board's own Square payment
--                           links instead (one for membership dues, one for
--                           events/cultural registrations). Square can't tell
--                           the site who paid through a static link, so the
--                           board confirms each payment with "Mark paid".
ALTER TABLE payment_page_content
  ADD COLUMN IF NOT EXISTS square_mode TEXT NOT NULL DEFAULT 'api'
    CHECK (square_mode IN ('api', 'links')),
  ADD COLUMN IF NOT EXISTS membership_payment_link TEXT,
  ADD COLUMN IF NOT EXISTS event_payment_link TEXT;
