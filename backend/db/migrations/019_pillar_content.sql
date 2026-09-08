-- Makes the "Four pillars of RITS" section editable from the admin
-- Homepage tab, same generic site_content pattern as the rest of the
-- homepage (migration 006) — seeded with the text already hardcoded in
-- index.html so nothing visibly changes until a board member edits it.
INSERT INTO site_content (key, value) VALUES
  ('pillars.1_title', 'Language & Literature'),
  ('pillars.1_description', 'Tamil classes, spelling bees, and literary events that keep our mother tongue thriving in the next generation.'),
  ('pillars.2_title', 'Arts & Culture'),
  ('pillars.2_description', 'Classical and folk dance, music, and festival celebrations like Pongal and Tamil New Year.'),
  ('pillars.3_title', 'Community & Fellowship'),
  ('pillars.3_description', 'Regular gatherings that connect Tamil families across Rhode Island and build lasting friendships.'),
  ('pillars.4_title', 'Youth & Education'),
  ('pillars.4_description', 'Scholarships, mentorship, and a youth wing that gives the next generation ownership of RITS''s future.')
ON CONFLICT (key) DO NOTHING;
