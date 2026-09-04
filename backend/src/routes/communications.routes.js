const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { sendEmail } = require("../email");

const router = express.Router();

const PAYMENT_STATUSES = ["pending", "paid", "overdue", "waived"];

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many communications sent this hour. Please try again later." },
});

router.use(requireAdmin);

// GET /api/communications/recipient-count?tier=&status= — preview how many
// members a given filter would reach, before sending.
router.get("/recipient-count", async (req, res) => {
  const { conditions, params } = buildFilter(req.query);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM members ${where}`, params);
  res.json({ count: rows[0].n });
});

// POST /api/communications/send — email a subject/body to filtered members.
router.post("/send", sendLimiter, async (req, res) => {
  const { subject, body, tier, payment_status } = req.body || {};
  if (!subject || !body) {
    return res.status(400).json({ error: "subject and body are required" });
  }
  if (payment_status && !PAYMENT_STATUSES.includes(payment_status)) {
    return res.status(400).json({ error: `payment_status must be one of: ${PAYMENT_STATUSES.join(", ")}` });
  }

  const { conditions, params } = buildFilter({ tier, status: payment_status });
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows: recipients } = await db.query(
    `SELECT first_name, email FROM members ${where}`,
    params
  );

  if (recipients.length === 0) {
    return res.status(400).json({ error: "No members match that filter — nothing to send." });
  }

  let delivered = 0;
  let failed = 0;
  for (const member of recipients) {
    try {
      const personalized = body.replace(/\{\{\s*first_name\s*\}\}/gi, member.first_name);
      await sendEmail({
        to: member.email,
        subject,
        text: personalized,
        html: personalized.replace(/\n/g, "<br>"),
      });
      delivered += 1;
    } catch (err) {
      console.error(`Failed to send communication to ${member.email}:`, err.message);
      failed += 1;
    }
  }

  res.json({ recipient_count: recipients.length, delivered, failed });
});

function buildFilter(query) {
  const conditions = [];
  const params = [];
  if (query.tier) {
    params.push(query.tier);
    conditions.push(`membership_tier = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`payment_status = $${params.length}`);
  }
  return { conditions, params };
}

module.exports = router;
