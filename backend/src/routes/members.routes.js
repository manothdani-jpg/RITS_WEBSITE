const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin, requireMember } = require("../middleware/auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYMENT_STATUSES = ["pending", "paid", "overdue", "waived"];

// Never let password_hash or reset-token internals leak into an API response.
function stripSecrets(member) {
  if (!member) return member;
  delete member.password_hash;
  delete member.reset_token_hash;
  delete member.reset_token_expires_at;
  return member;
}

async function sanitizeMemberInput(body, { partial = false, activeCategoriesOnly = false } = {}) {
  const out = {};
  const fields = [
    "first_name", "last_name", "email", "phone",
    "address_line1", "address_line2", "city", "state", "zip",
    "membership_tier", "payment_status", "renewal_date", "notes",
  ];
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f];
  }

  if (!partial || out.first_name !== undefined) {
    if (!out.first_name || typeof out.first_name !== "string") {
      throw new Error("first_name is required");
    }
  }
  if (!partial || out.last_name !== undefined) {
    if (!out.last_name || typeof out.last_name !== "string") {
      throw new Error("last_name is required");
    }
  }
  if (!partial || out.email !== undefined) {
    if (!out.email || !EMAIL_RE.test(out.email)) {
      throw new Error("a valid email is required");
    }
  }
  if (out.membership_tier !== undefined) {
    const query = activeCategoriesOnly
      ? "SELECT 1 FROM membership_categories WHERE key = $1 AND is_active = true"
      : "SELECT 1 FROM membership_categories WHERE key = $1";
    const { rows } = await db.query(query, [out.membership_tier]);
    if (!rows.length) throw new Error("Unknown membership category");
  }
  if (out.payment_status !== undefined && !PAYMENT_STATUSES.includes(out.payment_status)) {
    throw new Error(`payment_status must be one of: ${PAYMENT_STATUSES.join(", ")}`);
  }

  return out;
}

/* ============================================================
   PUBLIC — membership signup form on the website posts here.
   No auth; rate-limited to deter abuse. Always lands as
   payment_status='pending' — a board member confirms payment
   and promotes the record via the admin dashboard. The password
   set here becomes the member's login for their own portal.
   ============================================================ */
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please try again later." },
});

router.post("/signup", signupLimiter, async (req, res) => {
  let data;
  try {
    data = await sanitizeMemberInput(req.body || {}, { activeCategoriesOnly: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "A password of at least 8 characters is required" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO members
        (first_name, last_name, email, password_hash, phone, address_line1, address_line2, city, state, zip, membership_tier, payment_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
       RETURNING id, first_name, last_name, email, membership_tier, payment_status, join_date`,
      [
        data.first_name, data.last_name, data.email, passwordHash, data.phone || null,
        data.address_line1 || null, data.address_line2 || null, data.city || null,
        data.state || "RI", data.zip || null, data.membership_tier || "individual",
        data.notes || null,
      ]
    );
    res.status(201).json({ member: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A member with this email already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create member" });
  }
});

/* ============================================================
   MEMBER SELF-SERVICE — the logged-in member manages their own
   record only (req.member.sub, from their own JWT).
   ============================================================ */

router.get("/me", requireMember, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM members WHERE id = $1", [req.member.sub]);
  const member = rows[0];
  if (!member) return res.status(404).json({ error: "Member not found" });
  stripSecrets(member);

  const family = await db.query(
    "SELECT * FROM family_members WHERE member_id = $1 ORDER BY created_at",
    [member.id]
  );
  const rsvps = await db.query(
    `SELECT r.*, e.name AS event_name, e.event_date, e.location
     FROM rsvps r JOIN events e ON e.id = r.event_id
     WHERE r.member_id = $1 ORDER BY e.event_date DESC`,
    [member.id]
  );

  if (rsvps.rows.length) {
    const selections = await db.query(
      `SELECT s.rsvp_id, s.pricing_option_id, o.kind, o.label,
              SUM(s.quantity)::int AS quantity, SUM(s.amount_cents)::int AS amount_cents
       FROM rsvp_selections s JOIN event_pricing_options o ON o.id = s.pricing_option_id
       WHERE s.rsvp_id = ANY($1::uuid[])
       GROUP BY s.rsvp_id, s.pricing_option_id, o.kind, o.label, o.display_order
       ORDER BY o.kind, o.display_order`,
      [rsvps.rows.map((r) => r.id)]
    );
    const byRsvp = new Map();
    for (const s of selections.rows) {
      if (!byRsvp.has(s.rsvp_id)) byRsvp.set(s.rsvp_id, []);
      byRsvp.get(s.rsvp_id).push(s);
    }
    for (const r of rsvps.rows) r.selections = byRsvp.get(r.id) || [];
  }

  res.json({ member, family_members: family.rows, rsvps: rsvps.rows });
});

// PUT /api/members/me — a member can update their own contact info only
// (not email, membership_tier, payment_status, or notes — board-controlled).
router.put("/me", requireMember, async (req, res) => {
  const allowed = ["phone", "address_line1", "address_line2", "city", "state", "zip"];
  const data = {};
  for (const f of allowed) {
    if (req.body[f] !== undefined) data[f] = req.body[f];
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return res.status(400).json({ error: "No fields to update" });

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => data[k]);
  values.push(req.member.sub);

  const { rows } = await db.query(
    `UPDATE members SET ${setClause} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: "Member not found" });
  stripSecrets(rows[0]);
  res.json({ member: rows[0] });
});

router.post("/me/family", requireMember, async (req, res) => {
  const { first_name, last_name, relationship, date_of_birth, email, address_line1, city, zip } = req.body || {};
  if (!first_name) return res.status(400).json({ error: "first_name is required" });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });

  const { rows } = await db.query(
    `INSERT INTO family_members (member_id, first_name, last_name, relationship, date_of_birth, email, address_line1, city, zip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.member.sub, first_name, last_name || null, relationship || "child", date_of_birth || null, email || null, address_line1 || null, city || null, zip || null]
  );
  res.status(201).json({ family_member: rows[0] });
});

router.put("/me/family/:familyId", requireMember, async (req, res) => {
  const { first_name, last_name, relationship, date_of_birth, email, address_line1, city, zip } = req.body || {};
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });

  const { rows } = await db.query(
    `UPDATE family_members SET
       first_name = COALESCE($1, first_name),
       last_name = $2,
       relationship = COALESCE($3, relationship),
       date_of_birth = $4,
       email = $5,
       address_line1 = $6,
       city = $7,
       zip = $8
     WHERE id = $9 AND member_id = $10 RETURNING *`,
    [first_name, last_name || null, relationship, date_of_birth || null, email || null, address_line1 || null, city || null, zip || null, req.params.familyId, req.member.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: "Family member not found" });
  res.json({ family_member: rows[0] });
});

router.delete("/me/family/:familyId", requireMember, async (req, res) => {
  const { rowCount } = await db.query(
    "DELETE FROM family_members WHERE id = $1 AND member_id = $2",
    [req.params.familyId, req.member.sub]
  );
  if (!rowCount) return res.status(404).json({ error: "Family member not found" });
  res.status(204).send();
});

/* ============================================================
   ADMIN / BOARD — everything below requires a valid admin token.
   ============================================================ */
router.use(requireAdmin);

// GET /api/members?search=&tier=&status=&page=&pageSize=
router.get("/", async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 1), 100);
  const offset = (page - 1) * pageSize;

  const conditions = [];
  const params = [];

  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    conditions.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (req.query.tier) {
    params.push(req.query.tier);
    conditions.push(`membership_tier = $${params.length}`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    conditions.push(`payment_status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM members ${where}`, params);
  params.push(pageSize, offset);
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, phone, address_line1, address_line2, city, state, zip,
            membership_tier, payment_status, join_date, renewal_date, notes, created_at, updated_at,
            (password_hash IS NOT NULL) AS has_login
     FROM members ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ members: rows, total: countResult.rows[0].total, page, pageSize });
});

// GET /api/members/:id (with family members + rsvps)
router.get("/:id", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM members WHERE id = $1", [req.params.id]);
  const member = rows[0];
  if (!member) return res.status(404).json({ error: "Member not found" });
  member.has_login = !!member.password_hash;
  stripSecrets(member);

  const family = await db.query(
    "SELECT * FROM family_members WHERE member_id = $1 ORDER BY created_at",
    [member.id]
  );
  const rsvps = await db.query(
    `SELECT r.*, e.name AS event_name, e.event_date
     FROM rsvps r JOIN events e ON e.id = r.event_id
     WHERE r.member_id = $1 ORDER BY e.event_date DESC`,
    [member.id]
  );

  res.json({ member, family_members: family.rows, rsvps: rsvps.rows });
});

// POST /api/members — admin/board manually adds a member (no login until they set a password)
router.post("/", async (req, res) => {
  let data;
  try {
    data = await sanitizeMemberInput(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO members
        (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, membership_tier, payment_status, renewal_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        data.first_name, data.last_name, data.email, data.phone || null,
        data.address_line1 || null, data.address_line2 || null, data.city || null,
        data.state || "RI", data.zip || null, data.membership_tier || "individual",
        data.payment_status || "pending", data.renewal_date || null, data.notes || null,
      ]
    );
    stripSecrets(rows[0]);
    res.status(201).json({ member: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A member with this email already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create member" });
  }
});

// PUT /api/members/:id
router.put("/:id", async (req, res) => {
  let data;
  try {
    data = await sanitizeMemberInput(req.body || {}, { partial: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return res.status(400).json({ error: "No fields to update" });

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => data[k]);
  values.push(req.params.id);

  try {
    const { rows } = await db.query(
      `UPDATE members SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "Member not found" });
    stripSecrets(rows[0]);
    res.json({ member: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A member with this email already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not update member" });
  }
});

// DELETE /api/members/:id
router.delete("/:id", async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM members WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Member not found" });
  res.status(204).send();
});

/* ---------------- Family members nested under a member (admin/board) ---------------- */

// POST /api/members/:id/family
router.post("/:id/family", async (req, res) => {
  const { first_name, last_name, relationship, date_of_birth, email, address_line1, city, zip } = req.body || {};
  if (!first_name) return res.status(400).json({ error: "first_name is required" });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });

  try {
    const { rows } = await db.query(
      `INSERT INTO family_members (member_id, first_name, last_name, relationship, date_of_birth, email, address_line1, city, zip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, first_name, last_name || null, relationship || "child", date_of_birth || null, email || null, address_line1 || null, city || null, zip || null]
    );
    res.status(201).json({ family_member: rows[0] });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(404).json({ error: "Member not found" });
    }
    console.error(err);
    res.status(500).json({ error: "Could not add family member" });
  }
});

// PUT /api/members/:id/family/:familyId
router.put("/:id/family/:familyId", async (req, res) => {
  const { first_name, last_name, relationship, date_of_birth, email, address_line1, city, zip } = req.body || {};
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });

  const { rows } = await db.query(
    `UPDATE family_members SET
       first_name = COALESCE($1, first_name),
       last_name = $2,
       relationship = COALESCE($3, relationship),
       date_of_birth = $4,
       email = $5,
       address_line1 = $6,
       city = $7,
       zip = $8
     WHERE id = $9 AND member_id = $10 RETURNING *`,
    [first_name, last_name || null, relationship, date_of_birth || null, email || null, address_line1 || null, city || null, zip || null, req.params.familyId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Family member not found" });
  res.json({ family_member: rows[0] });
});

// DELETE /api/members/:id/family/:familyId
router.delete("/:id/family/:familyId", async (req, res) => {
  const { rowCount } = await db.query(
    "DELETE FROM family_members WHERE id = $1 AND member_id = $2",
    [req.params.familyId, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: "Family member not found" });
  res.status(204).send();
});

module.exports = router;
