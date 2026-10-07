const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERESTS = ["event_planning", "teaching", "youth_wing", "hospitality", "media", "fundraising", "other"];
const STATUSES = ["new", "contacted", "active", "inactive"];
const AVAILABILITIES = ["event_specific", "all_time"];
const AVAILABILITY_LABELS = { event_specific: "Event-specific", all_time: "All-time" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Volunteers with the event(s) they signed up for (empty for all-time).
const VOLUNTEERS_WITH_EVENTS_SQL = `
  SELECT v.*,
         COALESCE(
           (SELECT json_agg(json_build_object('id', e.id, 'name', e.name, 'event_date', e.event_date) ORDER BY e.event_date)
            FROM volunteer_events ve JOIN events e ON e.id = ve.event_id
            WHERE ve.volunteer_id = v.id),
           '[]'::json
         ) AS events
  FROM volunteers v`;

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please try again later." },
});

// POST /api/volunteers — public: the site's "Volunteer" tab.
router.post("/", signupLimiter, async (req, res) => {
  const { first_name, last_name, email, phone, interests, note, availability, event_ids } = req.body || {};

  if (!first_name || typeof first_name !== "string") return res.status(400).json({ error: "first_name is required" });
  if (!last_name || typeof last_name !== "string") return res.status(400).json({ error: "last_name is required" });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });
  if (!phone || typeof phone !== "string" || !phone.trim()) return res.status(400).json({ error: "phone is required" });

  if (!AVAILABILITIES.includes(availability)) {
    return res.status(400).json({ error: "Please choose whether you can volunteer for specific events or all the time" });
  }
  let cleanEventIds = [];
  if (availability === "event_specific") {
    if (!Array.isArray(event_ids) || !event_ids.length) {
      return res.status(400).json({ error: "Please pick at least one event you can volunteer for" });
    }
    cleanEventIds = [...new Set(event_ids)];
    if (cleanEventIds.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
      return res.status(400).json({ error: "event_ids must be valid event ids" });
    }
    const found = await db.query("SELECT id FROM events WHERE id = ANY($1::uuid[])", [cleanEventIds]);
    if (found.rows.length !== cleanEventIds.length) {
      return res.status(400).json({ error: "One of the selected events no longer exists. Please reload and try again." });
    }
  }

  let cleanInterests = [];
  if (interests !== undefined) {
    if (!Array.isArray(interests)) return res.status(400).json({ error: "interests must be an array" });
    cleanInterests = interests.filter((i) => INTERESTS.includes(i));
  }

  // One statement so the volunteer and their event picks are saved together
  // or not at all.
  const { rows } = await db.query(
    `WITH v AS (
       INSERT INTO volunteers (first_name, last_name, email, phone, interests, note, availability)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, first_name, last_name, email, availability
     ), ve AS (
       INSERT INTO volunteer_events (volunteer_id, event_id)
       SELECT v.id, e FROM v, unnest($8::uuid[]) AS e
     )
     SELECT * FROM v`,
    [first_name.trim(), last_name.trim(), email.trim(), phone || null, cleanInterests, note || null, availability, cleanEventIds]
  );
  res.status(201).json({ volunteer: rows[0] });
});

/* ---------------- Admin-only below ---------------- */
router.use(requireAdmin);

// GET /api/volunteers — list, newest first.
router.get("/", async (req, res) => {
  const { rows } = await db.query(`${VOLUNTEERS_WITH_EVENTS_SQL} ORDER BY v.created_at DESC`);
  res.json({ volunteers: rows });
});

// PUT /api/volunteers/:id — update status.
router.put("/:id", async (req, res) => {
  const { status } = req.body || {};
  if (!status || !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
  }
  const { rows } = await db.query(
    "UPDATE volunteers SET status = $1 WHERE id = $2 RETURNING *",
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Volunteer not found" });
  res.json({ volunteer: rows[0] });
});

// DELETE /api/volunteers/:id
router.delete("/:id", async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM volunteers WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Volunteer not found" });
  res.status(204).send();
});

// GET /api/volunteers/export.csv
router.get("/export.csv", async (req, res) => {
  const { rows } = await db.query(`${VOLUNTEERS_WITH_EVENTS_SQL} ORDER BY v.last_name, v.first_name`);

  const headers = ["First Name", "Last Name", "Email", "Phone", "Availability", "Events", "Interests", "Status", "Note", "Signed Up"];
  const csvEscape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [headers.join(",")];
  for (const v of rows) {
    lines.push(
      [
        v.first_name, v.last_name, v.email, v.phone,
        AVAILABILITY_LABELS[v.availability] || "",
        (v.events || []).map((e) => e.name).join("; "),
        (v.interests || []).join("; "), v.status, v.note,
        v.created_at ? new Date(v.created_at).toISOString().slice(0, 10) : "",
      ].map(csvEscape).join(",")
    );
  }

  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="rits-volunteers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

module.exports = router;
