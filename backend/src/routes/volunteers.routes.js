const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERESTS = ["event_planning", "teaching", "youth_wing", "hospitality", "media", "fundraising", "other"];
const STATUSES = ["new", "contacted", "active", "inactive"];

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please try again later." },
});

// POST /api/volunteers — public: the site's "Volunteer" tab.
router.post("/", signupLimiter, async (req, res) => {
  const { first_name, last_name, email, phone, interests, note } = req.body || {};

  if (!first_name || typeof first_name !== "string") return res.status(400).json({ error: "first_name is required" });
  if (!last_name || typeof last_name !== "string") return res.status(400).json({ error: "last_name is required" });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });

  let cleanInterests = [];
  if (interests !== undefined) {
    if (!Array.isArray(interests)) return res.status(400).json({ error: "interests must be an array" });
    cleanInterests = interests.filter((i) => INTERESTS.includes(i));
  }

  const { rows } = await db.query(
    `INSERT INTO volunteers (first_name, last_name, email, phone, interests, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, first_name, last_name, email`,
    [first_name.trim(), last_name.trim(), email.trim(), phone || null, cleanInterests, note || null]
  );
  res.status(201).json({ volunteer: rows[0] });
});

/* ---------------- Admin-only below ---------------- */
router.use(requireAdmin);

// GET /api/volunteers — list, newest first.
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM volunteers ORDER BY created_at DESC");
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
  const { rows } = await db.query("SELECT * FROM volunteers ORDER BY last_name, first_name");

  const headers = ["First Name", "Last Name", "Email", "Phone", "Interests", "Status", "Note", "Signed Up"];
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
