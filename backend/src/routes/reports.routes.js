const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(requireAdmin);

// GET /api/reports/summary — aggregate counts for the Reports dashboard.
router.get("/summary", async (req, res) => {
  const totals = await db.query("SELECT COUNT(*)::int AS n FROM members");
  const byTier = await db.query(
    "SELECT membership_tier AS key, COUNT(*)::int AS n FROM members GROUP BY membership_tier ORDER BY membership_tier"
  );
  const byStatus = await db.query(
    "SELECT payment_status AS key, COUNT(*)::int AS n FROM members GROUP BY payment_status ORDER BY payment_status"
  );
  const family = await db.query("SELECT COUNT(*)::int AS n FROM family_members");
  const events = await db.query("SELECT COUNT(*)::int AS n FROM events WHERE event_date >= now()");
  const rsvps = await db.query("SELECT COUNT(*)::int AS n FROM rsvps WHERE status = 'registered'");

  res.json({
    total_members: totals.rows[0].n,
    by_tier: byTier.rows,
    by_payment_status: byStatus.rows,
    total_family_members: family.rows[0].n,
    upcoming_events: events.rows[0].n,
    active_rsvps: rsvps.rows[0].n,
  });
});

// GET /api/reports/members.csv — full membership export.
router.get("/members.csv", async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.first_name, m.last_name, m.email, m.phone, m.address_line1, m.city, m.state, m.zip,
            m.membership_tier, m.payment_status, m.join_date, m.renewal_date,
            (SELECT COUNT(*) FROM family_members f WHERE f.member_id = m.id)::int AS family_member_count
     FROM members m
     ORDER BY m.last_name, m.first_name`
  );

  const headers = [
    "First Name", "Last Name", "Email", "Phone", "Address", "City", "State", "ZIP",
    "Membership Tier", "Payment Status", "Join Date", "Renewal Date", "Family Members",
  ];

  const csvEscape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [headers.join(",")];
  for (const m of rows) {
    lines.push(
      [
        m.first_name, m.last_name, m.email, m.phone, m.address_line1, m.city, m.state, m.zip,
        m.membership_tier, m.payment_status,
        m.join_date ? new Date(m.join_date).toISOString().slice(0, 10) : "",
        m.renewal_date ? new Date(m.renewal_date).toISOString().slice(0, 10) : "",
        m.family_member_count,
      ].map(csvEscape).join(",")
    );
  }

  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="rits-members-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// GET /api/reports/rsvp-breakdown — per-event RSVP counts + revenue,
// broken down by pricing option. "Confirmed" means status is registered
// or attended (payment settled, or free); pending_payment and cancelled
// are counted separately and excluded from revenue.
router.get("/rsvp-breakdown", async (req, res) => {
  const eventsResult = await db.query(
    `SELECT e.id AS event_id, e.name AS event_name, e.event_date,
            COUNT(*) FILTER (WHERE r.status IN ('registered', 'attended'))::int AS confirmed_count,
            COUNT(*) FILTER (WHERE r.status = 'pending_payment')::int AS pending_count,
            COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled_count,
            COALESCE(SUM(r.amount_cents) FILTER (WHERE r.status IN ('registered', 'attended')), 0)::int AS confirmed_revenue_cents,
            COALESCE(SUM(r.amount_cents) FILTER (WHERE r.status = 'pending_payment'), 0)::int AS pending_revenue_cents
     FROM events e
     LEFT JOIN rsvps r ON r.event_id = e.id
     GROUP BY e.id, e.name, e.event_date
     ORDER BY e.event_date DESC`
  );

  // Includes pending_payment selections too (excludes only cancelled) —
  // boards need headcount/quantity picks (e.g. food counts) for planning
  // before Square confirms payment, not just after. confirmed_revenue_cents
  // is the only figure restricted to settled money.
  const optionsResult = await db.query(
    `SELECT r.event_id, o.id AS option_id, o.kind, o.label,
            SUM(s.quantity)::int AS quantity,
            COALESCE(SUM(s.amount_cents) FILTER (WHERE r.status IN ('registered', 'attended')), 0)::int AS confirmed_revenue_cents,
            COALESCE(SUM(s.amount_cents) FILTER (WHERE r.status = 'pending_payment'), 0)::int AS pending_revenue_cents,
            COUNT(DISTINCT s.rsvp_id)::int AS registrant_count
     FROM rsvp_selections s
     JOIN rsvps r ON r.id = s.rsvp_id
     JOIN event_pricing_options o ON o.id = s.pricing_option_id
     WHERE r.status IN ('registered', 'attended', 'pending_payment')
     GROUP BY r.event_id, o.id, o.kind, o.label, o.display_order
     ORDER BY o.kind, o.display_order`
  );

  const optionsByEvent = new Map();
  for (const row of optionsResult.rows) {
    if (!optionsByEvent.has(row.event_id)) optionsByEvent.set(row.event_id, []);
    optionsByEvent.get(row.event_id).push(row);
  }

  // Per-registrant detail (excludes cancelled) — same shape as
  // GET /api/events/:id/rsvps, but for every event at once.
  const registrantsResult = await db.query(
    `SELECT r.id AS rsvp_id, r.event_id, r.amount_cents, r.status, r.member_at_registration,
            m.first_name, m.last_name, m.email,
            (m.payment_status = 'paid') AS is_member
     FROM rsvps r JOIN members m ON m.id = r.member_id
     WHERE r.status != 'cancelled'
     ORDER BY r.event_id, r.created_at`
  );

  const selectionsResult = await db.query(
    `SELECT s.rsvp_id, s.quantity, o.kind, o.label
     FROM rsvp_selections s JOIN event_pricing_options o ON o.id = s.pricing_option_id
     ORDER BY o.kind, o.display_order`
  );
  const selectionsByRsvp = new Map();
  for (const s of selectionsResult.rows) {
    if (!selectionsByRsvp.has(s.rsvp_id)) selectionsByRsvp.set(s.rsvp_id, []);
    selectionsByRsvp.get(s.rsvp_id).push({ kind: s.kind, label: s.label, quantity: s.quantity });
  }

  const registrantsByEvent = new Map();
  for (const r of registrantsResult.rows) {
    if (!registrantsByEvent.has(r.event_id)) registrantsByEvent.set(r.event_id, []);
    registrantsByEvent.get(r.event_id).push({ ...r, selections: selectionsByRsvp.get(r.rsvp_id) || [] });
  }

  const events = eventsResult.rows.map((ev) => ({
    ...ev,
    options: optionsByEvent.get(ev.event_id) || [],
    registrants: registrantsByEvent.get(ev.event_id) || [],
  }));

  res.json({ events });
});

// GET /api/reports/front-desk?event_id= — everything recorded by front-desk
// staff: payments they took (any method) and check-ins they performed.
// event_id is optional; omit it to see activity across all events.
router.get("/front-desk", async (req, res) => {
  const eventId = req.query.event_id || null;

  const payments = await db.query(
    `SELECT p.id, p.amount_cents, p.method, p.status, p.created_at,
            m.first_name, m.last_name, m.email,
            e.name AS event_name, e.id AS event_id,
            ds.name AS staff_name
     FROM payments p
     JOIN members m ON m.id = p.member_id
     LEFT JOIN events e ON e.id = p.event_id
     LEFT JOIN desk_staff ds ON ds.id = p.recorded_by_desk_staff_id
     WHERE p.recorded_by_desk_staff_id IS NOT NULL
       AND ($1::uuid IS NULL OR p.event_id = $1)
     ORDER BY p.created_at DESC
     LIMIT 500`,
    [eventId]
  );

  const checkins = await db.query(
    `SELECT r.id AS rsvp_id, r.checked_in_at,
            m.first_name, m.last_name, m.email,
            e.name AS event_name, e.id AS event_id,
            ds.name AS staff_name
     FROM rsvps r
     JOIN members m ON m.id = r.member_id
     JOIN events e ON e.id = r.event_id
     LEFT JOIN desk_staff ds ON ds.id = r.checked_in_by_desk_staff_id
     WHERE r.checked_in_by_desk_staff_id IS NOT NULL
       AND ($1::uuid IS NULL OR r.event_id = $1)
     ORDER BY r.checked_in_at DESC
     LIMIT 500`,
    [eventId]
  );

  res.json({ payments: payments.rows, checkins: checkins.rows });
});

module.exports = router;
