const { SquareClient, SquareEnvironment, WebhooksHelper } = require("square");

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.SQUARE_ACCESS_TOKEN) return null;

  client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment:
      process.env.SQUARE_ENVIRONMENT === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
  return client;
}

/**
 * Creates a Square-hosted checkout page for one or more line items
 * (e.g. a membership fee, or an event's participation fee + add-ons).
 * @param {{ referenceId: string, lineItems: Array<{ name: string, quantity?: number, amountCents: number }>, redirectUrl: string }} params
 * @returns {Promise<{ checkoutUrl: string, squareOrderId: string, paymentLinkId: string }>}
 */
async function createPaymentLink({ referenceId, lineItems, redirectUrl }) {
  const c = getClient();
  if (!c) {
    throw new Error(
      "Square isn't configured yet. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in the backend's .env."
    );
  }
  if (!process.env.SQUARE_LOCATION_ID) {
    throw new Error("SQUARE_LOCATION_ID is not set in .env.");
  }
  if (!lineItems || lineItems.length === 0) {
    throw new Error("At least one line item is required to create a checkout.");
  }

  const response = await c.checkout.paymentLinks.create({
    idempotencyKey: referenceId, // one link per payment row; retries are safely idempotent
    order: {
      locationId: process.env.SQUARE_LOCATION_ID,
      referenceId,
      lineItems: lineItems.map((item) => ({
        name: item.name,
        quantity: String(item.quantity || 1),
        basePriceMoney: {
          amount: BigInt(item.amountCents),
          currency: "USD",
        },
      })),
    },
    checkoutOptions: {
      redirectUrl,
    },
  });

  if (!response.paymentLink || !response.paymentLink.url) {
    throw new Error("Square did not return a checkout link");
  }

  return {
    checkoutUrl: response.paymentLink.url,
    squareOrderId: response.paymentLink.orderId,
    paymentLinkId: response.paymentLink.id,
  };
}

/**
 * Refunds part or all of a completed Square payment.
 * @param {{ paymentId: string, amountCents: number, idempotencyKey: string, reason?: string }} params
 * @returns {Promise<{ refundId: string, status: string }>}
 */
async function refundPayment({ paymentId, amountCents, idempotencyKey, reason }) {
  const c = getClient();
  if (!c) {
    throw new Error(
      "Square isn't configured yet. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in the backend's .env."
    );
  }

  const response = await c.refunds.refundPayment({
    idempotencyKey,
    paymentId,
    amountMoney: { amount: BigInt(amountCents), currency: "USD" },
    reason: reason || "Member-requested reduction in event registration",
  });

  if (!response.refund || !response.refund.id) {
    throw new Error("Square did not return a refund confirmation");
  }

  return { refundId: response.refund.id, status: response.refund.status };
}

module.exports = { getClient, createPaymentLink, refundPayment, WebhooksHelper };
