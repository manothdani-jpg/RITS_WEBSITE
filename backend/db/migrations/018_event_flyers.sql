-- Event flyer image, uploaded by admin, shown wherever the event appears
-- (public site, portal, admin) — same filename-on-disk pattern as
-- gallery_photos/sponsors/board_profiles.
ALTER TABLE events ADD COLUMN IF NOT EXISTS flyer_filename TEXT;
