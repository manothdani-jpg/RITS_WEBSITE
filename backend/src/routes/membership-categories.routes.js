const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

function slugify(label) {
  return String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// GET /api/membership-categories — admin: every category, active + archived,
// for the management list and any dropdown that needs to show a member's
// current (possibly archived) tier correctly.
router.get("/", requireAdmin, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM membership_categories ORDER BY display_order, label");
  res.json({ categories: rows });
});

// POST /api/membership-categories — add a new category. Key is
// auto-generated from the label (slugified), made unique if it collides.
router.post("/", requireAdmin, async (req, res) => {
  const { label, amount_cents, display_order } = req.body || {};
  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ error: "label is required" });
  }
  const cents = Number(amount_cents);
  if (!Number.isInteger(cents) || cents < 0) {
    return res.status(400).json({ error: "amount_cents must be a non-negative integer" });
  }

  let key = slugify(label);
  if (!key) return res.status(400).json({ error: "label must contain at least one letter or number" });

  const existing = await db.query("SELECT key FROM membership_categories WHERE key LIKE $1", [key + "%"]);
  if (existing.rows.some((r) => r.key === key)) {
    let n = 2;
    while (existing.rows.some((r) => r.key === `${key}_${n}`)) n++;
    key = `${key}_${n}`;
  }

  const { rows } = await db.query(
    `INSERT INTO membership_categories (key, label, amount_cents, display_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [key, label.trim(), cents, display_order || 0]
  );
  res.status(201).json({ category: rows[0] });
});

// PUT /api/membership-categories/:id — edit label/amount/order/active.
// The key never changes once created, so existing members keep working.
router.put("/:id", requireAdmin, async (req, res) => {
  const { label, amount_cents, display_order, is_active } = req.body || {};
  let cents;
  if (amount_cents !== undefined) {
    cents = Number(amount_cents);
    if (!Number.isInteger(cents) || cents < 0) {
      return res.status(400).json({ error: "amount_cents must be a non-negative integer" });
    }
  }
  const { rows } = await db.query(
    `UPDATE membership_categories SET
       label = COALESCE($1, label),
       amount_cents = COALESCE($2, amount_cents),
       display_order = COALESCE($3, display_order),
       is_active = COALESCE($4, is_active)
     WHERE id = $5 RETURNING *`,
    [label, cents, display_order, is_active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Category not found" });
  res.json({ category: rows[0] });
});

// DELETE /api/membership-categories/:id — blocked if any member currently
// has this tier; archive it instead (PUT is_active=false) if it's in use.
router.delete("/:id", requireAdmin, async (req, res) => {
  const categoryResult = await db.query("SELECT key FROM membership_categories WHERE id = $1", [req.params.id]);
  const category = categoryResult.rows[0];
  if (!category) return res.status(404).json({ error: "Category not found" });

  const inUse = await db.query("SELECT COUNT(*)::int AS n FROM members WHERE membership_tier = $1", [category.key]);
  if (inUse.rows[0].n > 0) {
    return res.status(409).json({
      error: `${inUse.rows[0].n} member(s) are still in this category. Archive it instead, or reassign them first.`,
    });
  }

  await db.query("DELETE FROM membership_categories WHERE id = $1", [req.params.id]);
  res.status(204).send();
});

module.exports = router;
