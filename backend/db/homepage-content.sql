-- Homepage content snapshot (site_content table) taken 2026-09-24 from the dev database.
-- ONE-TIME load for the initial production launch: run it after all migrations.
--   psql "$PROD_DATABASE_URL" -f db/homepage-content.sql
-- Safe to re-run, but it OVERWRITES those keys — don't re-run it after launch
-- or it will replace anything the board has since edited in the admin dashboard.
BEGIN;
INSERT INTO site_content (key, value) VALUES ('about.bullet_founded', 'Founded in 2017 by local Tamil families.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('about.bullet_nonprofit', 'A Registered non profit 501(C)(3) Tax Exempt Organisation.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('about.bullet_serving', 'Serving families across Rhode Island and nearby areas.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('about.mission', 'The main objective of Rhode Island Tamil Sangam(RITS) is to propagate Tamil Culture and Heritage among diaspora Tamil speaking population as well as other communities in and around Rhode Island.

We do this mostly through the cultural programs we conduct every year as well as other small outreach programs. RITS''s Board-of-Directors, Executive Committee members and volunteers are instrumental in conducting these programs. Below are the current team members:') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('contact.email', 'RITamilsangam@gmail.com') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('contact.facebook_url', 'https://www.facebook.com/RITamilSangam/') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('contact.instagram_url', 'https://www.instagram.com/rhodeislandtamilsangam/') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('contact.location', 'Providence, RI') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('contact.phone', '(401)219-3128') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('contact.youtube_url', 'https://www.youtube.com/@rhodeislandtamilsangam-med8305') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('hero.heading', 'Keeping Tamil language, arts & community alive in Rhode Island') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('hero.lede', 'Rhode Island Tamil Sangam (RITS) is a non-profit, member based cultural  organization, incorporated under the laws of Rhode Island, USA ,to primarily focus on promoting Tamil Culture and Heritage in and around Rhode Island area.

Through its cultural and other outreach activities RITS aims to increase the awareness of Tamil culture and heritage within the local Tamil society, as well as promote intercultural harmony with other communities.  ') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('hero.stat_events_per_year', '5/2026') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('hero.stat_families', '50') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('hero.stat_founded_year', '2016') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('hero.tamil_motto', 'வாழ்க தமிழ் · தமிழால் இணைவோம்') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('involve.membership_note', 'Individual - 25 , Family - 35') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('involve.sponsor_note', 'Event sponsorship - 200, Annual Sponsorship - 600') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.1_description', 'Tamil Events that  keep our mother tongue thriving in the next generations.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.1_title', 'Language & Literature') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.2_description', 'Classical and folk dances, native martial arts,music and festival celebrations like pongal and Chithirai.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.2_title', 'Arts & Culture') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.3_description', 'Regular gatherings that connect Tamil families across the area and build lasting friendships.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.3_title', 'Community & Fellowship') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.4_description', 'Volunteership and youth involvement that gives the next generation ownership of RITS''s Future.') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO site_content (key, value) VALUES ('pillars.4_title', 'Youth & Education') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
COMMIT;
