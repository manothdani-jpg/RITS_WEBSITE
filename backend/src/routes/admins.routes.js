const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["board", "superadmin"];

// Everything here is superadmin-only: board directors can't manage admin accounts.
router.use(requireRole(["superadmin"]));

// GET /api/admins — list board directors + super admins
router.get("/", async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, name, email, role, created_at FROM admins ORDER BY created_at DESC"
  );
  res.json({ admins: rows });
});

// POST /api/admins — invite a new board director or super admin
router.post("/", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "a valid email is required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  const finalRole = role || "board";
  if (!ROLES.includes(finalRole)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO admins (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash, finalRole]
    );
    res.status(201).json({ admin: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An admin with this email already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create admin" });
  }
});

// PUT /api/admins/:id — update name/role, or reset password
router.put("/:id", async (req, res) => {
  const { name, role, password } = req.body || {};

  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
  }
  if (password !== undefined && password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  // Prevent removing the last superadmin's superadmin status.
  if (role === "board") {
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM admins WHERE role = 'superadmin' AND id != $1",
      [req.params.id]
    );
    const target = await db.query("SELECT role FROM admins WHERE id = $1", [req.params.id]);
    if (target.rows[0]?.role === "superadmin" && rows[0].n === 0) {
      return res.status(400).json({ error: "Can't demote the last remaining super admin." });
    }
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  const { rows } = await db.query(
    `UPDATE admins SET
       name = COALESCE($1, name),
       role = COALESCE($2, role),
       password_hash = COALESCE($3, password_hash)
     WHERE id = $4
     RETURNING id, name, email, role, created_at`,
    [name || null, role || null, passwordHash, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Admin not found" });
  res.json({ admin: rows[0] });
});

// DELETE /api/admins/:id
router.delete("/:id", async (req, res) => {
  if (req.params.id === req.admin.sub) {
    return res.status(400).json({ error: "You can't delete your own account." });
  }

  const target = await db.query("SELECT role FROM admins WHERE id = $1", [req.params.id]);
  if (!target.rows[0]) return res.status(404).json({ error: "Admin not found" });

  if (target.rows[0].role === "superadmin") {
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM admins WHERE role = 'superadmin' AND id != $1",
      [req.params.id]
    );
    if (rows[0].n === 0) {
      return res.status(400).json({ error: "Can't delete the last remaining super admin." });
    }
  }

  await db.query("DELETE FROM admins WHERE id = $1", [req.params.id]);
  res.status(204).send();
});

module.exports = router;
