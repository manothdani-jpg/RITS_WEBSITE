const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

const RENEWAL_TYPES = ["rolling", "fixed_date"];

// Validates the renewal-rule fields shared by POST/PUT. `partial` is true
// for PUT, where an omitted field means "leave it as-is" rather than
// "use the default" — same convention as sanitizeMemberInput elsewhere.
function parseRenewalRule(body, { partial }) {
  const out = {};
  if (body.renewal_type !== undefined) {
    if (!RENEWAL_TYPES.includes(body.renewal_type)) {
      throw new Error(`renewal_type must be one of: ${RENEWAL_TYPES.join(", ")}`);
    }
    out.renewal_type = body.renewal_type;
  }
  if (out.renewal_type === undefined && !partial) out.renewal_type = "rolling";
  const renewalType = out.renewal_type;

  if (body.renewal_months !== undefined) {
    const months = Number(body.renewal_months);
    if (!Number.isInteger(months) || months <= 0) {
      throw new Error("renewal_months must be a positive integer");
    }
    out.renewal_months = months;
  } else if (!partial) {
    out.renewal_months = 12;
  }

  if (body.renewal_month !== undefined || body.renewal_day !== undefined) {
    const month = Number(body.renewal_month);
    const day = Number(body.renewal_day);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error("renewal_month must be an integer from 1 to 12");
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error("renewal_day must be an integer from 1 to 31");
    }
    // Reject impossible calendar dates (e.g. Feb 30) rather than letting
    // Date's auto-rollover silently shift them into the next month.
    const check = new Date(Date.UTC(2024, month - 1, day));
    if (check.getUTCMonth() !== month - 1) {
      throw new Error(`${month}/${day} isn't a valid calendar date`);
    }
    out.renewal_month = month;
    out.renewal_day = day;
  }

  if (renewalType === "fixed_date" && out.renewal_month === undefined && partial) {
    // Switching an existing category to fixed_date without supplying a
    // month/day in the same request — the DB constraint would reject this,
    // so fail with a clearer message up front.
    throw new Error("renewal_month and renewal_day are required when renewal_type is fixed_date");
  }
  if (!partial && renewalType === "fixed_date" && out.renewal_month === undefined) {
    throw new Error("renewal_month and renewal_day are required when renewal_type is fixed_date");
  }

  return out;
}

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
  let renewal;
  try {
    renewal = parseRenewalRule(req.body || {}, { partial: false });
  } catch (err) {
    return res.status(400).json({ error: err.message });
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
    `INSERT INTO membership_categories (key, label, amount_cents, display_order, renewal_type, renewal_months, renewal_month, renewal_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [key, label.trim(), cents, display_order || 0, renewal.renewal_type, renewal.renewal_months, renewal.renewal_month || null, renewal.renewal_day || null]
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
  let renewal;
  try {
    renewal = parseRenewalRule(req.body || {}, { partial: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { rows } = await db.query(
    `UPDATE membership_categories SET
       label = COALESCE($1, label),
       amount_cents = COALESCE($2, amount_cents),
       display_order = COALESCE($3, display_order),
       is_active = COALESCE($4, is_active),
       renewal_type = COALESCE($5, renewal_type),
       renewal_months = COALESCE($6, renewal_months),
       renewal_month = CASE WHEN $5 = 'rolling' THEN NULL ELSE COALESCE($7, renewal_month) END,
       renewal_day = CASE WHEN $5 = 'rolling' THEN NULL ELSE COALESCE($8, renewal_day) END
     WHERE id = $9 RETURNING *`,
    [label, cents, display_order, is_active, renewal.renewal_type, renewal.renewal_months, renewal.renewal_month, renewal.renewal_day, req.params.id]
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
