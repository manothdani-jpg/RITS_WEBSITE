const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { activeMemberSql } = require("../membership");
const { requireAdmin, requireMember } = require("../middleware/auth");
const { makeUploader, UPLOADS_ROOT } = require("../upload");
const { buildCalendar } = require("../ics");

const router = express.Router();
const uploadFlyer = makeUploader("events");

// GET /api/events — public, so the site can list upcoming events
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM events ORDER BY event_date ASC");
  res.json({ events: rows });
});

// GET /api/events/calendar.ics — public: a subscribable feed of every
// upcoming event (grace period of 1 day so an event doesn't vanish from a
// synced calendar mid-day), so a calendar app can auto-refresh with new
// ones instead of needing a fresh download each time. Registered before
// GET /:id so "calendar.ics" isn't swallowed as an :id value.
router.get("/calendar.ics", async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM events WHERE event_date >= now() - interval '1 day' ORDER BY event_date ASC"
  );
  const siteUrl = process.env.SITE_URL || "http://localhost:8420";
  const ics = buildCalendar(rows, { siteUrl });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="rits-events.ics"');
  res.send(ics);
});

// GET /api/events/:id — public
router.get("/:id", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM events WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Event not found" });
  res.json({ event: rows[0] });
});

// GET /api/events/:id/ics — public: download a single event as a .ics
// file (Apple Calendar, Outlook, etc). Google Calendar gets its own
// "quick add" URL instead, built client-side — see index.html.
router.get("/:id/ics", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM events WHERE id = $1", [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: "Event not found" });

  const siteUrl = process.env.SITE_URL || "http://localhost:8420";
  const ics = buildCalendar([event], { siteUrl });
  const filename = event.name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".ics";
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  // "inline" (not "attachment") so iOS Safari shows its native "Add to
  // Calendar" preview sheet directly, rather than just downloading the file.
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(ics);
});

// GET /api/events/:id/pricing — public: pricing options a member picks from when RSVPing.
// No rows = the event is free. Both prices are returned; the portal/checkout decide which
// one applies based on the logged-in member's payment_status.
router.get("/:id/pricing", async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, kind, label, member_amount_cents, non_member_amount_cents, display_order FROM event_pricing_options WHERE event_id = $1 ORDER BY kind, display_order, created_at",
    [req.params.id]
  );
  res.json({ options: rows });
});

// GET /api/events/:id/attendees — member-facing headcount + first/last
// names of who's coming, so members can see who else is going. Includes
// both 'registered' and 'attended' (already checked in at the door) RSVPs;
// unlike the admin /rsvps endpoint, this omits email/phone and
// pending/cancelled/no-show RSVPs.
router.get("/:id/attendees", requireMember, async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.first_name, m.last_name, r.guest_count
     FROM rsvps r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = $1 AND r.status IN ('registered', 'attended')
     ORDER BY r.created_at`,
    [req.params.id]
  );
  const guestTotal = rows.reduce((sum, r) => sum + (r.guest_count || 0), 0);
  res.json({
    total_count: rows.length + guestTotal,
    rsvp_count: rows.length,
    attendees: rows.map((r) => ({ first_name: r.first_name, last_name: r.last_name, guest_count: r.guest_count })),
  });
});

/* ---------------- Admin-only below ---------------- */
router.use(requireAdmin);

function parseCents(value, fieldName) {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return cents;
}

// POST /api/events/:id/pricing — add a pricing option (kind: participation|addon).
// non_member_amount_cents defaults to the member price (no discount) if omitted.
router.post("/:id/pricing", async (req, res) => {
  const { kind, label, member_amount_cents, non_member_amount_cents, display_order } = req.body || {};
  if (!kind || !["participation", "addon"].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'participation' or 'addon'" });
  }
  if (!label) return res.status(400).json({ error: "label is required" });

  let memberCents, nonMemberCents;
  try {
    memberCents = parseCents(member_amount_cents, "member_amount_cents");
    nonMemberCents = parseCents(
      non_member_amount_cents === undefined || non_member_amount_cents === null ? member_amount_cents : non_member_amount_cents,
      "non_member_amount_cents"
    );
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO event_pricing_options (event_id, kind, label, member_amount_cents, non_member_amount_cents, display_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, kind, label, memberCents, nonMemberCents, display_order || 0]
    );
    res.status(201).json({ option: rows[0] });
  } catch (err) {
    if (err.code === "23503") return res.status(404).json({ error: "Event not found" });
    console.error(err);
    res.status(500).json({ error: "Could not add pricing option" });
  }
});

// PUT /api/events/pricing/:optionId — edit a pricing option
router.put("/pricing/:optionId", async (req, res) => {
  const { label, member_amount_cents, non_member_amount_cents, display_order } = req.body || {};
  let memberCents, nonMemberCents;
  try {
    if (member_amount_cents !== undefined) memberCents = parseCents(member_amount_cents, "member_amount_cents");
    if (non_member_amount_cents !== undefined) nonMemberCents = parseCents(non_member_amount_cents, "non_member_amount_cents");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { rows } = await db.query(
    `UPDATE event_pricing_options SET
       label = COALESCE($1, label),
       member_amount_cents = COALESCE($2, member_amount_cents),
       non_member_amount_cents = COALESCE($3, non_member_amount_cents),
       display_order = COALESCE($4, display_order)
     WHERE id = $5 RETURNING *`,
    [label, memberCents, nonMemberCents, display_order, req.params.optionId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Pricing option not found" });
  res.json({ option: rows[0] });
});

// DELETE /api/events/pricing/:optionId
router.delete("/pricing/:optionId", async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM event_pricing_options WHERE id = $1", [req.params.optionId]);
  if (!rowCount) return res.status(404).json({ error: "Pricing option not found" });
  res.status(204).send();
});

router.post("/", async (req, res) => {
  const { name, description, event_date, location } = req.body || {};
  if (!name || !event_date) {
    return res.status(400).json({ error: "name and event_date are required" });
  }
  const { rows } = await db.query(
    `INSERT INTO events (name, description, event_date, location) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, description || null, event_date, location || null]
  );
  res.status(201).json({ event: rows[0] });
});

router.put("/:id", async (req, res) => {
  const { name, description, event_date, location } = req.body || {};
  if (!name || !event_date) {
    return res.status(400).json({ error: "name and event_date are required" });
  }
  const { rows } = await db.query(
    `UPDATE events SET name = $1, description = $2, event_date = $3, location = $4
     WHERE id = $5 RETURNING *`,
    [name, description || null, event_date, location || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Event not found" });
  res.json({ event: rows[0] });
});

router.delete("/:id", async (req, res) => {
  const { rows } = await db.query("DELETE FROM events WHERE id = $1 RETURNING flyer_filename", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Event not found" });
  if (rows[0].flyer_filename) {
    fs.unlink(path.join(UPLOADS_ROOT, "events", rows[0].flyer_filename), () => {});
  }
  res.status(204).send();
});

// POST /api/events/:id/flyer — upload/replace an event's flyer image.
// multipart/form-data: flyer (file)
router.post("/:id/flyer", (req, res) => {
  uploadFlyer.single("flyer")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No flyer uploaded" });

    try {
      const existing = await db.query("SELECT flyer_filename FROM events WHERE id = $1", [req.params.id]);
      if (!existing.rows[0]) {
        fs.unlink(path.join(UPLOADS_ROOT, "events", req.file.filename), () => {});
        return res.status(404).json({ error: "Event not found" });
      }
      const oldFilename = existing.rows[0].flyer_filename;

      await db.query("UPDATE events SET flyer_filename = $1 WHERE id = $2", [req.file.filename, req.params.id]);
      if (oldFilename) fs.unlink(path.join(UPLOADS_ROOT, "events", oldFilename), () => {});

      res.status(201).json({ flyer_filename: req.file.filename });
    } catch (dbErr) {
      fs.unlink(path.join(UPLOADS_ROOT, "events", req.file.filename), () => {});
      console.error(dbErr);
      res.status(500).json({ error: "Could not save flyer" });
    }
  });
});

// DELETE /api/events/:id/flyer
router.delete("/:id/flyer", async (req, res) => {
  const existing = await db.query("SELECT flyer_filename FROM events WHERE id = $1", [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Event not found" });

  await db.query("UPDATE events SET flyer_filename = NULL WHERE id = $1", [req.params.id]);
  if (existing.rows[0].flyer_filename) {
    fs.unlink(path.join(UPLOADS_ROOT, "events", existing.rows[0].flyer_filename), () => {});
  }
  res.status(204).send();
});

// PUT /api/events/:id/cultural-pricing — set the flat member/non-member
// fee charged per participant in a cultural group registration for this
// event. Both null (the default) means cultural registration is closed
// for this event.
router.put("/:id/cultural-pricing", async (req, res) => {
  const { member_amount_cents, non_member_amount_cents } = req.body || {};

  function parseCentsOrNull(value, field) {
    if (value === null || value === undefined || value === "") return null;
    const cents = Number(value);
    if (!Number.isInteger(cents) || cents < 0) {
      throw new Error(`${field} must be a non-negative integer, or null to close cultural registration`);
    }
    return cents;
  }

  let memberCents, nonMemberCents;
  try {
    memberCents = parseCentsOrNull(member_amount_cents, "member_amount_cents");
    nonMemberCents = parseCentsOrNull(non_member_amount_cents, "non_member_amount_cents");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { rows } = await db.query(
    `UPDATE events SET cultural_member_fee_cents = $1, cultural_non_member_fee_cents = $2
     WHERE id = $3 RETURNING id, cultural_member_fee_cents, cultural_non_member_fee_cents`,
    [memberCents, nonMemberCents, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Event not found" });
  res.json({ event: rows[0] });
});

// GET /api/events/:id/rsvps — attendee list for one event, with each
// participant's name/email, whether they're a current (paid) member, and
// what pricing options they selected.
router.get("/:id/rsvps", async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, m.first_name, m.last_name, m.email,
            ${activeMemberSql("m.")} AS is_member
     FROM rsvps r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = $1 ORDER BY r.created_at`,
    [req.params.id]
  );

  if (rows.length) {
    const selectionsResult = await db.query(
      `SELECT s.rsvp_id, s.quantity, o.kind, o.label
       FROM rsvp_selections s JOIN event_pricing_options o ON o.id = s.pricing_option_id
       WHERE s.rsvp_id = ANY($1::uuid[])
       ORDER BY o.kind, o.display_order`,
      [rows.map((r) => r.id)]
    );
    const selectionsByRsvp = new Map();
    for (const s of selectionsResult.rows) {
      if (!selectionsByRsvp.has(s.rsvp_id)) selectionsByRsvp.set(s.rsvp_id, []);
      selectionsByRsvp.get(s.rsvp_id).push({ kind: s.kind, label: s.label, quantity: s.quantity });
    }
    for (const r of rows) r.selections = selectionsByRsvp.get(r.id) || [];
  }

  res.json({ rsvps: rows });
});

module.exports = router;
