const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireMember, requireAdmin } = require("../middleware/auth");
const { createPaymentLink, WebhooksHelper } = require("../square");

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout attempts. Please try again later." },
});

/* ============================================================
   POST /api/payments/checkout — logged-in member starts a
   Square-hosted checkout for their (or a chosen) membership tier.
   ============================================================ */
router.post("/checkout", checkoutLimiter, requireMember, async (req, res) => {
  try {
    const memberResult = await db.query("SELECT id, membership_tier FROM members WHERE id = $1", [req.member.sub]);
    const member = memberResult.rows[0];
    if (!member) return res.status(404).json({ error: "Member not found" });

    const tier = (req.body && req.body.tier) || member.membership_tier;
    const categoryResult = await db.query("SELECT label, amount_cents FROM membership_categories WHERE key = $1", [tier]);
    const category = categoryResult.rows[0];
    if (!category) {
      return res.status(400).json({ error: "Unknown membership category. Please contact the board." });
    }

    const amountCents = category.amount_cents;
    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: "Dues for this tier haven't been configured yet. Please contact the board." });
    }

    const paymentRow = await db.query(
      `INSERT INTO payments (member_id, purpose, tier, amount_cents, status)
       VALUES ($1, 'membership', $2, $3, 'pending') RETURNING id`,
      [member.id, tier, amountCents]
    );
    const paymentId = paymentRow.rows[0].id;

    const portalUrl = process.env.PORTAL_URL || "http://localhost:8420/portal";
    const redirectUrl = `${portalUrl}/payment-complete.html?payment_id=${paymentId}`;

    const { checkoutUrl, squareOrderId, paymentLinkId } = await createPaymentLink({
      referenceId: paymentId,
      lineItems: [{ name: `RITS Membership Dues — ${category.label}`, amountCents }],
      redirectUrl,
    });

    await db.query(
      "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
      [squareOrderId, paymentLinkId, paymentId]
    );

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId });
  } catch (err) {
    console.error("Failed to create Square checkout:", err);
    res.status(502).json({ error: err.message || "Could not start checkout with Square." });
  }
});

/* ============================================================
   POST /api/payments/event-checkout — logged-in member registers
   for an event with priced options (one participation choice,
   plus any number of add-ons with quantities) and pays via Square.
   Free events (no pricing options, or a $0 total) skip Square
   entirely and just register directly.
   ============================================================ */
router.post("/event-checkout", checkoutLimiter, requireMember, async (req, res) => {
  const { event_id, participation_option_id, addons } = req.body || {};
  if (!event_id) return res.status(400).json({ error: "event_id is required" });

  try {
    const eventResult = await db.query("SELECT id, name FROM events WHERE id = $1", [event_id]);
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ error: "Event not found" });

    const existingRsvp = await db.query(
      "SELECT status FROM rsvps WHERE member_id = $1 AND event_id = $2",
      [req.member.sub, event_id]
    );
    if (existingRsvp.rows[0] && ["registered", "attended"].includes(existingRsvp.rows[0].status)) {
      return res.status(409).json({ error: "You're already registered for this event — use the add-on purchase option to buy more." });
    }

    const memberResult = await db.query("SELECT payment_status FROM members WHERE id = $1", [req.member.sub]);
    const isActiveMember = memberResult.rows[0] && memberResult.rows[0].payment_status === "paid";

    const optionsResult = await db.query(
      "SELECT id, kind, label, member_amount_cents, non_member_amount_cents FROM event_pricing_options WHERE event_id = $1",
      [event_id]
    );
    const options = optionsResult.rows;
    const optionsById = new Map(options.map((o) => [o.id, o]));
    const priceFor = (opt) => (isActiveMember ? opt.member_amount_cents : opt.non_member_amount_cents);

    const selections = []; // { option, quantity }
    let amountCents = 0;
    const lineItems = [];
    const priceQualifier = isActiveMember ? "" : " (non-member price)";

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

    // Upsert the RSVP row — pending_payment if there's a charge, registered if free.
    const rsvpStatus = amountCents > 0 ? "pending_payment" : "registered";
    const rsvpResult = await db.query(
      `INSERT INTO rsvps (member_id, event_id, amount_cents, status, member_at_registration)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, event_id)
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents, status = EXCLUDED.status, member_at_registration = EXCLUDED.member_at_registration
       RETURNING id`,
      [req.member.sub, event_id, amountCents, rsvpStatus, isActiveMember]
    );
    const rsvpId = rsvpResult.rows[0].id;

    await db.query("DELETE FROM rsvp_selections WHERE rsvp_id = $1", [rsvpId]);
    for (const s of selections) {
      await db.query(
        "INSERT INTO rsvp_selections (rsvp_id, pricing_option_id, quantity, amount_cents) VALUES ($1, $2, $3, $4)",
        [rsvpId, s.option.id, s.quantity, s.amountCents]
      );
    }

    if (amountCents === 0) {
      return res.status(201).json({ rsvp_id: rsvpId, amount_cents: 0, free: true });
    }

    const paymentRow = await db.query(
      `INSERT INTO payments (member_id, purpose, event_id, rsvp_id, amount_cents, status)
       VALUES ($1, 'event', $2, $3, $4, 'pending') RETURNING id`,
      [req.member.sub, event_id, rsvpId, amountCents]
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

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId, rsvp_id: rsvpId, amount_cents: amountCents });
  } catch (err) {
    console.error("Failed to create event checkout:", err);
    res.status(502).json({ error: err.message || "Could not start checkout with Square." });
  }
});

/* ============================================================
   POST /api/payments/event-addon-checkout — a member who's already
   registered for a priced event buys additional add-ons (extra food,
   etc.) on top of what they already paid for. Unlike /event-checkout,
   this never touches the member's existing registration or selections
   — the new picks are held on the payment row and only applied (added
   to rsvps.amount_cents / inserted as rsvp_selections) once Square
   confirms this specific payment. If it fails, nothing changes; the
   original registration is untouched either way.
   ============================================================ */
router.post("/event-addon-checkout", checkoutLimiter, requireMember, async (req, res) => {
  const { event_id, addons } = req.body || {};
  if (!event_id) return res.status(400).json({ error: "event_id is required" });
  if (!Array.isArray(addons) || !addons.length) return res.status(400).json({ error: "addons is required" });

  try {
    const eventResult = await db.query("SELECT id, name FROM events WHERE id = $1", [event_id]);
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ error: "Event not found" });

    const rsvpResult = await db.query(
      "SELECT id, status FROM rsvps WHERE member_id = $1 AND event_id = $2",
      [req.member.sub, event_id]
    );
    const rsvp = rsvpResult.rows[0];
    if (!rsvp || !["registered", "attended"].includes(rsvp.status)) {
      return res.status(400).json({ error: "Register for this event first before buying add-ons." });
    }

    const memberResult = await db.query("SELECT payment_status FROM members WHERE id = $1", [req.member.sub]);
    const isActiveMember = memberResult.rows[0] && memberResult.rows[0].payment_status === "paid";
    const priceQualifier = isActiveMember ? "" : " (non-member price)";

    const optionsResult = await db.query(
      "SELECT id, kind, label, member_amount_cents, non_member_amount_cents FROM event_pricing_options WHERE event_id = $1 AND kind = 'addon'",
      [event_id]
    );
    const optionsById = new Map(optionsResult.rows.map((o) => [o.id, o]));
    const priceFor = (opt) => (isActiveMember ? opt.member_amount_cents : opt.non_member_amount_cents);

    const pendingSelections = [];
    const lineItems = [];
    let amountCents = 0;

    for (const addon of addons) {
      const opt = optionsById.get(addon.option_id);
      if (!opt) return res.status(400).json({ error: "Invalid add-on selected." });
      const qty = Math.max(1, parseInt(addon.quantity, 10) || 1);
      const unitCents = priceFor(opt);
      pendingSelections.push({ pricing_option_id: opt.id, quantity: qty, amount_cents: unitCents * qty });
      amountCents += unitCents * qty;
      lineItems.push({ name: `${event.name} — ${opt.label}${priceQualifier}`, quantity: qty, amountCents: unitCents });
    }

    if (amountCents === 0) {
      for (const s of pendingSelections) {
        await db.query(
          "INSERT INTO rsvp_selections (rsvp_id, pricing_option_id, quantity, amount_cents) VALUES ($1, $2, $3, $4)",
          [rsvp.id, s.pricing_option_id, s.quantity, s.amount_cents]
        );
      }
      return res.status(201).json({ rsvp_id: rsvp.id, amount_cents: 0, free: true });
    }

    const paymentRow = await db.query(
      `INSERT INTO payments (member_id, purpose, event_id, rsvp_id, amount_cents, status, pending_selections)
       VALUES ($1, 'event', $2, $3, $4, 'pending', $5) RETURNING id`,
      [req.member.sub, event_id, rsvp.id, amountCents, JSON.stringify(pendingSelections)]
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

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId, rsvp_id: rsvp.id, amount_cents: amountCents });
  } catch (err) {
    console.error("Failed to create event add-on checkout:", err);
    res.status(502).json({ error: err.message || "Could not start checkout with Square." });
  }
});

/* ============================================================
   GET /api/payments/me — the logged-in member's payment history.
   ============================================================ */
router.get("/me", requireMember, async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id, p.purpose, p.tier, p.event_id, p.rsvp_id, p.amount_cents, p.status, p.created_at, p.updated_at,
            e.name AS event_name
     FROM payments p
     LEFT JOIN events e ON e.id = p.event_id
     WHERE p.member_id = $1 ORDER BY p.created_at DESC`,
    [req.member.sub]
  );
  res.json({ payments: rows });
});

/* ============================================================
   POST /api/payments/webhook — Square calls this when a payment's
   status changes. Verifies the signature before trusting anything.
   ============================================================ */
router.post("/webhook", async (req, res) => {
  const signatureHeader = req.headers["x-square-hmacsha256-signature"];
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL;

  if (!signatureKey || !notificationUrl) {
    console.error("Square webhook received but SQUARE_WEBHOOK_SIGNATURE_KEY / SQUARE_WEBHOOK_URL not configured.");
    return res.status(500).send();
  }
  if (!req.rawBody || !signatureHeader) {
    return res.status(400).send();
  }

  let isValid;
  try {
    isValid = await WebhooksHelper.verifySignature({
      requestBody: req.rawBody,
      signatureHeader,
      signatureKey,
      notificationUrl,
    });
  } catch (err) {
    console.error("Webhook signature verification error:", err);
    return res.status(400).send();
  }

  if (!isValid) {
    console.warn("Rejected Square webhook with invalid signature.");
    return res.status(400).send();
  }

  const event = req.body;

  try {
    if (event.type === "payment.created" || event.type === "payment.updated") {
      const payment = event.data && event.data.object && event.data.object.payment;
      if (payment && payment.order_id) {
        await handlePaymentUpdate(payment);
      }
    }
  } catch (err) {
    console.error("Error processing Square webhook:", err);
    // Still 200 — Square retries on non-2xx, and we don't want infinite retries for a bug on our end.
  }

  res.status(200).send();
});

async function handlePaymentUpdate(squarePayment) {
  const { rows } = await db.query(
    "SELECT id, member_id, purpose, rsvp_id, status, amount_cents, pending_selections FROM payments WHERE square_order_id = $1",
    [squarePayment.order_id]
  );
  const paymentRow = rows[0];
  if (!paymentRow) {
    console.warn(`Webhook for unknown Square order_id: ${squarePayment.order_id}`);
    return;
  }
  if (paymentRow.status === "completed") return; // already processed — idempotent

  // An add-on top-up payment (event-addon-checkout) never touches the
  // member's existing registration — it carries its own selections to
  // apply on success, and is simply left failed/cancelled on failure.
  const isAddonTopUp = paymentRow.purpose === "event" && !!paymentRow.pending_selections;

  if (squarePayment.status === "COMPLETED") {
    await db.query(
      "UPDATE payments SET status = 'completed', square_payment_id = $1 WHERE id = $2",
      [squarePayment.id, paymentRow.id]
    );

    if (isAddonTopUp) {
      for (const s of paymentRow.pending_selections) {
        await db.query(
          "INSERT INTO rsvp_selections (rsvp_id, pricing_option_id, quantity, amount_cents) VALUES ($1, $2, $3, $4)",
          [paymentRow.rsvp_id, s.pricing_option_id, s.quantity, s.amount_cents]
        );
      }
      await db.query(
        "UPDATE rsvps SET amount_cents = amount_cents + $1 WHERE id = $2",
        [paymentRow.amount_cents, paymentRow.rsvp_id]
      );
    } else if (paymentRow.purpose === "event") {
      if (paymentRow.rsvp_id) {
        await db.query("UPDATE rsvps SET status = 'registered' WHERE id = $1", [paymentRow.rsvp_id]);
      }
    } else {
      const renewalDate = new Date();
      renewalDate.setFullYear(renewalDate.getFullYear() + 1);
      await db.query(
        "UPDATE members SET payment_status = 'paid', renewal_date = $1 WHERE id = $2",
        [renewalDate.toISOString().slice(0, 10), paymentRow.member_id]
      );
    }
  } else if (["FAILED", "CANCELED"].includes(squarePayment.status)) {
    await db.query(
      "UPDATE payments SET status = $1, square_payment_id = $2 WHERE id = $3",
      [squarePayment.status === "CANCELED" ? "cancelled" : "failed", squarePayment.id, paymentRow.id]
    );
    if (!isAddonTopUp && paymentRow.purpose === "event" && paymentRow.rsvp_id) {
      await db.query("UPDATE rsvps SET status = 'cancelled' WHERE id = $1", [paymentRow.rsvp_id]);
    }
  }
}

/* ============================================================
   Admin/board — list all payments for reconciliation.
   ============================================================ */
router.get("/", requireAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, m.first_name, m.last_name, m.email, e.name AS event_name
     FROM payments p
     JOIN members m ON m.id = p.member_id
     LEFT JOIN events e ON e.id = p.event_id
     ORDER BY p.created_at DESC LIMIT 200`
  );
  res.json({ payments: rows });
});

module.exports = router;
