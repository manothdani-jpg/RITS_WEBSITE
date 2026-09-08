-- Makes the Facebook/Instagram/YouTube icons in "Get in touch" editable
-- from the admin Homepage tab — same generic site_content pattern as
-- the rest of the homepage. Empty by default; the icons keep their
-- current href="#" until a board member sets a real URL.
INSERT INTO site_content (key, value) VALUES
  ('contact.facebook_url', ''),
  ('contact.instagram_url', ''),
  ('contact.youtube_url', '')
ON CONFLICT (key) DO NOTHING;
