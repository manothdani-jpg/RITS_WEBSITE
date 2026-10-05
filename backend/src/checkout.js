const db = require("./db");
const { createPaymentLink } = require("./square");

async function getSquareSettings() {
  const { rows } = await db.query(
    "SELECT square_mode, membership_payment_link, event_payment_link FROM payment_page_content WHERE id = 1"
  );
  return rows[0] || { square_mode: "api", membership_payment_link: null, event_payment_link: null };
}

/**
 * The one place every payment flow gets its "where does the payer go" URL.
 * kind: "membership" (dues) or "event" (event registrations, add-ons,
 * cultural group registrations, front-desk card payments).
 *
 * api mode   — a real per-payment Square checkout via the API.
 * links mode — the board's own static Square link for that kind. Nothing is
 *              created in Square, so there's no order id to match a webhook
 *              against: manualConfirmation=true tells callers the payment
 *              will sit "pending" until an admin marks it paid.
 */
async function createCheckout({ kind, referenceId, lineItems, redirectUrl }) {
  const settings = await getSquareSettings();

  if (settings.square_mode !== "links") {
    const result = await createPaymentLink({ referenceId, lineItems, redirectUrl });
    return { ...result, manualConfirmation: false };
  }

  const url = kind === "membership" ? settings.membership_payment_link : settings.event_payment_link;
  if (!url) {
    throw new Error(
      `The ${kind === "membership" ? "membership dues" : "event"} payment link hasn't been set up yet. Please contact the board.`
    );
  }
  return { checkoutUrl: url, squareOrderId: null, paymentLinkId: null, manualConfirmation: true };
}

module.exports = { createCheckout, getSquareSettings };
