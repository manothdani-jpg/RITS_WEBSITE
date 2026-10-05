const express = require("express");
const db = require("../db");
const { requireAdmin, requireRole } = require("../middleware/auth");
const { getSquareSettings } = require("../checkout");

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

// Where a payer is sent, and how payments get confirmed, changes where
// money goes — so unlike the page text above, this is superadmin-only.
function cleanLink(value, label) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    throw new Error(`${label} isn't a valid web address.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must start with https://`);
  return url.toString();
}

// GET /api/payment-settings/square — current Square mode + links, plus
// whether the API credentials in the backend's .env are actually set.
router.get("/square", requireRole(["superadmin"]), async (req, res) => {
  const settings = await getSquareSettings();
  res.json({
    square_mode: settings.square_mode,
    membership_payment_link: settings.membership_payment_link || "",
    event_payment_link: settings.event_payment_link || "",
    api: {
      configured: !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID),
      environment: process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
    },
  });
});

// PUT /api/payment-settings/square
router.put("/square", requireRole(["superadmin"]), async (req, res) => {
  const { square_mode, membership_payment_link, event_payment_link } = req.body || {};
  if (!["api", "links"].includes(square_mode)) {
    return res.status(400).json({ error: "square_mode must be 'api' or 'links'" });
  }

  let membershipLink, eventLink;
  try {
    membershipLink = cleanLink(membership_payment_link, "The membership payment link");
    eventLink = cleanLink(event_payment_link, "The event payment link");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (square_mode === "links" && (!membershipLink || !eventLink)) {
    return res.status(400).json({ error: "Enter both payment links before switching to payment links." });
  }
  if (square_mode === "api" && !(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID)) {
    return res.status(400).json({
      error: "Automatic checkout needs SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID set on the server first. Use payment links until those are configured.",
    });
  }

  await db.query(
    `UPDATE payment_page_content SET square_mode = $1, membership_payment_link = $2, event_payment_link = $3, updated_at = now() WHERE id = 1`,
    [square_mode, membershipLink, eventLink]
  );
  res.json({ square_mode, membership_payment_link: membershipLink || "", event_payment_link: eventLink || "" });
});

module.exports = router;
