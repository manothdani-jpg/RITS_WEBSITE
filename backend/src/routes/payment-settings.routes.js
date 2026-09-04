const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/payment-settings — public: the payment page, membership signup
// form, and member portal all read this. Only active categories — see
// /api/membership-categories for the full admin-managed list (incl. archived).
router.get("/", async (req, res) => {
  const tiers = await db.query(
    "SELECT key, label, amount_cents FROM membership_categories WHERE is_active = true ORDER BY display_order, label"
  );
  const content = await db.query("SELECT heading, intro_text, instructions FROM payment_page_content WHERE id = 1");
  res.json({ tiers: tiers.rows, content: content.rows[0] });
});

// PUT /api/payment-settings — board/superadmin edits the payment page's
// heading/intro/instructions text. Dues amounts and categories themselves
// are managed at /api/membership-categories.
router.put("/", requireAdmin, async (req, res) => {
  const { content } = req.body || {};

  if (content) {
    const { heading, intro_text, instructions } = content;
    await db.query(
      `UPDATE payment_page_content SET
         heading = COALESCE($1, heading),
         intro_text = COALESCE($2, intro_text),
         instructions = COALESCE($3, instructions),
         updated_at = now()
       WHERE id = 1`,
      [heading || null, intro_text || null, instructions || null]
    );
  }

  const contentOut = await db.query("SELECT heading, intro_text, instructions FROM payment_page_content WHERE id = 1");
  res.json({ content: contentOut.rows[0] });
});

module.exports = router;
