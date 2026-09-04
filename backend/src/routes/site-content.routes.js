const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/site-content — public: the homepage fetches this to render
// editable text. Returns { "hero.heading": "...", ... }.
router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT key, value FROM site_content");
  const content = {};
  for (const row of rows) content[row.key] = row.value;
  res.json({ content });
});

// PUT /api/site-content — board/superadmin: bulk upsert.
// Body: { "hero.heading": "New heading", ... } — any known key, unknown
// keys are silently accepted too (lets the editable set grow without a
// backend change, same spirit as the key/value table itself).
router.put("/", requireAdmin, async (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }
  for (const key of keys) {
    if (typeof updates[key] !== "string") {
      return res.status(400).json({ error: `${key} must be a string` });
    }
  }

  for (const key of keys) {
    await db.query(
      `INSERT INTO site_content (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, updates[key]]
    );
  }

  const { rows } = await db.query("SELECT key, value FROM site_content");
  const content = {};
  for (const row of rows) content[row.key] = row.value;
  res.json({ content });
});

module.exports = router;
