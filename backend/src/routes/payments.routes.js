const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const db = require("../db");
const { requireMember, requireAdmin } = require("../middleware/auth");
const { refundPayment, WebhooksHelper } = require("../square");
const { createCheckout } = require("../checkout");
const { sendEmail, formatMoney } = require("../email");
const { computeRenewalDate } = require("../membership");

const router = express.Router();

// Best-effort confirmation email — a delivery failure should never affect
// the payment/registration flow that already succeeded.
async function sendConfirmationEmail(opts) {
  try {
    await sendEmail(opts);
  } catch (err) {
    console.error("Failed to send confirmation email:", err);
  }
}

function lineItemsToText(lineItems) {
  return lineItems
    .map((li) => `  - ${li.name}${li.quantity && li.quantity > 1 ? ` ×${li.quantity}` : ""}: ${formatMoney(li.amountCents * (li.quantity || 1))}`)
    .join("\n");
}

function lineItemsToHtml(lineItems) {
  return (
    "<ul>" +
    lineItems.map((li) => `<li>${li.name}${li.quantity && li.quantity > 1 ? ` ×${li.quantity}` : ""}: ${formatMoney(li.amountCents * (li.quantity || 1))}</li>`).join("") +
    "</ul>"
  );
}

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

    const { checkoutUrl, squareOrderId, paymentLinkId, manualConfirmation } = await createCheckout({
      kind: "membership",
      referenceId: paymentId,
      lineItems: [{ name: `RITS Membership Dues — ${category.label}`, amountCents }],
      redirectUrl,
    });

    await db.query(
      "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
      [squareOrderId, paymentLinkId, paymentId]
    );

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId, amount_cents: amountCents, manual_confirmation: manualConfirmation });
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
      await sendConfirmationEmail({
        to: req.member.email,
        subject: `You're registered for ${event.name}`,
        text: `Hi ${req.member.name || "there"},\n\nYou're confirmed for ${event.name}:\n\n${lineItemsToText(lineItems)}\n\nSee you there!\n\nRITS`,
        html: `<p>Hi ${req.member.name || "there"},</p><p>You're confirmed for <strong>${event.name}</strong>:</p>${lineItemsToHtml(lineItems)}<p>See you there!</p><p>RITS</p>`,
      });
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

    const { checkoutUrl, squareOrderId, paymentLinkId, manualConfirmation } = await createCheckout({
      kind: "event",
      referenceId: paymentId,
      lineItems,
      redirectUrl,
    });

    await db.query(
      "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
      [squareOrderId, paymentLinkId, paymentId]
    );

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId, rsvp_id: rsvpId, amount_cents: amountCents, manual_confirmation: manualConfirmation });
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
      await sendConfirmationEmail({
        to: req.member.email,
        subject: `Your add-on purchase for ${event.name} is confirmed`,
        text: `Hi ${req.member.name || "there"},\n\nWe've added the following to your registration for ${event.name}:\n\n${lineItemsToText(lineItems)}\n\nRITS`,
        html: `<p>Hi ${req.member.name || "there"},</p><p>We've added the following to your registration for <strong>${event.name}</strong>:</p>${lineItemsToHtml(lineItems)}<p>RITS</p>`,
      });
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

    const { checkoutUrl, squareOrderId, paymentLinkId, manualConfirmation } = await createCheckout({
      kind: "event",
      referenceId: paymentId,
      lineItems,
      redirectUrl,
    });

    await db.query(
      "UPDATE payments SET square_order_id = $1, square_payment_link_id = $2 WHERE id = $3",
      [squareOrderId, paymentLinkId, paymentId]
    );

    res.json({ checkout_url: checkoutUrl, payment_id: paymentId, rsvp_id: rsvp.id, amount_cents: amountCents, manual_confirmation: manualConfirmation });
  } catch (err) {
    console.error("Failed to create event add-on checkout:", err);
    res.status(502).json({ error: err.message || "Could not start checkout with Square." });
  }
});

/* ============================================================
   PUT /api/payments/event-selection — a member reduces or removes an
   add-on they already paid for. Refunds the difference via Square
   before touching any records, so the database can never show more
   refunded than Square actually confirmed. To buy more, use
   /event-addon-checkout instead — this endpoint only ever decreases.
   ============================================================ */
router.put("/event-selection", checkoutLimiter, requireMember, async (req, res) => {
  const { event_id, option_id, quantity } = req.body || {};
  if (!event_id || !option_id) return res.status(400).json({ error: "event_id and option_id are required" });
  const newQuantity = parseInt(quantity, 10);
  if (!Number.isInteger(newQuantity) || newQuantity < 0) {
    return res.status(400).json({ error: "quantity must be a non-negative integer" });
  }

  try {
    const rsvpResult = await db.query(
      "SELECT id, status FROM rsvps WHERE member_id = $1 AND event_id = $2",
      [req.member.sub, event_id]
    );
    const rsvp = rsvpResult.rows[0];
    if (!rsvp || !["registered", "attended"].includes(rsvp.status)) {
      return res.status(400).json({ error: "No active registration found for this event." });
    }

    const currentResult = await db.query(
      `SELECT o.label, SUM(s.quantity)::int AS quantity, SUM(s.amount_cents)::int AS amount_cents
       FROM rsvp_selections s JOIN event_pricing_options o ON o.id = s.pricing_option_id
       WHERE s.rsvp_id = $1 AND s.pricing_option_id = $2
       GROUP BY o.label`,
      [rsvp.id, option_id]
    );
    const current = currentResult.rows[0];
    if (!current || current.quantity === 0) {
      return res.status(404).json({ error: "You don't have that item selected." });
    }
    if (newQuantity >= current.quantity) {
      return res.status(400).json({ error: "That's not a reduction — use the add-on purchase option to buy more instead." });
    }

    const removedQuantity = current.quantity - newQuantity;
    const refundCents = Math.round((removedQuantity / current.quantity) * current.amount_cents);

    let actuallyRefunded = 0;
    if (refundCents > 0) {
      const eligiblePayments = await db.query(
        `SELECT id, square_payment_id, amount_cents FROM payments
         WHERE rsvp_id = $1 AND purpose = 'event' AND status = 'completed' AND square_payment_id IS NOT NULL
         ORDER BY created_at DESC`,
        [rsvp.id]
      );

      let remaining = refundCents;
      for (const p of eligiblePayments.rows) {
        if (remaining <= 0) break;
        const chunk = Math.min(remaining, p.amount_cents);
        try {
          const { refundId } = await refundPayment({
            paymentId: p.square_payment_id,
            amountCents: chunk,
            idempotencyKey: crypto.randomUUID(),
            reason: `Reduced "${current.label}" from ${current.quantity} to ${newQuantity} for an event registration`,
          });
          await db.query(
            `INSERT INTO payments (member_id, purpose, event_id, rsvp_id, amount_cents, status, square_payment_id, refund_of_payment_id)
             VALUES ($1, 'event', $2, $3, $4, 'refunded', $5, $6)`,
            [req.member.sub, event_id, rsvp.id, chunk, refundId, p.id]
          );
          remaining -= chunk;
          actuallyRefunded += chunk;
        } catch (err) {
          console.error("Refund failed partway through:", err);
          break; // stop here — never claim to have refunded more than Square confirmed
        }
      }

      if (actuallyRefunded === 0) {
        return res.status(502).json({ error: "Could not process the refund with Square. Please try again or contact the board." });
      }
    }

    // Collapse this option's selection rows into one, reflecting only what was actually refunded.
    // If Square only partially refunded (some chunk failed), scale the quantity removed down
    // proportionally to what actually went through, rather than claiming the full reduction.
    const actualRemovedQuantity = refundCents > 0
      ? Math.round((actuallyRefunded / refundCents) * removedQuantity)
      : 0;
    const keptQuantity = current.quantity - actualRemovedQuantity;
    const keptAmount = current.amount_cents - actuallyRefunded;

    await db.query("DELETE FROM rsvp_selections WHERE rsvp_id = $1 AND pricing_option_id = $2", [rsvp.id, option_id]);
    if (keptQuantity > 0) {
      await db.query(
        "INSERT INTO rsvp_selections (rsvp_id, pricing_option_id, quantity, amount_cents) VALUES ($1, $2, $3, $4)",
        [rsvp.id, option_id, keptQuantity, keptAmount]
      );
    }
    await db.query("UPDATE rsvps SET amount_cents = amount_cents - $1 WHERE id = $2", [actuallyRefunded, rsvp.id]);

    const partial = actuallyRefunded < refundCents;
    res.json({
      refunded_cents: actuallyRefunded,
      quantity: keptQuantity,
      partial,
      message: partial
        ? "Refunded what Square would process; please retry to remove the rest."
        : undefined,
    });
  } catch (err) {
    console.error("Failed to reduce event selection:", err);
    res.status(500).json({ error: "Could not update your selection." });
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

// Loads one payment with everything the completion/confirmation emails
// need (member, event, cultural group, membership category + renewal rule).
// `whereSql` is always an internal constant, never user input.
async function fetchPaymentDetail(whereSql, param) {
  const { rows } = await db.query(
    `SELECT p.id, p.member_id, p.purpose, p.tier, p.rsvp_id, p.cultural_group_id, p.status, p.amount_cents, p.pending_selections,
            m.first_name, m.email,
            e.name AS event_name,
            cg.group_name AS cultural_group_name,
            (SELECT COUNT(*) FROM cultural_group_participants WHERE group_id = p.cultural_group_id)::int AS participant_count,
            mc.label AS tier_label,
            mc.renewal_type, mc.renewal_months, mc.renewal_month, mc.renewal_day
     FROM payments p
     JOIN members m ON m.id = p.member_id
     LEFT JOIN events e ON e.id = p.event_id
     LEFT JOIN cultural_groups cg ON cg.id = p.cultural_group_id
     LEFT JOIN membership_categories mc ON mc.key = p.tier
     WHERE ${whereSql}`,
    [param]
  );
  return rows[0];
}

// Marks a payment completed and applies its effects: registers the RSVP /
// cultural group, applies add-on top-ups, or marks membership dues paid and
// sets the renewal date — then sends the confirmation email. Shared by the
// Square webhook and by an admin manually confirming a payment (used when
// members pay through a static Square link that can't call the webhook).
async function applyCompletedPayment(paymentRow, squarePaymentId) {
  const isAddonTopUp = paymentRow.purpose === "event" && !!paymentRow.pending_selections;

  await db.query(
    "UPDATE payments SET status = 'completed', square_payment_id = $1 WHERE id = $2",
    [squarePaymentId || null, paymentRow.id]
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
    await sendConfirmationEmail({
      to: paymentRow.email,
      subject: `Your add-on purchase for ${paymentRow.event_name} is confirmed`,
      text: `Hi ${paymentRow.first_name || "there"},\n\nWe've received your payment of ${formatMoney(paymentRow.amount_cents)} for additional items for ${paymentRow.event_name}.\n\nRITS`,
      html: `<p>Hi ${paymentRow.first_name || "there"},</p><p>We've received your payment of <strong>${formatMoney(paymentRow.amount_cents)}</strong> for additional items for <strong>${paymentRow.event_name}</strong>.</p><p>RITS</p>`,
    });
  } else if (paymentRow.purpose === "event") {
    if (paymentRow.rsvp_id) {
      await db.query("UPDATE rsvps SET status = 'registered' WHERE id = $1", [paymentRow.rsvp_id]);
    }
    await sendConfirmationEmail({
      to: paymentRow.email,
      subject: `You're registered for ${paymentRow.event_name}`,
      text: `Hi ${paymentRow.first_name || "there"},\n\nYour payment of ${formatMoney(paymentRow.amount_cents)} for ${paymentRow.event_name} has been received — you're registered!\n\nSee you there!\n\nRITS`,
      html: `<p>Hi ${paymentRow.first_name || "there"},</p><p>Your payment of <strong>${formatMoney(paymentRow.amount_cents)}</strong> for <strong>${paymentRow.event_name}</strong> has been received — you're registered!</p><p>See you there!</p><p>RITS</p>`,
    });
  } else if (paymentRow.purpose === "cultural_group") {
    if (paymentRow.cultural_group_id) {
      await db.query("UPDATE cultural_groups SET status = 'registered' WHERE id = $1", [paymentRow.cultural_group_id]);
    }
    const participantText = paymentRow.participant_count === 1 ? "1 participant" : `${paymentRow.participant_count} participants`;
    await sendConfirmationEmail({
      to: paymentRow.email,
      subject: `Cultural group registration confirmed — ${paymentRow.cultural_group_name}`,
      text: `Hi ${paymentRow.first_name || "there"},\n\nYour payment of ${formatMoney(paymentRow.amount_cents)} for "${paymentRow.cultural_group_name}"'s registration for ${paymentRow.event_name} (${participantText}) has been received. You're all set!\n\nRITS`,
      html: `<p>Hi ${paymentRow.first_name || "there"},</p><p>Your payment of <strong>${formatMoney(paymentRow.amount_cents)}</strong> for "${paymentRow.cultural_group_name}"'s registration for <strong>${paymentRow.event_name}</strong> (${participantText}) has been received. You're all set!</p><p>RITS</p>`,
    });
  } else {
    // Falls back to the historical 12-months-from-payment behavior if the
    // tier's category was deleted/renamed since the payment was created.
    const renewalDate = computeRenewalDate(paymentRow, new Date());
    await db.query(
      "UPDATE members SET payment_status = 'paid', renewal_date = $1 WHERE id = $2",
      [renewalDate.toISOString().slice(0, 10), paymentRow.member_id]
    );
    await sendConfirmationEmail({
      to: paymentRow.email,
      subject: "RITS membership payment confirmed",
      text: `Hi ${paymentRow.first_name || "there"},\n\nYour payment of ${formatMoney(paymentRow.amount_cents)} for ${paymentRow.tier_label || "your"} membership dues has been received. Your membership is active through ${renewalDate.toLocaleDateString()}.\n\nThank you!\n\nRITS`,
      html: `<p>Hi ${paymentRow.first_name || "there"},</p><p>Your payment of <strong>${formatMoney(paymentRow.amount_cents)}</strong> for ${paymentRow.tier_label || "your"} membership dues has been received. Your membership is active through ${renewalDate.toLocaleDateString()}.</p><p>Thank you!</p><p>RITS</p>`,
    });
  }
}

async function handlePaymentUpdate(squarePayment) {
  const paymentRow = await fetchPaymentDetail("p.square_order_id = $1", squarePayment.order_id);
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
    await applyCompletedPayment(paymentRow, squarePayment.id);
  } else if (["FAILED", "CANCELED"].includes(squarePayment.status)) {
    await db.query(
      "UPDATE payments SET status = $1, square_payment_id = $2 WHERE id = $3",
      [squarePayment.status === "CANCELED" ? "cancelled" : "failed", squarePayment.id, paymentRow.id]
    );
    if (!isAddonTopUp && paymentRow.purpose === "event" && paymentRow.rsvp_id) {
      await db.query("UPDATE rsvps SET status = 'cancelled' WHERE id = $1", [paymentRow.rsvp_id]);
    }
    if (paymentRow.purpose === "cultural_group" && paymentRow.cultural_group_id) {
      await db.query("UPDATE cultural_groups SET status = 'cancelled' WHERE id = $1", [paymentRow.cultural_group_id]);
    }
  }
}

/* ============================================================
   Admin/board — list all payments for reconciliation.
   ============================================================ */
router.get("/", requireAdmin, async (req, res) => {
  const eventId = req.query.event_id || null;
  if (eventId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return res.status(400).json({ error: "Invalid event_id" });
  }
  const { rows } = await db.query(
    `SELECT p.*, m.first_name, m.last_name, m.email, e.name AS event_name
     FROM payments p
     JOIN members m ON m.id = p.member_id
     LEFT JOIN events e ON e.id = p.event_id
     WHERE ($1::uuid IS NULL OR p.event_id = $1)
     ORDER BY p.created_at DESC LIMIT 200`,
    [eventId]
  );
  res.json({ payments: rows });
});

/* ============================================================
   POST /api/payments/:id/mark-paid — an admin confirms a pending
   payment by hand. Needed when members pay through the board's own
   static Square link (the site can't be told who paid), and also a
   safety net if a webhook was ever missed. Applies exactly what the
   webhook would: registers the RSVP/group, applies add-ons or marks
   dues paid + sets the renewal date, and sends the confirmation email.
   ============================================================ */
router.post("/:id/mark-paid", requireAdmin, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid payment id" });
  }
  const paymentRow = await fetchPaymentDetail("p.id = $1", req.params.id);
  if (!paymentRow) return res.status(404).json({ error: "Payment not found" });
  if (paymentRow.status !== "pending") {
    return res.status(409).json({ error: `This payment is already ${paymentRow.status}, so it can't be marked paid.` });
  }

  // Atomic claim so a double-click (or two admins at once) can't apply the
  // same payment twice — only one request gets to flip pending -> completed.
  const claim = await db.query(
    "UPDATE payments SET status = 'completed' WHERE id = $1 AND status = 'pending' RETURNING id",
    [paymentRow.id]
  );
  if (!claim.rowCount) {
    return res.status(409).json({ error: "This payment was just confirmed by someone else." });
  }

  try {
    await applyCompletedPayment(paymentRow, null);
    res.json({ payment: { id: paymentRow.id, status: "completed" } });
  } catch (err) {
    console.error("Failed to mark payment paid:", err);
    await db.query("UPDATE payments SET status = 'pending' WHERE id = $1", [paymentRow.id]).catch(() => {});
    res.status(500).json({ error: "Could not mark this payment as paid." });
  }
});

module.exports = router;
