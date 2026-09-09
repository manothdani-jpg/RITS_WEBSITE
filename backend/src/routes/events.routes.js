const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { makeUploader, UPLOADS_ROOT } = require("../upload");

const router = express.Router();
const uploadFlyer = makeUploader("events");

// GET /api/events — public, so the site can list upcoming events
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM events ORDER BY event_date ASC");
  res.json({ events: rows });
});

// GET /api/events/:id — public
router.get("/:id", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM events WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Event not found" });
  res.json({ event: rows[0] });
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
  const { rows } = await db.query(
    `UPDATE events SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       event_date = COALESCE($3, event_date),
       location = COALESCE($4, location)
     WHERE id = $5 RETURNING *`,
    [name, description, event_date, location, req.params.id]
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
            (m.payment_status = 'paid') AS is_member
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
