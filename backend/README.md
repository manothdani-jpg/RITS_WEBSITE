# RITS Backend

Node.js + Express + PostgreSQL API for Rhode Island Tamil Sangam member records,
family members, events, and RSVPs. Powers four login surfaces:

- **`../admin/`** — Super Admin and Board Director dashboard
- **`../portal/`** — member self-service portal
- **`../frontdesk/`** — event-day check-in desk (see "Front desk" below)
- **`../index.html`** — the public site's membership signup form

## Four login types

| Role | Logs in via | Can do |
|---|---|---|
| **Super Admin** | `../admin/` | Everything a Board Director can, plus create/edit/remove Board Director and Super Admin accounts (`../admin/` → "Admin Logins" tab, only visible to this role). |
| **Board Director** | `../admin/` | Manage all members, family members, events, and RSVPs from the dashboard, send email communications to members, and edit the public payment/dues page. Cannot manage other admin accounts. |
| **Member** | `../portal/` | View their own profile/payment status, edit their own contact info, manage their own family members, RSVP to events. Cannot see other members' data, and cannot change their own email, membership tier, or payment status (board-controlled). |
| **Desk staff** | `../frontdesk/` | Register/check in people for events and take event-day payments only — no access to member records, homepage content, reports, or anything else in the admin dashboard. Accounts are created by any board director or super admin from `../admin/` → "Front Desk". |

Board Directors and Super Admins have identical permissions everywhere
except admin-account management (`../admin/` → "Admin Logins" tab and
`/api/admins/*` — Super Admin only).

## Other admin dashboard features

- **Media** (`../admin/` → "Media", both roles) — upload gallery photos
  (with an optional caption) and sponsor logos (name + optional website
  link) shown on `../index.html`. Files are stored on the backend's local
  disk under `uploads/gallery/` and `uploads/sponsors/`, served at
  `/uploads/...`, and only referenced from Postgres by filename. Once at
  least one photo/sponsor exists, it replaces the placeholder tiles on the
  homepage automatically — an empty gallery/sponsor list falls back to the
  placeholder tiles that were already there. 5MB limit per file; JPG, PNG,
  WEBP, GIF only.

  **Deployment note:** local disk storage doesn't survive on hosts with an
  ephemeral filesystem (Render/Railway/Heroku's default web service, for
  example) — uploads vanish on every redeploy unless you attach a
  persistent volume/disk mounted at `uploads/`. Worth switching to object
  storage (S3, Cloudflare R2, etc.) before relying on this in production if
  your host doesn't offer persistent disks.
- **Board Roster** (`../admin/` → "Board Roster", both roles) — the public
  "Board of Directors" bios shown on `../index.html` (name, title, photo,
  years served) — **not** the same as "Admin Logins" (who can sign into
  this dashboard; see below). Add/edit/delete profiles; leaving "Term end
  year" blank marks someone as currently serving, which is also what puts
  them under "Current Board" instead of the homepage's collapsed "Past
  Board Members" list. Photos upload to `uploads/board/`, same local-disk
  caveat as Media above.
- **Homepage** (`../admin/` → "Homepage", both roles) — edits the hero
  headline/motto/subheading, hero stats (member families, events/year,
  founded year), mission statement, the three "about" bullets, the title
  + description of each of the four "Pillars of RITS" cards, the
  membership/sponsorship notes on the Get Involved cards, contact info,
  and the Facebook/Instagram/YouTube URLs behind the social icons in
  "Get in touch" (empty by default — those icons link to `#` until set)
  — all shown live on `../index.html`. Backed by a generic
  `site_content` key/value table (see Data model), so the editable set can
  grow by adding a new key + a form field, no schema change needed (the
  pillars were added exactly this way — 8 new keys, 8 new form fields,
  no backend code change since `PUT /api/site-content` already accepts
  any key). The homepage's featured "Upcoming Event" card isn't part of
  this — it's wired directly to whichever event has the soonest
  `event_date` in the Events tab, so it updates itself automatically.
  The pillar icons themselves (and the fixed count of four) aren't
  editable — only each pillar's title and description text. The social
  icons use a second flavor of the same mechanism —
  `data-content-href="key"` instead of `data-content="key"` — since a
  URL needs to become an `href` attribute, not element text;
  `js/main.js`'s `loadSiteContent()` handles both.
- **Communications** (`../admin/` → "Communications", both roles) — compose
  a subject/body and email it to members, optionally filtered by
  membership tier and/or payment status. `{{first_name}}` in the body is
  replaced per-recipient. Goes out through the same SMTP config as password
  reset emails (see below) — with no SMTP configured, sends are logged to
  the server console instead, same dev-mode fallback as password resets.
- **Payment Page** (`../admin/` → "Payment Page", both roles) — edits the
  heading, intro text, and payment instructions shown on the public
  `../payment.html` page. This page itself is informational only — there's
  no online payment processing here; members pay however you instruct
  (Zelle/check/cash/etc.) and a board member marks them paid from the
  Members tab, same as before this existed.
- **Membership Categories** (`../admin/` → "Payment Page", below the page
  settings, both roles) — fully admin-managed membership tiers, not a
  fixed list: add a new category (e.g. "Senior"), rename one, change its
  dues amount, or archive it. Each category is just a `label` + dues
  `amount_cents`; the `key` (used internally, e.g. in `members.membership_tier`)
  is auto-generated from the label once at creation and never changes, so
  renaming a category doesn't touch existing members. Active categories
  appear on the public signup form (`../index.html`) and `../payment.html`;
  archiving one hides it from new selections without affecting members
  already in it. Deleting is blocked (409) while any member still has that
  category — archive instead, or reassign those members first.
- **Reports** (`../admin/` → "Reports", both roles) — summary stats
  (members by tier/status, family member count, upcoming events, active
  RSVPs), a full membership CSV export, a Recent Payments table (most
  recent 200 Square checkouts — including pending/failed attempts, not just
  completed ones — for reconciliation), and an **Event RSVP Breakdown**:
  per event, counts by status (confirmed/pending payment/cancelled) and a
  table of registrations + revenue per pricing option (e.g. how many
  people picked "Team" vs "Single", how much food was ordered) — see
  "Event pricing" below for how revenue is split into collected vs
  pending.
- **Volunteers** (`../admin/` → "Volunteers", both roles) — signups from the
  public site's "Volunteer" tab (`../index.html` → Get Involved → Volunteer
  → Sign Up, a third tab alongside "Become a Member" / "General Inquiry" in
  the Contact section): name, contact info, an interest checklist (event
  planning, teaching, youth wing, hospitality, media, fundraising, other),
  and a free-text note. A board member can filter by and update a status
  (new → contacted → active/inactive) inline, and export everything to CSV.
  `POST /api/volunteers` is public and rate-limited, same pattern as
  membership signup; everything else under `/api/volunteers` is admin/board
  only.

Admin/board accounts live in the `admins` table (`role` = `superadmin` or
`board`); member logins live directly on the `members` table
(`password_hash`, set at signup). JWTs carry a `type` claim (`admin` or
`member`) so the two auth systems can't be used interchangeably.

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Create a Postgres database (adjust name/user as needed)
createdb rits_dev

# 3. Configure environment
cp .env.example .env
# edit .env: set DATABASE_URL to your local Postgres connection string,
# and generate JWT_SECRET and ENCRYPTION_KEY (two different values) with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Apply the schema (fresh database) ...
npm run db:migrate
# ... or, if upgrading an existing database, also run whichever
# incremental migrations you're missing, in order:
psql "$DATABASE_URL" -f db/migrations/002_roles_and_member_auth.sql
psql "$DATABASE_URL" -f db/migrations/003_member_password_reset.sql
psql "$DATABASE_URL" -f db/migrations/004_payment_settings.sql
psql "$DATABASE_URL" -f db/migrations/005_payments.sql
psql "$DATABASE_URL" -f db/migrations/006_site_content.sql
psql "$DATABASE_URL" -f db/migrations/007_media_uploads.sql
psql "$DATABASE_URL" -f db/migrations/008_event_pricing.sql
psql "$DATABASE_URL" -f db/migrations/009_member_vs_nonmember_pricing.sql
psql "$DATABASE_URL" -f db/migrations/010_volunteers.sql
psql "$DATABASE_URL" -f db/migrations/011_rsvp_member_snapshot.sql
psql "$DATABASE_URL" -f db/migrations/012_rsvp_selection_amounts.sql
psql "$DATABASE_URL" -f db/migrations/013_membership_categories.sql
psql "$DATABASE_URL" -f db/migrations/014_board_profiles.sql
psql "$DATABASE_URL" -f db/migrations/015_family_member_details.sql
psql "$DATABASE_URL" -f db/migrations/016_event_addon_topup.sql
psql "$DATABASE_URL" -f db/migrations/017_event_selection_refunds.sql
psql "$DATABASE_URL" -f db/migrations/018_event_flyers.sql
psql "$DATABASE_URL" -f db/migrations/019_pillar_content.sql
psql "$DATABASE_URL" -f db/migrations/020_social_links.sql
psql "$DATABASE_URL" -f db/migrations/021_mail_settings.sql
psql "$DATABASE_URL" -f db/migrations/022_front_desk.sql
psql "$DATABASE_URL" -f db/migrations/023_cultural_groups.sql
psql "$DATABASE_URL" -f db/migrations/024_audit_log.sql
psql "$DATABASE_URL" -f db/migrations/025_admin_password_reset.sql
psql "$DATABASE_URL" -f db/migrations/026_rsvp_remarks.sql

# 5. Create your first Super Admin login
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD=choose-a-strong-password ADMIN_NAME="Your Name" npm run db:seed
# (this always creates/updates a 'superadmin' — invite Board Directors
# afterwards from the "Admin Logins" tab in ../admin/)

# 6. Start the API
npm run dev      # auto-restarts on file changes
# or: npm start
```

The API listens on `http://localhost:4000` by default (`PORT` in `.env`).

## Database backups

```bash
# Dump the database (DATABASE_URL from .env) to a timestamped file
npm run db:backup

# Restore a backup — DESTRUCTIVE, replaces everything in DATABASE_URL
npm run db:restore -- db/backups/rits-<timestamp>.dump
```

`npm run db:backup` writes a compressed `pg_dump` file to `db/backups/`
(e.g. `rits-20260909-143000.dump`) and automatically prunes old backups,
keeping the 14 most recent. Backups are gitignored (only `db/backups/.gitkeep`
is tracked) because dump files contain real member PII — never commit one.

`npm run db:restore -- <path-to-backup.dump>` restores a backup with
`pg_restore --clean --if-exists`, which drops and recreates every object in
the target database first. It prompts for a typed `yes` confirmation before
doing anything, since it replaces the entire database. Only run it against a
database you intend to overwrite — never as a "test" against real data.

These scripts are local tooling, not a scheduled job — see the "Before
deploying to production" checklist below for making backups happen
automatically.

## Using the admin dashboard

Open `../admin/index.html` (served over HTTP, not `file://` — e.g. via the
same static server used for the public site) and sign in with the admin
account you created in step 5. The dashboard talks to the API base URL set
in `../admin/js/config.js` — update that when you deploy the backend
somewhere other than `localhost:4000`.

## Using the member portal

Open `../portal/index.html`. A member logs in with the email + password they
set on the public signup form. Uses `../portal/js/config.js` for the API
base URL. Forgot their password? `../portal/forgot-password.html` emails a
one-hour, single-use reset link to `../portal/reset-password.html`.

**Email setup:** password reset emails (and Communications, see below) go
through `src/email.js` via SMTP, configured from `../admin/` → "Admin
Logins" → "Mail Server Settings" (superadmin-only) — not `.env`. With
nothing configured (the local dev default), reset links and communications
are printed to the server console instead of sent — good enough to test the
flow, not for real members. Before relying on this for real members, fill
in the host/port/username/password/from-address there with any SMTP
provider (Gmail app password, SendGrid, Resend, Mailgun, Postmark — all
work), use "Send a Test Email" to confirm it actually works, and set
`PORTAL_URL` in `.env` to the real portal URL so reset links point
somewhere reachable.

**Remaining gap:** members added manually by the board (not via public
signup) have no password until they use "forgot password" themselves (it
works even without an existing password — it just sets one) — there's
still no way for a board member to set a member's password *for* them from
`../admin/`. Low priority since "forgot password" covers this in practice.

## Public membership signup (already wired up)

The public site's Contact section (`../index.html`) has two tabs: "Become a
Member" and "General Inquiry". The membership tab (`../js/main.js`, backed by
`../js/config.js` for the API base URL) posts directly to:

```
POST /api/members/signup
Content-Type: application/json

{
  "first_name": "...",
  "last_name": "...",
  "email": "...",
  "phone": "...",          // optional
  "membership_tier": "individual" // any active category's key — see GET /api/membership-categories
}
```

New signups land as `payment_status: "pending"` — a board member confirms
payment and updates the status from the admin dashboard. The "General
Inquiry" tab is still an unwired front-end placeholder (see `../js/main.js`)
— connect it to an email service or another endpoint separately if needed.

When you deploy the backend, update `window.RITS_API_BASE` in both
`../js/config.js` (public site) and `../admin/js/config.js` (admin
dashboard) to point at the real API URL.

## API overview

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | Admin/board login, returns a JWT |
| GET | `/api/auth/me` | admin | Verify token / current admin |
| POST | `/api/auth/member/login` | — (rate-limited) | Member login, returns a JWT |
| GET | `/api/auth/member/me` | member | Verify token / current member |
| GET | `/api/admins` | **superadmin** | List board directors + super admins |
| POST | `/api/admins` | **superadmin** | Invite a new board director or super admin |
| PUT | `/api/admins/:id` | **superadmin** | Update name/role, or reset an admin's password |
| DELETE | `/api/admins/:id` | **superadmin** | Remove an admin account |
| POST | `/api/members/signup` | — (rate-limited) | Public membership signup (sets the member's own password) |
| GET | `/api/members/me` | member | Own profile + family + RSVPs |
| PUT | `/api/members/me` | member | Update own contact info only (not email/tier/status) |
| POST | `/api/members/me/family` | member | Add own family member |
| DELETE | `/api/members/me/family/:familyId` | member | Remove own family member |
| GET | `/api/members` | admin/board | List/search/filter members |
| GET | `/api/members/:id` | admin/board | Member detail + family + RSVPs |
| POST | `/api/members` | admin/board | Create member (no login until they set a password) |
| PUT | `/api/members/:id` | admin/board | Update member |
| DELETE | `/api/members/:id` | admin/board | Delete member |
| POST | `/api/members/:id/family` | admin/board | Add a family member |
| DELETE | `/api/members/:id/family/:familyId` | admin/board | Remove a family member |
| GET | `/api/events` | — | List events (public, for the site + portal) |
| POST | `/api/events` | admin/board | Create event |
| PUT/DELETE | `/api/events/:id` | admin/board | Update/delete event |
| POST | `/api/events/:id/flyer` | admin/board | Upload/replace an event's flyer (`multipart/form-data`: `flyer`) |
| DELETE | `/api/events/:id/flyer` | admin/board | Remove an event's flyer |
| GET | `/api/events/:id/rsvps` | admin/board | Attendee list for an event |
| POST | `/api/rsvps` | — (rate-limited) | Public RSVP by member email (no login) |
| POST | `/api/rsvps/me` | member | Logged-in member RSVPs for themselves |
| DELETE | `/api/rsvps/me/:eventId` | member | Logged-in member cancels their own RSVP |
| PUT/DELETE | `/api/rsvps/:id` | admin/board | Update/remove any RSVP |
| GET | `/api/payment-settings` | — | Public: active membership categories + dues + payment page text |
| PUT | `/api/payment-settings` | admin/board | Update the payment page's heading/intro/instructions text |
| GET | `/api/membership-categories` | admin/board | All membership categories, including archived |
| POST | `/api/membership-categories` | admin/board | Add a membership category |
| PUT | `/api/membership-categories/:id` | admin/board | Edit a category's label/dues/order/active state |
| DELETE | `/api/membership-categories/:id` | admin/board | Remove a category (blocked if any member still has it) |
| GET | `/api/mail-settings` | **superadmin** | Current SMTP config (password never included, only whether one is set) |
| PUT | `/api/mail-settings` | **superadmin** | Update SMTP config; omit `password` to leave it unchanged |
| POST | `/api/mail-settings/test` | **superadmin** (rate-limited) | Send a real test email through the saved settings |
| POST | `/api/auth/desk/login` | — (rate-limited) | Desk staff login, returns a JWT |
| GET | `/api/auth/desk/me` | desk | Verify token / current desk staff |
| GET/POST | `/api/desk-staff` | admin/board | List / create desk staff logins |
| PUT/DELETE | `/api/desk-staff/:id` | admin/board | Edit (rename/reset password/activate) or remove a desk login |
| GET | `/api/desk/events` | desk | Events to choose from |
| GET | `/api/desk/events/:id` | desk | One event's details + pricing options |
| GET | `/api/desk/events/:id/attendees` | desk | Everyone registered, for search/check-in |
| GET | `/api/desk/events/:id/totals` | desk | Live headcounts + money collected by method |
| GET | `/api/desk/members/search` | desk | Look up an existing member by name/email |
| POST | `/api/desk/events/:id/register` | desk (rate-limited) | Register an existing member or new walk-in, with payment |
| POST | `/api/desk/events/:id/add-items` | desk (rate-limited) | Add more items for someone already registered |
| PUT | `/api/desk/rsvps/:id/checkin` | desk | Mark attended (or undo) |
| GET | `/api/reports/front-desk` | admin/board | Every payment/check-in recorded at the door, optionally filtered by event |
| PUT | `/api/events/:id/cultural-pricing` | admin/board | Set (or clear, to close) an event's member/non-member cultural group fee |
| POST | `/api/cultural-groups` | — (rate-limited) | Register a performance group with its participants and pay for the group |
| GET | `/api/cultural-groups/payment-status/:paymentId` | — | Public confirmation-page polling, no login (payment ID is the capability) |
| GET | `/api/cultural-groups` | admin/board | List group registrations, optionally filtered by event |
| GET | `/api/cultural-groups/:id` | admin/board | One group's full participant list |
| DELETE | `/api/cultural-groups/:id` | admin/board | Remove a bad/duplicate group registration |
| GET | `/api/reports/cultural` | admin/board | Group/participant counts and fees collected/pending, optionally filtered by event |
| GET | `/api/communications/recipient-count` | admin/board | Preview how many members match a filter |
| POST | `/api/communications/send` | admin/board (rate-limited) | Email members matching a filter |
| GET | `/api/reports/summary` | admin/board | Aggregate membership stats |
| GET | `/api/reports/members.csv` | admin/board | Full membership CSV export |
| GET | `/api/reports/rsvp-breakdown` | admin/board | Per-event RSVP counts + revenue, broken down by pricing option |
| POST | `/api/payments/checkout` | member (rate-limited) | Create a Square checkout for the member's tier |
| GET | `/api/payments/me` | member | Own payment history |
| POST | `/api/payments/webhook` | — (HMAC-verified) | Square calls this on payment status changes |
| GET | `/api/payments` | admin/board | All payments, for reconciliation |
| GET | `/api/site-content` | — | Public: editable homepage text (used by `../index.html`) |
| PUT | `/api/site-content` | admin/board | Update one or more content keys |
| GET | `/api/gallery` | — | Public: list gallery photos |
| POST | `/api/gallery` | admin/board | Upload a photo (`multipart/form-data`: `photo`, `caption`) |
| DELETE | `/api/gallery/:id` | admin/board | Remove a photo (row + file) |
| GET | `/api/sponsors` | — | Public: list sponsors |
| POST | `/api/sponsors` | admin/board | Add a sponsor (`multipart/form-data`: `logo`, `name`, `website_url`) |
| DELETE | `/api/sponsors/:id` | admin/board | Remove a sponsor (row + file) |
| GET | `/api/board-profiles` | — | Public: board roster (current + past) |
| POST | `/api/board-profiles` | admin/board | Add a board profile (no photo yet) |
| PUT | `/api/board-profiles/:id` | admin/board | Edit a profile's name/title/term/order |
| POST | `/api/board-profiles/:id/photo` | admin/board | Upload/replace a profile's photo (`multipart/form-data`: `photo`) |
| DELETE | `/api/board-profiles/:id` | admin/board | Remove a profile (row + photo file) |
| GET | `/api/events/:id/pricing` | — | Public: an event's participation/add-on options |
| POST | `/api/events/:id/pricing` | admin/board | Add a pricing option to an event |
| PUT | `/api/events/pricing/:optionId` | admin/board | Edit a pricing option |
| DELETE | `/api/events/pricing/:optionId` | admin/board | Remove a pricing option |
| POST | `/api/payments/event-checkout` | member (rate-limited) | Register for a priced event and pay via Square (or register free if the total is $0) |
| POST | `/api/payments/event-addon-checkout` | member (rate-limited) | Buy more add-ons for an event you're already registered for, without re-charging for what you already paid |
| PUT | `/api/payments/event-selection` | member (rate-limited) | Reduce or remove a paid add-on, refunding the difference via Square |
| POST | `/api/volunteers` | — (rate-limited) | Public: submit a volunteer signup |
| GET | `/api/volunteers` | admin/board | List all volunteer signups |
| PUT | `/api/volunteers/:id` | admin/board | Update a volunteer's status |
| DELETE | `/api/volunteers/:id` | admin/board | Remove a volunteer signup |
| GET | `/api/volunteers/export.csv` | admin/board | Full volunteer signup CSV export |

All authenticated routes take `Authorization: Bearer <token>`. Admin tokens
(from `/api/auth/login`) and member tokens (from `/api/auth/member/login`)
are not interchangeable — each only works against its own set of routes.

## Data model

- `admins` — Super Admin / Board Director logins (`role`: `superadmin` or
  `board`).
- `members` — one row per household/primary member: contact info,
  `password_hash` (their own portal login, set at signup — null if added
  manually by the board and never signed in), `membership_tier` (a key
  from `membership_categories`, admin-managed — see "Membership
  Categories" above), `payment_status` (pending/paid/overdue/waived),
  join/renewal dates.
- `family_members` — spouse/children/etc. linked to a member.
- `events` — name, date, location, description, `flyer_filename` (on
  local disk, see "Event flyers" above).
- `rsvps` — links a member to an event, with guest count, computed
  `amount_cents` for priced events, status
  (pending_payment/registered/attended/cancelled/no_show), and
  `member_at_registration` (a snapshot of whether they were a paid-up
  member when they registered — see "Viewing attendees" above), and
  `checked_in_by_desk_staff_id` / `checked_in_at` (set when front-desk
  staff marks them attended — see "Front desk" above; `status='attended'`
  is what actually reflects check-in, these two columns are just who/when).
- `event_pricing_options` — admin-defined participation/add-on choices for
  one event (see "Event pricing" above).
- `rsvp_selections` — which pricing option(s) (and quantities) a specific
  RSVP picked, plus `amount_cents` (what was actually charged for that
  line item — see "Event RSVP Breakdown" above).
- `membership_categories` — admin-managed membership tiers: `key` (stable,
  auto-generated once, stored in `members.membership_tier`), `label`
  (editable display name), `amount_cents` (dues), `display_order`, and
  `is_active` (archived categories stay valid for existing members but
  disappear from new-signup selection) — see "Membership Categories"
  above.
- `payment_page_content` — singleton row (heading/intro/instructions text)
  for the public payment page.
- `mail_settings` — singleton row for SMTP config (see "Mail server
  settings" above); `smtp_pass_encrypted` holds the password
  AES-256-GCM-encrypted, never in plain text.
- `payments` — one row per payment attempt (Square or manual): member,
  `purpose` (membership/event/cultural_group), amount, `method`
  (square/cash/venmo/zelle/paypal, defaults `square`), `status`
  (pending/completed/failed/cancelled/refunded), and the Square
  order/payment-link/payment IDs used to match incoming webhooks back to
  this row (unused for manual methods, which go straight to `completed`).
  `tier` is set for membership payments; `event_id`/`rsvp_id` are set for
  event payments; `cultural_group_id` is set for cultural group
  registration payments. `recorded_by_desk_staff_id` is set only when
  front-desk staff took the payment. `pending_selections` is set only for
  an add-on top-up payment (see "Buying more add-ons" above) — its
  presence is how `handlePaymentUpdate` tells a top-up apart from the
  original
  registration payment.
- `desk_staff` — front-desk login accounts (see "Front desk" above);
  `is_active = false` blocks login without deleting the account or losing
  its history.
- `cultural_groups` — one row per group registration submitted at
  `../cultural-registration.html` (see "Cultural event group registration"
  above): event, group/performance details, the resolved choreographer
  member, total `amount_cents`, and `status`
  (pending_payment/registered/cancelled).
  `events.cultural_member_fee_cents` / `cultural_non_member_fee_cents`
  (both `NULL` by default) hold the flat per-participant fee — `NULL`/`NULL`
  means cultural registration is closed for that event.
- `cultural_group_participants` — each participant in a group: name,
  optional email, `age_category` (adult/kid, informational only — doesn't
  affect fee), the member they were resolved to (if any), an `is_member`
  snapshot, and their individual `fee_cents`.
- `site_content` — generic `key`/`value` rows for editable homepage text
  (e.g. `hero.heading`, `about.mission`, `contact.email`) — see "Homepage"
  above.
- `gallery_photos` / `sponsors` — filename (on local disk, see "Media"
  above) plus caption, or name + optional website URL.
- `board_profiles` — public board bios: `name`, `title`, `photo_filename`
  (on local disk, `uploads/board/`), `term_start_year`, `term_end_year`
  (`NULL` = currently serving), `display_order` — see "Board Roster"
  above.
- `volunteers` — name, contact info, `interests` (a text array of interest
  keys), free-text `note`, and `status` (new/contacted/active/inactive) —
  see "Volunteers" above.

See `db/schema.sql` for the full schema (fresh installs), or
`db/migrations/` for incremental changes to an existing database.

## Online dues payment (Square)

Members pay from `../portal/dashboard.html` ("Pay Dues Online") — it POSTs
to `/api/payments/checkout`, which creates a Square-hosted checkout page
(Payment Links API) for their tier's current dues amount and redirects them
there. After paying, Square redirects back to
`../portal/payment-complete.html`, which polls `/api/payments/me` until the
payment shows `completed`.

**How confirmation works:** Square calls `POST /api/payments/webhook` when
a payment completes. The handler verifies the request's HMAC signature
(rejecting anything that doesn't match — this endpoint is public, so that
check is the only thing standing between it and forged "payment completed"
requests), looks up the matching `payments` row by Square's order ID, marks
it `completed`, and flips the member's `payment_status` to `paid` with
`renewal_date` set one year out. It's idempotent — Square retries webhooks,
and replays of an already-completed payment are no-ops.

### Setting it up

1. Create a Square account at [squareup.com](https://squareup.com) if you
   don't have one (only needed for real/production payments — see step 5).
2. Go to the [Square Developer Dashboard](https://developer.squareup.com/apps),
   create an application, and grab your **Sandbox** Access Token and a
   Sandbox Location ID (Sandbox → Locations) — free, no business
   verification needed, good for testing the whole flow first.
3. Set in `.env`:
   ```
   SQUARE_ENVIRONMENT=sandbox
   SQUARE_ACCESS_TOKEN=<your sandbox access token>
   SQUARE_LOCATION_ID=<your sandbox location id>
   ```
4. Set up the webhook: in the Developer Dashboard, add a webhook
   subscription for the `payment.updated` (and `payment.created`) event
   type, pointed at your backend's `/api/payments/webhook` URL. For local
   testing, Square can't reach `localhost` directly — use a tunnel like
   `ngrok http 4000` and use the `https://...ngrok.../api/payments/webhook`
   URL it gives you. Copy the **Signature Key** Square shows you for that
   subscription into `.env`:
   ```
   SQUARE_WEBHOOK_SIGNATURE_KEY=<the signature key from that subscription>
   SQUARE_WEBHOOK_URL=<the exact URL you entered for the subscription>
   ```
   `SQUARE_WEBHOOK_URL` must match **exactly** what's configured in the
   dashboard — Square's signature check includes the URL itself.
5. When you're ready to accept real payments: switch
   `SQUARE_ENVIRONMENT=production`, replace the access token/location ID
   with your production app's values, and create a second (production)
   webhook subscription pointed at your real deployed URL with its own
   signature key.

### Testing without a Square account yet

The webhook handler's logic (signature verification, matching a payment,
updating records) can be fully tested without any real Square credentials —
craft a correctly-signed test payload with the same HMAC-SHA256 algorithm
Square uses (`base64(hmacSha256(SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL + rawBody))`)
and POST it to `/api/payments/webhook` with an `x-square-hmacsha256-signature`
header. What you *can't* test without real Sandbox credentials is
`/api/payments/checkout` actually reaching Square — it fails with a clear
"Square isn't configured yet" error until `SQUARE_ACCESS_TOKEN` is set.

## Mail server settings

SMTP is configured from `../admin/` → "Admin Logins" → "Mail Server
Settings", not `.env` — this is the one piece of third-party-service
configuration that lives in the database instead of environment
variables, so a super admin can set it (or rotate the password) without
server access. Superadmin-only, same sensitivity tier as managing other
admin logins on that same tab.

- `GET/PUT /api/mail-settings` (superadmin) — read/update host, port,
  username, from-address, and SSL/TLS flag. `PUT`'s `password` field is
  optional: omit it (or send an empty string) to leave the currently
  stored password untouched, so re-saving the other fields doesn't force
  re-entering it every time.
- `POST /api/mail-settings/test` (superadmin, rate-limited) — sends a real
  test email through the already-saved settings, so you can confirm SMTP
  actually works without waiting for a real password reset or
  communications send.
- The password is never returned by `GET` — only a `has_password` boolean.
  It's encrypted at rest (`src/crypto.js`, AES-256-GCM) using `ENCRYPTION_KEY`
  from `.env`, decrypted only in-memory at the moment `src/email.js` builds
  a transporter to actually send. `ENCRYPTION_KEY` must be set for the
  password field to work at all — losing or changing that key makes any
  already-stored encrypted password undecryptable, requiring it to be
  re-entered from the dashboard.
- `src/email.js`'s `sendEmail()` reads settings from the database fresh on
  every call (not cached at boot), so a settings change takes effect on
  the very next email — no restart needed. With no host configured, it
  falls back to logging the would-be email to the server console, same as
  the previous `.env`-based version did — the local-dev experience is
  unchanged, just the source of truth moved.

## Event flyers + past events

Each event can have a flyer image, uploaded from `../admin/` → "Events" →
the image icon on any event row. Uploading replaces the previous flyer
(old file deleted from disk); a separate "Remove Flyer" action clears it.
Files live on local disk under `uploads/events/` (same pattern as gallery
photos/sponsor logos/board photos — see "Deployment note" under "Media"
above about persistent storage), served at `/uploads/events/<filename>`,
and referenced from `events.flyer_filename`.

The flyer shows up everywhere the event does — the public homepage's
featured "Upcoming Event" card, every event row in the member portal
(whether free, priced-but-unregistered, or already registered), and the
admin Events table (as a small thumbnail) — since all three just read
`ev.flyer_filename` off the same `GET /api/events` response and build the
image URL themselves; there's no separate "flyer" endpoint to fetch.

**Past events** show up automatically in a "Past Events" section on the
public homepage (`index.html` → `#past-events`) — no admin action
needed. It's driven by the same `GET /api/events` call the featured-event
card already makes, client-side filtered to `event_date < now` (mirroring
how the portal filters the opposite direction for its "Upcoming Events"
list) and sorted most-recent-first. An event with a flyer shows the image;
one without falls back to the same gradient placeholder tile style the
Gallery section uses. The whole section stays `display:none` until at
least one past event exists, so a brand-new install with no history yet
doesn't show an empty section.

## Event pricing (participation types + add-ons)

Events are free by default. From `../admin/` → "Events" → the $ icon on any
event, a board member can add:
- **Participation** options — pick-one choices (e.g. "Single" $20, "Team"
  $75). A member registering for a priced event must choose exactly one.
- **Add-on** options — optional extras (e.g. "Food (per person)" $15),
  priced per unit — the member picks a quantity for each one they want.

As soon as an event has at least one pricing option, the portal's RSVP UI
for that event switches from the plain free "Guests + RSVP" form to a
selection form with a live running total and a "Register & Pay" button
that goes through the same Square Checkout flow as membership dues (see
above) — reuses `POST /api/payments/checkout`'s sibling endpoint,
`POST /api/payments/event-checkout`. The free-RSVP endpoints
(`POST /api/rsvps`, `POST /api/rsvps/me`) refuse to register for an event
that has pricing configured, so there's no way to bypass payment through
the old free-RSVP path once pricing is set.

An RSVP with a charge sits at `pending_payment` until Square confirms the
payment (webhook flips it to `registered`, same idempotent handling as
membership payments — see `payments.routes.js`'s `handlePaymentUpdate`,
which branches on `payments.purpose` to decide whether to update a member's
membership status or an RSVP's status).

Relevant tables: `event_pricing_options` (the admin-defined choices),
`rsvp_selections` (what a specific RSVP picked), `rsvps.amount_cents` /
`rsvps.status` (the computed total and payment state), and `payments.purpose`
/ `payments.event_id` / `payments.rsvp_id` (generalized from
membership-only to also cover event charges).

### Buying more add-ons after registering

Once registered (`rsvps.status = 'registered'`), the portal shows a "Buy
More" button under that event if it has any add-on options — expands a
mini form (add-ons only, no participation choice) with its own running
total and a "Purchase" button, calling `POST
/api/payments/event-addon-checkout`. `POST /api/payments/event-checkout`
itself now refuses (409) to run again once an RSVP is already
`registered`/`attended`, specifically to force top-ups through this path
instead of silently re-running the original checkout (which would
overwrite `rsvp_selections` and re-charge for everything, not just what's
new).

The tricky part is not corrupting an already-confirmed registration if the
top-up payment fails. `event-addon-checkout` never touches
`rsvps.amount_cents` or inserts `rsvp_selections` at checkout time — it
stashes the picks on `payments.pending_selections` (JSONB) and only
applies them (insert the selections, `amount_cents = amount_cents +
<this payment's amount>`) from `handlePaymentUpdate` once Square confirms
that specific payment. `rsvps.status` is never touched by a top-up either
way — a failed top-up just leaves that one `payments` row `failed`, with
the member's original registration exactly as it was. This is different
from the original registration payment, which still cancels the whole
RSVP on failure (that payment has no `pending_selections`, which is how
`handlePaymentUpdate` tells the two cases apart).

### Editing an RSVP after registering

Two gaps this closes: a registered RSVP used to be a dead end (no way to
see what you'd actually picked, or change it), and a free event's RSVP
could only be cancelled, never adjusted.

- **Free events** — the guest-count field stays editable after RSVPing
  (previously replaced by a plain "Cancel RSVP" button once registered).
  Editing it just calls the same `POST /api/rsvps/me` upsert used to
  create the RSVP in the first place.
- **Priced events** — the "Registered" state now lists exactly what was
  selected (participation choice + each add-on with its quantity and
  amount), sourced from a new `selections` array `GET /api/members/me`
  attaches to each RSVP (aggregated from `rsvp_selections`, since a
  member's picks for one option can be spread across several rows if they
  bought more than once via "Buy More").
- **Reducing or removing a paid add-on** — each add-on line has a
  quantity input + "Update" button calling `PUT
  /api/payments/event-selection` (`{event_id, option_id, quantity}`,
  member-only). It only ever decreases — increasing goes through the
  existing "Buy More" flow (`event-addon-checkout`) instead, so the two
  money directions (charge vs. refund) never live in the same code path.

**Refunds are real**, issued through Square's Refunds API
(`square.js`'s `refundPayment`, wrapping `client.refunds.refundPayment`)
against the payment(s) that funded the removed quantity — walking
backward through that RSVP's completed event payments, newest first,
until the refund amount is covered (a member might have paid for the same
option across the original registration and one or more top-ups). Each
refund is written as its own `payments` row (`status = 'refunded'`,
`refund_of_payment_id` pointing at the payment it refunded) rather than
mutating the original completed payment, so the reports stay a full audit
trail rather than losing history.

**Safety property:** the refund call to Square happens *before* any
database record is touched. If it fails outright, nothing changes —
verified directly (seeded a paid selection, forced a Square failure,
confirmed `rsvp_selections`/`rsvps.amount_cents` were byte-for-byte
unchanged and no `refunded` payment row was created). If Square only
partially succeeds (refunds some but not all of the requested amount —
walking multiple payments, one succeeds and a later one fails), the
route stops immediately and the RSVP's records are updated to reflect
only what was *actually* refunded, scaled proportionally — the database
can never claim more was refunded than Square confirms.

### Member vs. non-member pricing

Every pricing option has two amounts — `member_amount_cents` and
`non_member_amount_cents` — set from the same $ modal (a "Non-member price"
field next to "Member price", pre-filled to match until you edit it
separately). "Non-member" here means a registrant whose dues aren't
currently paid (`members.payment_status != 'paid'`), not a person with no
RITS account — registering for a priced event still requires being logged
into `../portal/`.

Which price applies is decided **server-side** in
`POST /api/payments/event-checkout` by looking up the logged-in member's
current `payment_status` at checkout time — the client never sends a price,
only which options were picked, so there's no way to tamper with the
amount from the browser. The portal shows the member their applicable
price up front (with a "Non-member pricing applies — pay your dues for
member pricing" note when it's not the discounted one) so there's no
surprise at checkout.

### Viewing attendees

From `../admin/` → "Events", the people icon on any event row (next to the
$ pricing icon) opens an **Attendees** modal listing everyone registered:
name, email, two separate member/non-member columns, which
participation/add-on options they picked, the amount charged, and their
RSVP status. Backed by the same `GET /api/events/:id/rsvps` the row's RSVP
count already used, now also joining `rsvp_selections`.

The two member columns answer different questions and are expected to
drift apart over time:
- **Member (Now)** — `is_member`, computed live from
  `members.payment_status = 'paid'` at the moment you open the modal.
- **Member (At Signup)** — `rsvps.member_at_registration`, a snapshot
  written once when the RSVP was created (or last re-registered), from
  whichever code path created it: `POST /api/rsvps`,
  `POST /api/rsvps/me`, or `POST /api/payments/event-checkout` (where it's
  also what decided which of `member_amount_cents` /
  `non_member_amount_cents` they were actually charged — see "Member vs.
  non-member pricing" above). It never changes afterward, even if the
  member's dues status later does.

Existing RSVPs from before this column existed were backfilled once using
their member's payment status *at backfill time* — a best-effort estimate,
not a true historical snapshot, since no earlier record of that existed.

### Event RSVP Breakdown (Reports)

`../admin/` → "Reports" → "Event RSVP Breakdown" rolls the above up per
event: `GET /api/reports/rsvp-breakdown` returns, for every event, counts
by status (confirmed = registered/attended, pending payment, cancelled)
and a per-pricing-option table (quantity, distinct registrants, revenue).
Quantities and registrant counts include pending-payment registrations —
useful for headcount/catering planning before Square confirms anything —
but revenue is split into **Collected** (confirmed only) and **Pending**
so the two are never conflated. Below the per-option table, a **By
Registrant** table lists every registrant individually (name, email,
member now/at signup, their selections, amount, status) — the same row
renderer and data as the Attendees modal (see "Viewing attendees" above),
so both places always agree.

This relies on `rsvp_selections.amount_cents`, a per-line-item snapshot of
what was actually charged for that specific selection (unit price ×
quantity, using whichever member/non-member price applied — see above),
written once at checkout in `payments.routes.js`. Selections from before
this column existed were backfilled using the option's *current*
member/non-member price and the RSVP's `member_at_registration` — again a
best-effort estimate, not a guaranteed match to what was actually charged
if prices were edited since.

## Cultural event group registration

`../cultural-registration.html` is a public form (no login required) where
a choreographer or trainer registers a performance group — dance,
singing, drama, speech, or other — for a specific event, listing every
participant in one submission. It's a genuinely different shape from
regular event RSVPs: one submission → many people, each individually
checked against membership and fee-assessed, rather than one person
registering themselves.

**Enabling it for an event:** `../admin/` → "Events" → the $ icon on any
event → "Cultural Group Registration Fee" section — set a member fee and
a non-member fee (per participant, flat — not split further by
performance type or adult/kid). Leaving both blank (the default) keeps
cultural registration closed for that event; the public form's event
picker only ever lists events where both are set, so there's no way to
land on a form for an event that isn't actually open.

**What the form collects:** group name, performance type, description,
choreographer/trainer name + email + phone, and a dynamic list of
participants (full name, optional email, Adult/Kid). The choreographer
doesn't need to already be a RITS member — like front-desk walk-ins, one
is created for them on the fly (reusing an existing record if their email
matches one), so there's always a valid `members` row to hang the
registration and payment on.

**Fee logic:** membership status only — each participant's fee is their
event's member or non-member rate, looked up by email against `members`.
No email, or an email that doesn't match an existing paid member, means
non-member pricing; Adult vs. Kid is captured for headcount/planning but
doesn't change the fee (per how this was scoped — could become a second
axis of pricing later without a major rework, since fee computation is
centralized in one place in `cultural-groups.routes.js`).

**Payment:** one Square Checkout for the group's total (all participants'
fees summed, one line item each so the breakdown is visible in Square
itself), same webhook-confirmed pattern as event/membership payments — see
`handlePaymentUpdate`'s `cultural_group` branch. A $0 total (event fees
set to 0/0) skips Square and registers immediately, same as free events.
On failure, the whole group is marked `cancelled` (there's no partial/
top-up concept here, unlike event add-ons — a group is submitted once).

**Post-payment confirmation:** unlike the member portal's
`payment-complete.html` (which requires a member login to poll
`/api/payments/me`), the choreographer who submitted this form usually
isn't logged in anywhere. `../cultural-registration-complete.html` polls a
dedicated public endpoint, `GET /api/cultural-groups/payment-status/:paymentId`,
instead — safe without auth because the payment ID itself is an
unguessable UUID handed only to the submitter via the Square redirect (the
same capability-URL pattern Square's own redirect already relies on), and
the endpoint returns only what the submitter already entered (group name,
event name, amount, status) — no participant emails or other PII.

**Admin visibility:** `../admin/` → "Cultural Events" — summary stats
(groups/participants/collected/pending, excluding cancelled groups) via
`GET /api/reports/cultural`, a list of every group with participant/member/
kid counts, and a detail view per group showing the full participant
list with each one's membership status and fee. A board member can
delete a bad or duplicate submission; the linked `payments` row (if any)
is kept for the financial record, its `cultural_group_id` just goes null.

## Front desk (event-day check-in)

`../frontdesk/` is a fourth, separate app for staffing an event's door —
registering walk-ins, taking payment, and checking people in — without
handing out real admin or member logins. It's a third JWT type (`type:
"desk"`, `desk_staff` table, `requireDesk` middleware), completely
independent of admin and member auth: a desk token can't touch `/api/members`,
`/api/admins`, or anything else outside `/api/desk/*`, and vice versa
(verified directly — cross-token requests get a clean 401, not a partial
success).

**Creating desk logins:** `../admin/` → "Front Desk" (either role, not
superadmin-gated — this is event-day staffing, not dashboard-account-tier
access) → "+ Add Desk Login". Deactivating or deleting a login doesn't
touch the transactions/check-ins it already recorded — the reference just
goes null (`ON DELETE SET NULL`), so history is never lost.

**What the desk page does** (`../frontdesk/desk.html`):
- Picks an event (defaults to the soonest upcoming one) and shows live
  totals for it — checked in / registered / payment-pending counts, and
  money collected broken down by payment method.
- Search existing members by name/email, or add a walk-in on the spot
  (name required; email/phone optional). A walk-in becomes a real row in
  `members` (tier `individual`, status `pending`) — if the email they give
  matches an existing member, that record is reused rather than
  duplicated; with no email given, a placeholder (`walkin-<uuid>@no-email...`)
  is generated so the `NOT NULL UNIQUE` constraint on `members.email`
  is still satisfied.
- Picks participation/add-on options exactly like the member portal does
  (member vs. non-member pricing, based on the resolved person's current
  `payment_status` — a brand-new walk-in is always "pending", so always
  non-member pricing until the board marks them paid).
- Payment method: **Cash / Venmo / Zelle / PayPal** are logged, not
  processed — desk staff has already collected the money in person, so
  the payment is recorded as `completed` immediately with that `method`
  and the RSVP goes straight to `registered`, no waiting. **Square**
  reuses the real Square Checkout flow already built for the portal (open
  the link on a tablet, hand it to the guest) — the RSVP stays
  `pending_payment` until the same webhook that confirms portal payments
  confirms this one too; nothing at the app layer knows or cares who
  initiated it.
- If the chosen person is already registered for the event, the same flow
  automatically switches to "add items" mode (participation can't be
  re-picked, only more add-ons) — mirrors the portal's Buy More endpoint
  exactly, including the same "never touch the confirmed registration if
  a top-up payment fails" safety property.
- Check-in tab: search/filter the attendee list, mark anyone
  `registered`/`attended` as checked in (or undo it) —
  `rsvps.checked_in_by_desk_staff_id` / `checked_in_at` record who and
  when. A `pending_payment` RSVP can't be checked in until it's paid.
- A printable receipt (browser print, `@media print` hides everything
  else on the page) after each completed registration.

**Admin visibility:** `../admin/` → "Front Desk" also shows every
transaction/check-in recorded at the door — separate from (but the same
underlying `payments`/`rsvps` rows as) the regular Reports — filterable by
event, via `GET /api/reports/front-desk`.

## Local dev server (static site) — cache-busting matters

Serve the static site (`../index.html`, `../admin/`, `../portal/`, etc.)
with `python3 dev-server.py <port>` from the project root — **not** plain
`python3 -m http.server`. `dev-server.py` is a thin wrapper that adds
`Cache-Control: no-store` to every response. Plain `http.server` sends no
cache headers at all, which lets browsers apply heuristic caching to
`<script>`/`<link>` loads — in practice this meant editing a `.js` file and
reloading the page could silently keep running the *old* cached script with
no error, which cost real debugging time while building this feature. If
you ever see a change "not taking effect" after editing a JS/CSS file,
confirm you're running `dev-server.py` (not `http.server`), and do one hard
refresh in the browser to clear anything already cached from before the
switch.

## Before deploying to production

- [ ] Pick a host (Render, Railway, Fly.io, a VPS, etc.) and provision a
      managed Postgres instance there.
- [ ] Set real environment variables on the host — never commit `.env`.
- [ ] Update `CORS_ORIGINS` to your real site domain(s).
- [ ] Update `SITE_URL` and `PORTAL_URL` to your real deployed site/portal
      URLs — used to build the redirect links after Square checkouts.
- [ ] Update `../admin/js/config.js` to point at the deployed API URL.
- [ ] Put the API behind HTTPS.
- [ ] Enable your host's automated Postgres backups (Render, Railway, Fly.io,
      and most managed Postgres providers offer this) — don't rely solely on
      running `npm run db:backup` by hand. If self-hosting, schedule it via
      cron/launchd instead.
- [ ] Rotate `JWT_SECRET` and `ENCRYPTION_KEY` from the local dev values
      before going live (rotating `ENCRYPTION_KEY` after mail settings are
      already saved means re-entering the SMTP password from the dashboard).
- [ ] Switch Square to production credentials and a production webhook
      subscription (see above) — sandbox payments aren't real money.
- [ ] Update `../js/config.js`, `../portal/js/config.js`, and
      `../frontdesk/js/config.js` to point at the deployed API URL too (not
      just `../admin/js/config.js`).
- [ ] Attach a persistent volume/disk mounted at `uploads/` if your host's
      filesystem is ephemeral (Render/Railway/Heroku default) — otherwise
      gallery photos and sponsor logos disappear on every redeploy.
