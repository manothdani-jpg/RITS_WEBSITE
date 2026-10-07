// Computes a member's next renewal/expiry date from their membership
// category's renewal rule (see migration 027) and the date payment was
// received. `category` needs renewal_type, renewal_months, renewal_month,
// renewal_day — a row from membership_categories, or an object with those
// same fields missing/undefined, which falls back to the historical
// behavior (12 months from payment).
function computeRenewalDate(category, fromDate) {
  const from = new Date(fromDate);

  if (category && category.renewal_type === "fixed_date") {
    const y = from.getUTCFullYear();
    const fromDateOnly = Date.UTC(y, from.getUTCMonth(), from.getUTCDate());
    const thisYear = Date.UTC(y, category.renewal_month - 1, category.renewal_day);
    // If this year's date has already passed (or is today), the member is
    // covered until next year's occurrence instead of an already-past date.
    return new Date(thisYear > fromDateOnly ? thisYear : Date.UTC(y + 1, category.renewal_month - 1, category.renewal_day));
  }

  const months = (category && category.renewal_months) || 12;
  const result = new Date(from);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

// SQL boolean expression for "is this member currently entitled to member
// pricing/benefits": dues paid AND the membership hasn't passed its end date
// (the renewal date itself is still covered; a paid member with no date on
// file is treated as active). `alias` is the members table alias with its dot,
// e.g. "m.". Single source of truth so every price check agrees.
function activeMemberSql(alias = "") {
  return `(${alias}payment_status = 'paid' AND (${alias}renewal_date IS NULL OR ${alias}renewal_date >= CURRENT_DATE))`;
}

// How many days before a membership ends the member may renew it online.
// Earlier than that the Renew button is disabled and checkout is refused.
const RENEWAL_WINDOW_DAYS = 60;

// SQL boolean: this member is paid up with an end date more than
// RENEWAL_WINDOW_DAYS away, so it's too early to renew. Members who are
// unpaid, expired, inside the window, or have no end date are never locked.
function renewalLockedSql(alias = "") {
  return `(${alias}payment_status = 'paid' AND ${alias}renewal_date IS NOT NULL AND ${alias}renewal_date > CURRENT_DATE + ${RENEWAL_WINDOW_DAYS})`;
}

// SQL: the date renewal opens (end date minus the window), as YYYY-MM-DD.
function renewalOpensOnSql(alias = "") {
  return `to_char(${alias}renewal_date - ${RENEWAL_WINDOW_DAYS}, 'YYYY-MM-DD')`;
}

module.exports = { computeRenewalDate, activeMemberSql, renewalLockedSql, renewalOpensOnSql, RENEWAL_WINDOW_DAYS };
