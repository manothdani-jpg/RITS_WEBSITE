-- Free-text notes desk staff can attach to an RSVP while registering or
-- checking someone in (e.g. "brought 2 extra guests", "vegetarian meal").
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS remarks TEXT;
