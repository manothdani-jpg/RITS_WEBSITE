const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { createPaymentLink } = require("../square");
const { sendEmail, formatMoney } = require("../email");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERFORMANCE_TYPES = ["dance", "singing", "drama", "speech", "other"];
const AGE_CATEGORIES = ["adult", "kid"];

// Best-effort confirmation email for a cultural group registration — a
// delivery failure should never affect the registration that already
// succeeded.
async function sendGroupConfirmation({ to, choreographerName, groupName, eventName, participants, totalCents }) {
  try {
    const rows = participants
      .map((p) => `  - ${p.full_name} (${p.is_member ? "member" : "non-member"}): ${formatMoney(p.fee_cents)}`)
      .join("\n");
    const rowsHtml = participants
      .map((p) => `<li>${p.full_name} (${p.is_member ? "member" : "non-member"}): ${formatMoney(p.fee_cents)}</li>`)
      .join("");
    await sendEmail({
      to,
      subject: `Cultural group registration confirmed — ${groupName}`,
      text:
        `Hi ${choreographerName},\n\n"${groupName}"'s registration for ${eventName} is confirmed:\n\n${rows}\n\n` +
        `Total: ${formatMoney(totalCents)}\n\nRITS`,
      html:
        `<p>Hi ${choreographerName},</p><p>"${groupName}"'s registration for <strong>${eventName}</strong> is confirmed:</p>` +
        `<ul>${rowsHtml}</ul><p>Total: <strong>${formatMoney(totalCents)}</strong></p><p>RITS</p>`,
    });
  } catch (err) {
    console.error("Failed to send cultural group confirmation email:", err);
  }
}

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

/* ============================================================
   POST /api/cultural-groups — public: a choreographer/trainer
   registers a performance group with N participants. Each
   participant's membership is checked by email (if given) and their
   fee is set to the event's member/non-member cultural fee
   accordingly. Pays via Square for the group's total, unless the
   event's cultural fees are both $0.
   ============================================================ */
router.post("/", submitLimiter, async (req, res) => {
  const {
    event_id, group_name, choreographer_name, choreographer_email, choreographer_phone,
    performance_type, description, participants,
  } = req.body || {};

  if (!event_id || !group_name || !choreographer_name || !choreographer_email || !performance_type) {
    return res.status(400).json({ error: "event_id, group_name, choreographer_name, choreographer_email, and performance_type are required" });
  }
  if (!EMAIL_RE.test(choreographer_email)) {
    return res.status(400).json({ error: "A valid choreographer/trainer email is required" });
  }
  if (!PERFORMANCE_TYPES.includes(performance_type)) {
    return res.status(400).json({ error: `performance_type must be one of: ${PERFORMANCE_TYPES.join(", ")}` });
  }
  if (!Array.isArray(participants) || !participants.length) {
    return res.status(400).json({ error: "At least one participant is required" });
  }
  if (participants.length > 100) {
    return res.status(400).json({ error: "That's too many participants for one submission — please contact the board." });
  }
  for (const p of participants) {
    if (!p || !p.full_name || typeof p.full_name !== "string" || !p.full_name.trim()) {
      return res.status(400).json({ error: "Each participant needs a full name" });
    }
    if (!AGE_CATEGORIES.includes(p.age_category)) {
      return res.status(400).json({ error: `Each participant's age category must be one of: ${AGE_CATEGORIES.join(", ")}` });
    }
    if (p.email && !EMAIL_RE.test(p.email)) {
      return res.status(400).json({ error: `"${p.email}" isn't a valid email address` });
    }
  }

  try {
    const eventResult = await db.query(
      "SELECT id, name, cultural_member_fee_cents, cultural_non_member_fee_cents FROM events WHERE id = $1",
      [event_id]
    );
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.cultural_member_fee_cents === null || event.cultural_non_member_fee_cents === null) {
      return res.status(400).json({ error: "Cultural group registration isn't open for this event." });
    }

    // Resolve or create the choreographer as a member, same pattern as
    // front-desk walk-ins — they don't need to already be a RITS member.
    let choreographer;
    const existingChoreographer = await db.query("SELECT * FROM members WHERE email = $1", [choreographer_email]);
    if (existingChoreographer.rows[0]) {
      choreographer = existingChoreographer.rows[0];
    } else {
      const nameParts = choreographer_name.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || firstName;
      const created = await db.query(
        `INSERT INTO members (first_name, last_name, email, phone, membership_tier, payment_status)
         VALUES ($1, $2, $3, $4, 'individual', 'pending') RETURNING *`,
        [firstName, lastName, choreographer_email, choreographer_phone || null]
      );
      choreographer = created.rows[0];
    }

    // Resolve each participant's membership + fee.
    let amountCents = 0;
    const resolved = [];
    for (const p of participants) {
      let memberRow = null;
      if (p.email) {
        const found = await db.query("SELECT id, payment_status FROM members WHERE email = $1", [p.email]);
        memberRow = found.rows[0] || null;
      }
      const isMember = !!(memberRow && memberRow.payment_status === "paid");
      const feeCents = isMember ? event.cultural_member_fee_cents : event.cultural_non_member_fee_cents;
      amountCents += feeCents;
      resolved.push({
        full_name: p.full_name.trim(),
        email: p.email || null,
        age_category: p.age_category,
        member_id: memberRow ? memberRow.id : null,
        is_member: isMember,
        fee_cents: feeCents,
      });
    }

    const groupStatus = amountCents === 0 ? "registered" : "pending_payment";
    const groupResult = await db.query(
      `INSERT INTO cultural_groups
         (event_id, group_name, choreographer_member_id, choreographer_name, choreographer_email, choreographer_phone, performance_type, description, amount_cents, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [event_id, group_name.trim(), choreographer.id, choreographer_name.trim(), choreographer_email, choreographer_phone || null, performance_type, description || null, amountCents, groupStatus]
    );
    const groupId = groupResult.rows[0].id;

    for (const p of resolved) {
      await db.query(
        `INSERT INTO cultural_group_participants (group_id, full_name, email, age_category, member_id, is_member, fee_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [groupId, p.full_name, p.email, p.age_category, p.member_id, p.is_member, p.fee_cents]
      );
    }

    if (amountCents === 0) {
      await sendGroupConfirmation({
        to: choreographer_email,
        choreographerName: choreographer_name,
        groupName: group_name.trim(),
        eventName: event.name,
        participants: resolved,
        totalCents: amountCents,
      });
      return res.status(201).json({ group_id: groupId, amount_cents: 0, free: true });
    }

    const paymentRow = await db.query(
      `INSERT INTO payments (member_id, purpose, cultural_group_id, event_id, amount_cents, status)
       VALUES ($1, 'cultural_group', $2, $3, $4, 'pending') RETURNING id`,
      [choreographer.id, groupId, event_id, amountCents]
    );
    const paymentId = paymentRow.rows[0].id;

    const siteUrl = process.env.SITE_URL || "http://localhost:8420";
    const redirectUrl = `${siteUrl}/cultural-registration-complete.html?payment_id=${paymentId}`;

    const lineItems = resolved.map((p) => ({
      name: `${event.name} — ${p.full_name} (${p.is_member ? "member" : "non-member"})`,
      amountCents: p.fee_cents,
    }));

    const { checkoutUrl, squareOrderId, paymentLinkId } = await createPaymentLink({
      referenceId: paymentId,
      lineItems,
      redirectUrl,
    });
    await db.query(
      "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
      [squareOrderId, paymentLinkId, paymentId]
    );

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId, group_id: groupId, amount_cents: amountCents });
  } catch (err) {
    console.error("Cultural group registration failed:", err);
    res.status(502).json({ error: err.message || "Could not complete registration." });
  }
});

// GET /api/cultural-groups/payment-status/:paymentId — public: the
// payment_id is an unguessable UUID handed only to the submitter via the
// Square redirect, so this is safe without login (same capability-URL
// pattern the confirmation page already relies on for Square's redirect).
// Returns only what the submitter themselves already knows/entered.
router.get("/payment-status/:paymentId", async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.status, p.amount_cents, cg.group_name, e.name AS event_name
     FROM payments p
     LEFT JOIN cultural_groups cg ON cg.id = p.cultural_group_id
     LEFT JOIN events e ON e.id = p.event_id
     WHERE p.id = $1 AND p.purpose = 'cultural_group'`,
    [req.params.paymentId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Payment not found" });
  res.json({ payment: rows[0] });
});

/* ---------------- Admin (both roles) ---------------- */

// GET /api/cultural-groups?event_id= — list groups, with participant
// counts, for the admin Cultural Events view.
router.get("/", requireAdmin, async (req, res) => {
  const eventId = req.query.event_id || null;
  const { rows } = await db.query(
    `SELECT cg.*, e.name AS event_name,
            COUNT(p.id)::int AS participant_count,
            COUNT(*) FILTER (WHERE p.is_member)::int AS member_count,
            COUNT(*) FILTER (WHERE p.age_category = 'kid')::int AS kid_count
     FROM cultural_groups cg
     JOIN events e ON e.id = cg.event_id
     LEFT JOIN cultural_group_participants p ON p.group_id = cg.id
     WHERE ($1::uuid IS NULL OR cg.event_id = $1)
     GROUP BY cg.id, e.name
     ORDER BY cg.created_at DESC`,
    [eventId]
  );
  res.json({ groups: rows });
});

// GET /api/cultural-groups/:id — one group's full participant list.
router.get("/:id", requireAdmin, async (req, res) => {
  const groupResult = await db.query(
    `SELECT cg.*, e.name AS event_name FROM cultural_groups cg JOIN events e ON e.id = cg.event_id WHERE cg.id = $1`,
    [req.params.id]
  );
  if (!groupResult.rows[0]) return res.status(404).json({ error: "Group not found" });

  const participants = await db.query(
    "SELECT * FROM cultural_group_participants WHERE group_id = $1 ORDER BY created_at",
    [req.params.id]
  );
  res.json({ group: groupResult.rows[0], participants: participants.rows });
});

// DELETE /api/cultural-groups/:id — remove a bad/duplicate submission
// (cascades participants; the payment row, if any, is kept for the
// financial record but its cultural_group_id reference just goes null).
router.delete("/:id", requireAdmin, async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM cultural_groups WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Group not found" });
  res.status(204).send();
});

module.exports = router;
