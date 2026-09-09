const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Board/superadmin — creating a desk login is event-day staffing, not
// dashboard-access-tier account management, so it's not superadmin-only.
router.use(requireAdmin);

// GET /api/desk-staff — list all front-desk logins (active + deactivated)
router.get("/", async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, name, username, is_active, created_at FROM desk_staff ORDER BY created_at DESC"
  );
  res.json({ staff: rows });
});

// POST /api/desk-staff — create a new desk login
router.post("/", async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: "name, username, and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO desk_staff (name, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, username, is_active, created_at`,
      [name, username, passwordHash]
    );
    res.status(201).json({ staff: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create desk login" });
  }
});

// PUT /api/desk-staff/:id — rename, reset password, or activate/deactivate
router.put("/:id", async (req, res) => {
  const { name, password, is_active } = req.body || {};
  if (password !== undefined && password.length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  const { rows } = await db.query(
    `UPDATE desk_staff SET
       name = COALESCE($1, name),
       password_hash = COALESCE($2, password_hash),
       is_active = COALESCE($3, is_active)
     WHERE id = $4
     RETURNING id, name, username, is_active, created_at`,
    [name || null, passwordHash, is_active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Desk login not found" });
  res.json({ staff: rows[0] });
});

// DELETE /api/desk-staff/:id — removes the login; past transactions it
// recorded/checked in stay intact (the reference just becomes null).
router.delete("/:id", async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM desk_staff WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Desk login not found" });
  res.status(204).send();
});

module.exports = router;
