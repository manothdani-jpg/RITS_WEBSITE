const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAdmin, requireMember } = require("../middleware/auth");
const { sendEmail } = require("../email");

const router = express.Router();

const rsvpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many RSVP attempts. Please try again later." },
});

// Priced events (any pricing options configured) must go through
// POST /api/payments/event-checkout instead of the free-RSVP routes below.
async function eventHasPricing(eventId) {
  const { rows } = await db.query(
    "SELECT 1 FROM event_pricing_options WHERE event_id = $1 LIMIT 1",
    [eventId]
  );
  return rows.length > 0;
}

// Best-effort confirmation email for a free RSVP — never lets a delivery
// failure affect the RSVP itself, since the response has already succeeded.
async function sendRsvpConfirmation(to, firstName, eventId) {
  try {
    const { rows } = await db.query("SELECT name, event_date, location FROM events WHERE id = $1", [eventId]);
    const ev = rows[0];
    if (!ev) return;
    const when = new Date(ev.event_date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const whereText = ev.location ? ` at ${ev.location}` : "";
    await sendEmail({
      to,
      subject: `You're registered for ${ev.name}`,
      text: `Hi ${firstName || "there"},\n\nYou're confirmed for ${ev.name} on ${when}${whereText}.\n\nSee you there!\n\nRITS`,
      html: `<p>Hi ${firstName || "there"},</p><p>You're confirmed for <strong>${ev.name}</strong> on ${when}${whereText}.</p><p>See you there!</p><p>RITS</p>`,
    });
  } catch (err) {
    console.error("Failed to send RSVP confirmation email:", err);
  }
}

// POST /api/rsvps — public fallback: a member (identified by email) RSVPs
// without logging in. Prefer /api/rsvps/me from the member portal when possible.
router.post("/", rsvpLimiter, async (req, res) => {
  const { email, event_id, guest_count } = req.body || {};
  if (!email || !event_id) {
    return res.status(400).json({ error: "email and event_id are required" });
  }

  const memberResult = await db.query("SELECT id, first_name, payment_status FROM members WHERE email = $1", [email]);
  const member = memberResult.rows[0];
  if (!member) {
    return res.status(404).json({ error: "No member found with that email. Please become a member first." });
  }

  if (await eventHasPricing(event_id)) {
    return res.status(400).json({ error: "This event has priced registration options. Please log in to the member portal to register and pay." });
  }

  try {
    const isMember = member.payment_status === "paid";
    const { rows } = await db.query(
      `INSERT INTO rsvps (member_id, event_id, guest_count, member_at_registration)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (member_id, event_id)
       DO UPDATE SET guest_count = EXCLUDED.guest_count, status = 'registered', member_at_registration = EXCLUDED.member_at_registration
       RETURNING *`,
      [member.id, event_id, guest_count || 0, isMember]
    );
    await sendRsvpConfirmation(email, member.first_name, event_id);
    res.status(201).json({ rsvp: rows[0] });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(404).json({ error: "Event not found" });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create RSVP" });
  }
});

/* ---------------- Member self-service ---------------- */

// POST /api/rsvps/me — the logged-in member RSVPs for themselves
router.post("/me", rsvpLimiter, requireMember, async (req, res) => {
  const { event_id, guest_count } = req.body || {};
  if (!event_id) return res.status(400).json({ error: "event_id is required" });

  if (await eventHasPricing(event_id)) {
    return res.status(400).json({ error: "This event has priced registration options — use /api/payments/event-checkout instead." });
  }

  try {
    const memberResult = await db.query("SELECT payment_status FROM members WHERE id = $1", [req.member.sub]);
    const isMember = memberResult.rows[0] && memberResult.rows[0].payment_status === "paid";
    const { rows } = await db.query(
      `INSERT INTO rsvps (member_id, event_id, guest_count, member_at_registration)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (member_id, event_id)
       DO UPDATE SET guest_count = EXCLUDED.guest_count, status = 'registered', member_at_registration = EXCLUDED.member_at_registration
       RETURNING *`,
      [req.member.sub, event_id, guest_count || 0, isMember]
    );
    await sendRsvpConfirmation(req.member.email, req.member.name, event_id);
    res.status(201).json({ rsvp: rows[0] });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(404).json({ error: "Event not found" });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create RSVP" });
  }
});

// DELETE /api/rsvps/me/:eventId — the logged-in member cancels their own RSVP.
// Soft-cancel (not a hard delete) so it still shows up in their RSVP history.
router.delete("/me/:eventId", requireMember, async (req, res) => {
  const { rowCount } = await db.query(
    "UPDATE rsvps SET status = 'cancelled' WHERE member_id = $1 AND event_id = $2",
    [req.member.sub, req.params.eventId]
  );
  if (!rowCount) return res.status(404).json({ error: "RSVP not found" });
  res.status(204).send();
});

/* ---------------- Admin-only below ---------------- */
router.use(requireAdmin);

// PUT /api/rsvps/:id — update status (e.g. mark attended)
router.put("/:id", async (req, res) => {
  const { status, guest_count } = req.body || {};
  const { rows } = await db.query(
    `UPDATE rsvps SET
       status = COALESCE($1, status),
       guest_count = COALESCE($2, guest_count)
     WHERE id = $3 RETURNING *`,
    [status, guest_count, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "RSVP not found" });
  res.json({ rsvp: rows[0] });
});

router.delete("/:id", async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM rsvps WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "RSVP not found" });
  res.status(204).send();
});

module.exports = router;
