const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireDesk } = require("../middleware/auth");
const { createPaymentLink } = require("../square");

const router = express.Router();
router.use(requireDesk);

const MANUAL_METHODS = ["cash", "venmo", "zelle", "paypal"];
const ALL_METHODS = ["square", ...MANUAL_METHODS];

const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
router.use(actionLimiter);

/* ============================================================
   GET /api/desk/events — events to choose from (soonest first).
   ============================================================ */
router.get("/events", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM events ORDER BY event_date ASC");
  res.json({ events: rows });
});

/* ============================================================
   GET /api/desk/events/:id — one event's details + pricing options.
   ============================================================ */
router.get("/events/:id", async (req, res) => {
  const eventResult = await db.query("SELECT * FROM events WHERE id = $1", [req.params.id]);
  if (!eventResult.rows[0]) return res.status(404).json({ error: "Event not found" });

  const optionsResult = await db.query(
    "SELECT id, kind, label, member_amount_cents, non_member_amount_cents, display_order FROM event_pricing_options WHERE event_id = $1 ORDER BY kind, display_order",
    [req.params.id]
  );
  res.json({ event: eventResult.rows[0], options: optionsResult.rows });
});

/* ============================================================
   GET /api/desk/events/:id/attendees — everyone registered, for
   search/check-in and the live totals panel.
   ============================================================ */
router.get("/events/:id/attendees", async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, m.first_name, m.last_name, m.email, m.phone,
            (m.payment_status = 'paid') AS is_member
     FROM rsvps r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = $1 ORDER BY r.created_at`,
    [req.params.id]
  );

  if (rows.length) {
    const selectionsResult = await db.query(
      `SELECT s.rsvp_id, s.quantity, s.amount_cents, o.kind, o.label
       FROM rsvp_selections s JOIN event_pricing_options o ON o.id = s.pricing_option_id
       WHERE s.rsvp_id = ANY($1::uuid[])
       ORDER BY o.kind, o.display_order`,
      [rows.map((r) => r.id)]
    );
    const byRsvp = new Map();
    for (const s of selectionsResult.rows) {
      if (!byRsvp.has(s.rsvp_id)) byRsvp.set(s.rsvp_id, []);
      byRsvp.get(s.rsvp_id).push(s);
    }
    for (const r of rows) r.selections = byRsvp.get(r.id) || [];
  }

  res.json({ attendees: rows });
});

/* ============================================================
   GET /api/desk/events/:id/totals — live running totals: headcounts
   by status, and money collected today by payment method.
   ============================================================ */
router.get("/events/:id/totals", async (req, res) => {
  const counts = await db.query(
    `SELECT status, COUNT(*)::int AS n FROM rsvps WHERE event_id = $1 GROUP BY status`,
    [req.params.id]
  );
  const byMethod = await db.query(
    `SELECT method, COUNT(*)::int AS n, COALESCE(SUM(amount_cents), 0)::int AS amount_cents
     FROM payments
     WHERE event_id = $1 AND status = 'completed'
     GROUP BY method`,
    [req.params.id]
  );
  const checkedIn = await db.query(
    `SELECT COUNT(*)::int AS n FROM rsvps WHERE event_id = $1 AND checked_in_at IS NOT NULL`,
    [req.params.id]
  );
  res.json({
    by_status: counts.rows,
    by_method: byMethod.rows,
    checked_in: checkedIn.rows[0].n,
    total_collected_cents: byMethod.rows.reduce((sum, r) => sum + r.amount_cents, 0),
  });
});

/* ============================================================
   GET /api/desk/members/search?q= — look up an existing member by
   name or email, so desk staff don't re-create someone who's
   already in the system.
   ============================================================ */
router.get("/members/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ members: [] });

  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, phone, membership_tier, payment_status
     FROM members
     WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1
       OR (first_name || ' ' || last_name) ILIKE $1
     ORDER BY first_name, last_name LIMIT 15`,
    [`%${q}%`]
  );
  res.json({ members: rows });
});

/* ============================================================
   PUT /api/desk/rsvps/:id/checkin — mark attended / undo.
   Body: { checked_in: true|false } — defaults to true.
   ============================================================ */
router.put("/rsvps/:id/checkin", async (req, res) => {
  const checkedIn = req.body && req.body.checked_in === false ? false : true;

  const { rows } = await db.query(
    `UPDATE rsvps SET
       status = $1,
       checked_in_by_desk_staff_id = $2,
       checked_in_at = $3
     WHERE id = $4 AND status IN ('registered', 'attended')
     RETURNING id, status, checked_in_at`,
    [checkedIn ? "attended" : "registered", checkedIn ? req.desk.sub : null, checkedIn ? new Date() : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "RSVP not found (or not eligible for check-in — payment may still be pending)" });
  res.json({ rsvp: rows[0] });
});

/* ------------------------------------------------------------
   Shared helpers
   ------------------------------------------------------------ */

async function resolveOrCreateMember({ member_id, first_name, last_name, email, phone }) {
  if (member_id) {
    const { rows } = await db.query("SELECT * FROM members WHERE id = $1", [member_id]);
    if (!rows[0]) throw Object.assign(new Error("Member not found"), { status: 404 });
    return rows[0];
  }

  if (!first_name || !last_name) {
    throw Object.assign(new Error("first_name and last_name are required for a new registrant"), { status: 400 });
  }

  if (email) {
    const existing = await db.query("SELECT * FROM members WHERE email = $1", [email]);
    if (existing.rows[0]) return existing.rows[0];
  }
  const finalEmail = email || `walkin-${crypto.randomUUID()}@no-email.ritamilsangam.local`;

  const { rows } = await db.query(
    `INSERT INTO members (first_name, last_name, email, phone, membership_tier, payment_status)
     VALUES ($1, $2, $3, $4, 'individual', 'pending')
     RETURNING *`,
    [first_name, last_name, finalEmail, phone || null]
  );
  return rows[0];
}

function validateMethod(method) {
  if (!ALL_METHODS.includes(method)) {
    throw Object.assign(new Error(`payment_method must be one of: ${ALL_METHODS.join(", ")}`), { status: 400 });
  }
}

async function finalizePayment({ member, event, amountCents, lineItems, purpose, tier, eventId, rsvpId, method, deskStaffId }) {
  if (amountCents === 0) return { free: true };

  if (method === "square") {
    const paymentRow = await db.query(
      `INSERT INTO payments (member_id, purpose, tier, event_id, rsvp_id, amount_cents, status, method, recorded_by_desk_staff_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'square', $7) RETURNING id`,
      [member.id, purpose, tier || null, eventId || null, rsvpId || null, amountCents, deskStaffId]
    );
    const paymentId = paymentRow.rows[0].id;
    const portalUrl = process.env.PORTAL_URL || "http://localhost:8420/portal";
    const redirectUrl = `${portalUrl}/payment-complete.html?payment_id=${paymentId}`;
    const { checkoutUrl, squareOrderId, paymentLinkId } = await createPaymentLink({
      referenceId: paymentId,
      lineItems,
      redirectUrl,
    });
    await db.query(
      "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
      [squareOrderId, paymentLinkId, paymentId]
    );
    return { checkout_url: checkoutUrl, payment_id: paymentId };
  }

  // Manual method — desk staff has already collected payment in person.
  await db.query(
    `INSERT INTO payments (member_id, purpose, tier, event_id, rsvp_id, amount_cents, status, method, recorded_by_desk_staff_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8)`,
    [member.id, purpose, tier || null, eventId || null, rsvpId || null, amountCents, method, deskStaffId]
  );
  return { collected: true };
}

/* ============================================================
   POST /api/desk/events/:id/register — fresh registration for
   someone (existing member, or a walk-in created on the spot) who
   isn't already registered for this event.
   ============================================================ */
router.post("/events/:id/register", async (req, res) => {
  const { member_id, first_name, last_name, email, phone, participation_option_id, addons, payment_method } = req.body || {};
  const eventId = req.params.id;

  try {
    validateMethod(payment_method);

    const eventResult = await db.query("SELECT id, name FROM events WHERE id = $1", [eventId]);
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ error: "Event not found" });

    const member = await resolveOrCreateMember({ member_id, first_name, last_name, email, phone });

    const existingRsvp = await db.query(
      "SELECT status FROM rsvps WHERE member_id = $1 AND event_id = $2",
      [member.id, eventId]
    );
    if (existingRsvp.rows[0] && ["registered", "attended"].includes(existingRsvp.rows[0].status)) {
      return res.status(409).json({ error: "This person is already registered for this event — use the add-items option to add more." });
    }

    const isActiveMember = member.payment_status === "paid";
    const optionsResult = await db.query(
      "SELECT id, kind, label, member_amount_cents, non_member_amount_cents FROM event_pricing_options WHERE event_id = $1",
      [eventId]
    );
    const options = optionsResult.rows;
    const optionsById = new Map(options.map((o) => [o.id, o]));
    const priceFor = (opt) => (isActiveMember ? opt.member_amount_cents : opt.non_member_amount_cents);
    const priceQualifier = isActiveMember ? "" : " (non-member price)";

    const selections = [];
    let amountCents = 0;
    const lineItems = [];

    const hasParticipationOptions = options.some((o) => o.kind === "participation");
    if (hasParticipationOptions) {
      if (!participation_option_id || !optionsById.has(participation_option_id)) {
        return res.status(400).json({ error: "Please choose a participation option for this event." });
      }
      const opt = optionsById.get(participation_option_id);
      if (opt.kind !== "participation") {
        return res.status(400).json({ error: "participation_option_id must reference a participation option." });
      }
      const unitCents = priceFor(opt);
      selections.push({ option: opt, quantity: 1, amountCents: unitCents });
      amountCents += unitCents;
      lineItems.push({ name: `${event.name} — ${opt.label}${priceQualifier}`, amountCents: unitCents });
    }

    if (Array.isArray(addons)) {
      for (const addon of addons) {
        const opt = optionsById.get(addon.option_id);
        if (!opt || opt.kind !== "addon") {
          return res.status(400).json({ error: "Invalid add-on selected." });
        }
        const qty = Math.max(1, parseInt(addon.quantity, 10) || 1);
        const unitCents = priceFor(opt);
        selections.push({ option: opt, quantity: qty, amountCents: unitCents * qty });
        amountCents += unitCents * qty;
        lineItems.push({ name: `${event.name} — ${opt.label}${priceQualifier}`, quantity: qty, amountCents: unitCents });
      }
    }

    // Manual-method payments are confirmed on the spot; Square still waits for the webhook.
    const rsvpStatus = amountCents === 0 ? "registered" : payment_method === "square" ? "pending_payment" : "registered";
    const rsvpResult = await db.query(
      `INSERT INTO rsvps (member_id, event_id, amount_cents, status, member_at_registration)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, event_id)
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents, status = EXCLUDED.status, member_at_registration = EXCLUDED.member_at_registration
       RETURNING id`,
      [member.id, eventId, amountCents, rsvpStatus, isActiveMember]
    );
    const rsvpId = rsvpResult.rows[0].id;

    await db.query("DELETE FROM rsvp_selections WHERE rsvp_id = $1", [rsvpId]);
    for (const s of selections) {
      await db.query(
        "INSERT INTO rsvp_selections (rsvp_id, pricing_option_id, quantity, amount_cents) VALUES ($1, $2, $3, $4)",
        [rsvpId, s.option.id, s.quantity, s.amountCents]
      );
    }

    const result = await finalizePayment({
      member, event, amountCents, lineItems, purpose: "event", eventId, rsvpId,
      method: payment_method, deskStaffId: req.desk.sub,
    });

    res.status(201).json({ member_id: member.id, rsvp_id: rsvpId, amount_cents: amountCents, ...result });
  } catch (err) {
    console.error("Desk registration failed:", err);
    res.status(err.status || 502).json({ error: err.message || "Could not complete registration." });
  }
});

/* ============================================================
   POST /api/desk/events/:id/add-items — add more participation/
   add-ons for someone already registered (e.g. they want food too).
   ============================================================ */
router.post("/events/:id/add-items", async (req, res) => {
  const { member_id, addons, payment_method } = req.body || {};
  const eventId = req.params.id;

  try {
    validateMethod(payment_method);
    if (!member_id) return res.status(400).json({ error: "member_id is required" });
    if (!Array.isArray(addons) || !addons.length) return res.status(400).json({ error: "addons is required" });

    const eventResult = await db.query("SELECT id, name FROM events WHERE id = $1", [eventId]);
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ error: "Event not found" });

    const memberResult = await db.query("SELECT id, payment_status FROM members WHERE id = $1", [member_id]);
    const member = memberResult.rows[0];
    if (!member) return res.status(404).json({ error: "Member not found" });

    const rsvpResult = await db.query(
      "SELECT id, status FROM rsvps WHERE member_id = $1 AND event_id = $2",
      [member_id, eventId]
    );
    const rsvp = rsvpResult.rows[0];
    if (!rsvp || !["registered", "attended"].includes(rsvp.status)) {
      return res.status(400).json({ error: "This person isn't registered for this event yet — use Register instead." });
    }

    const isActiveMember = member.payment_status === "paid";
    const optionsResult = await db.query(
      "SELECT id, kind, label, member_amount_cents, non_member_amount_cents FROM event_pricing_options WHERE event_id = $1 AND kind = 'addon'",
      [eventId]
    );
    const optionsById = new Map(optionsResult.rows.map((o) => [o.id, o]));
    const priceFor = (opt) => (isActiveMember ? opt.member_amount_cents : opt.non_member_amount_cents);
    const priceQualifier = isActiveMember ? "" : " (non-member price)";

    const newSelections = [];
    const lineItems = [];
    let amountCents = 0;
    for (const addon of addons) {
      const opt = optionsById.get(addon.option_id);
      if (!opt) return res.status(400).json({ error: "Invalid add-on selected." });
      const qty = Math.max(1, parseInt(addon.quantity, 10) || 1);
      const unitCents = priceFor(opt);
      newSelections.push({ option: opt, quantity: qty, amountCents: unitCents * qty });
      amountCents += unitCents * qty;
      lineItems.push({ name: `${event.name} — ${opt.label}${priceQualifier}`, quantity: qty, amountCents: unitCents });
    }

    if (payment_method === "square") {
      // Deferred, same pattern as the member portal's Buy More — applied on webhook confirm.
      const pendingSelections = newSelections.map((s) => ({
        pricing_option_id: s.option.id, quantity: s.quantity, amount_cents: s.amountCents,
      }));
      const paymentRow = await db.query(
        `INSERT INTO payments (member_id, purpose, event_id, rsvp_id, amount_cents, status, method, recorded_by_desk_staff_id, pending_selections)
         VALUES ($1, 'event', $2, $3, $4, 'pending', 'square', $5, $6) RETURNING id`,
        [member_id, eventId, rsvp.id, amountCents, req.desk.sub, JSON.stringify(pendingSelections)]
      );
      const paymentId = paymentRow.rows[0].id;
      const portalUrl = process.env.PORTAL_URL || "http://localhost:8420/portal";
      const redirectUrl = `${portalUrl}/payment-complete.html?payment_id=${paymentId}`;
      const { checkoutUrl, squareOrderId, paymentLinkId } = await createPaymentLink({
        referenceId: paymentId, lineItems, redirectUrl,
      });
      await db.query(
        "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
        [squareOrderId, paymentLinkId, paymentId]
      );
      return res.json({ checkout_url: checkoutUrl, payment_id: paymentId, amount_cents: amountCents });
    }

    // Manual method — apply immediately, no webhook to wait for.
    for (const s of newSelections) {
      await db.query(
        "INSERT INTO rsvp_selections (rsvp_id, pricing_option_id, quantity, amount_cents) VALUES ($1, $2, $3, $4)",
        [rsvp.id, s.option.id, s.quantity, s.amountCents]
      );
    }
    await db.query("UPDATE rsvps SET amount_cents = amount_cents + $1 WHERE id = $2", [amountCents, rsvp.id]);
    await db.query(
      `INSERT INTO payments (member_id, purpose, event_id, rsvp_id, amount_cents, status, method, recorded_by_desk_staff_id)
       VALUES ($1, 'event', $2, $3, $4, 'completed', $5, $6)`,
      [member_id, eventId, rsvp.id, amountCents, payment_method, req.desk.sub]
    );
    res.status(201).json({ amount_cents: amountCents, collected: true });
  } catch (err) {
    console.error("Desk add-items failed:", err);
    res.status(err.status || 502).json({ error: err.message || "Could not add items." });
  }
});

module.exports = router;
