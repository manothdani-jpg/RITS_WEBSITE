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

module.exports = { computeRenewalDate };
