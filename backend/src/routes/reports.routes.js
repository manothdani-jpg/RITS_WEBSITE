const express = require("express");
const db = require("../db");
const { activeMemberSql } = require("../membership");
const { requireAdmin } = require("../middleware/auth");
const { ExcelJS, addSheet, sendWorkbook } = require("../xlsx");
const { formatMoney } = require("../email");

const router = express.Router();

router.use(requireAdmin);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads the optional ?event_id= filter (omitted = all events). Sends a 400
// and returns null for a malformed id, so callers just `if (!parsed) return;`.
function readEventId(req, res) {
  const raw = req.query.event_id;
  if (!raw) return { eventId: null };
  if (!UUID_RE.test(raw)) {
    res.status(400).json({ error: "Invalid event_id" });
    return null;
  }
  return { eventId: raw };
}

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

// Per-event RSVP counts + revenue, broken down by pricing option, plus
// per-registrant detail. "Confirmed" means status is registered or attended
// (payment settled, or free); pending_payment and cancelled are counted
// separately and excluded from revenue. eventId null = every event.
async function getRsvpBreakdown(eventId) {
  const eventsResult = await db.query(
    `SELECT e.id AS event_id, e.name AS event_name, e.event_date,
            COUNT(*) FILTER (WHERE r.status IN ('registered', 'attended'))::int AS confirmed_count,
            COUNT(*) FILTER (WHERE r.status = 'pending_payment')::int AS pending_count,
            COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled_count,
            COALESCE(SUM(r.amount_cents) FILTER (WHERE r.status IN ('registered', 'attended')), 0)::int AS confirmed_revenue_cents,
            COALESCE(SUM(r.amount_cents) FILTER (WHERE r.status = 'pending_payment'), 0)::int AS pending_revenue_cents
     FROM events e
     LEFT JOIN rsvps r ON r.event_id = e.id
     WHERE ($1::uuid IS NULL OR e.id = $1)
     GROUP BY e.id, e.name, e.event_date
     ORDER BY e.event_date DESC`,
    [eventId]
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
       AND ($1::uuid IS NULL OR r.event_id = $1)
     GROUP BY r.event_id, o.id, o.kind, o.label, o.display_order
     ORDER BY o.kind, o.display_order`,
    [eventId]
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
            ${activeMemberSql("m.")} AS is_member
     FROM rsvps r JOIN members m ON m.id = r.member_id
     WHERE r.status != 'cancelled' AND ($1::uuid IS NULL OR r.event_id = $1)
     ORDER BY r.event_id, r.created_at`,
    [eventId]
  );

  const selectionsResult = await db.query(
    `SELECT s.rsvp_id, s.quantity, o.kind, o.label
     FROM rsvp_selections s
     JOIN rsvps r ON r.id = s.rsvp_id
     JOIN event_pricing_options o ON o.id = s.pricing_option_id
     WHERE ($1::uuid IS NULL OR r.event_id = $1)
     ORDER BY o.kind, o.display_order`,
    [eventId]
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

  return eventsResult.rows.map((ev) => ({
    ...ev,
    options: optionsByEvent.get(ev.event_id) || [],
    registrants: registrantsByEvent.get(ev.event_id) || [],
  }));
}

// GET /api/reports/rsvp-breakdown?event_id= — event_id is optional.
router.get("/rsvp-breakdown", async (req, res) => {
  const parsed = readEventId(req, res);
  if (!parsed) return;
  res.json({ events: await getRsvpBreakdown(parsed.eventId) });
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

// GET /api/reports/cultural?event_id= — cultural group registration
// summary: group/participant counts and fee collected/pending, overall
// and broken down by performance type. event_id is optional.
router.get("/cultural", async (req, res) => {
  const parsed = readEventId(req, res);
  if (!parsed) return;
  const eventId = parsed.eventId;

  // Participant counts are pre-aggregated to one row per group before
  // joining, so summing cg.amount_cents afterward doesn't fan out across
  // each group's participant rows (which would multiply-count the fee).
  const totals = await db.query(
    `SELECT
       COUNT(*)::int AS group_count,
       COALESCE(SUM(pc.participant_count), 0)::int AS participant_count,
       COALESCE(SUM(cg.amount_cents) FILTER (WHERE cg.status = 'registered'), 0)::int AS collected_cents,
       COALESCE(SUM(cg.amount_cents) FILTER (WHERE cg.status = 'pending_payment'), 0)::int AS pending_cents,
       COUNT(*) FILTER (WHERE cg.status = 'registered')::int AS registered_group_count,
       COUNT(*) FILTER (WHERE cg.status = 'pending_payment')::int AS pending_group_count
     FROM cultural_groups cg
     LEFT JOIN (
       SELECT group_id, COUNT(*)::int AS participant_count
       FROM cultural_group_participants
       GROUP BY group_id
     ) pc ON pc.group_id = cg.id
     WHERE cg.status != 'cancelled' AND ($1::uuid IS NULL OR cg.event_id = $1)`,
    [eventId]
  );

  const byType = await db.query(
    `SELECT cg.performance_type, COUNT(DISTINCT cg.id)::int AS group_count, COUNT(p.id)::int AS participant_count
     FROM cultural_groups cg
     LEFT JOIN cultural_group_participants p ON p.group_id = cg.id
     WHERE cg.status != 'cancelled' AND ($1::uuid IS NULL OR cg.event_id = $1)
     GROUP BY cg.performance_type
     ORDER BY cg.performance_type`,
    [eventId]
  );

  res.json({ totals: totals.rows[0], by_performance_type: byType.rows });
});

// Cultural groups with their participants nested, for the Reports page and
// the Excel exports. excludeCancelled matches the summary stats above (which
// leave cancelled groups out); the Cultural Events tab export includes them,
// mirroring that tab's table, so the Status column lets you filter.
async function getCulturalGroupsDetailed(eventId, { excludeCancelled }) {
  const groupsResult = await db.query(
    `SELECT cg.id, cg.event_id, e.name AS event_name, e.event_date,
            cg.group_name, cg.performance_type, cg.description,
            cg.choreographer_name, cg.choreographer_email, cg.choreographer_phone,
            cg.amount_cents, cg.status, cg.created_at
     FROM cultural_groups cg JOIN events e ON e.id = cg.event_id
     WHERE ($1::uuid IS NULL OR cg.event_id = $1)
       AND ($2::boolean = false OR cg.status != 'cancelled')
     ORDER BY e.event_date DESC, cg.created_at`,
    [eventId, excludeCancelled]
  );
  const groups = groupsResult.rows;

  const participantsByGroup = new Map();
  if (groups.length) {
    const participantsResult = await db.query(
      `SELECT group_id, full_name, email, age_category, is_member, fee_cents
       FROM cultural_group_participants
       WHERE group_id = ANY($1::uuid[])
       ORDER BY created_at`,
      [groups.map((g) => g.id)]
    );
    for (const p of participantsResult.rows) {
      if (!participantsByGroup.has(p.group_id)) participantsByGroup.set(p.group_id, []);
      participantsByGroup.get(p.group_id).push(p);
    }
  }

  return groups.map((g) => ({ ...g, participants: participantsByGroup.get(g.id) || [] }));
}

// GET /api/reports/cultural-groups?event_id= — groups + participants for
// the Reports page.
router.get("/cultural-groups", async (req, res) => {
  const parsed = readEventId(req, res);
  if (!parsed) return;
  res.json({ groups: await getCulturalGroupsDetailed(parsed.eventId, { excludeCancelled: true }) });
});

const PERFORMANCE_TYPE_LABELS = { dance: "Dance", singing: "Singing", drama: "Drama", speech: "Speech", other: "Other" };
const STATUS_LABELS = { registered: "Registered", pending_payment: "Pending payment", cancelled: "Cancelled" };

function addCulturalSheets(workbook, groups) {
  addSheet(
    workbook,
    "Cultural Groups",
    [
      { header: "Group", key: "group_name", width: 28 },
      { header: "Event", key: "event_name", width: 26 },
      { header: "Event Date", key: "event_date", width: 18, type: "date" },
      { header: "Type", key: "type", width: 12 },
      { header: "Choreographer / Trainer", key: "choreographer_name", width: 26 },
      { header: "Email", key: "choreographer_email", width: 30 },
      { header: "Phone", key: "choreographer_phone", width: 16 },
      { header: "Participant Count", key: "participant_count", width: 16 },
      { header: "Members", key: "member_count", width: 10 },
      { header: "Kids", key: "kid_count", width: 8 },
      { header: "Fee", key: "amount_cents", width: 12, type: "money" },
      { header: "Status", key: "status", width: 17 },
      { header: "Participant Details", key: "participant_details", width: 60 },
      { header: "Description", key: "description", width: 40 },
      { header: "Registered On", key: "created_at", width: 18, type: "datetime" },
    ],
    groups.map((g) => ({
      ...g,
      type: PERFORMANCE_TYPE_LABELS[g.performance_type] || g.performance_type,
      participant_count: g.participants.length,
      member_count: g.participants.filter((p) => p.is_member).length,
      kid_count: g.participants.filter((p) => p.age_category === "kid").length,
      status: STATUS_LABELS[g.status] || g.status,
      // Full participant detail is also its own "Cultural Participants" sheet,
      // but a summary here too means it's visible without switching tabs.
      participant_details: g.participants
        .map((p) => `${p.full_name} (${p.is_member ? "member" : "non-member"}, ${p.age_category === "kid" ? "kid" : "adult"}) — ${formatMoney(p.fee_cents)}`)
        .join("; "),
    }))
  );

  addSheet(
    workbook,
    "Cultural Participants",
    [
      { header: "Group", key: "group_name", width: 28 },
      { header: "Event", key: "event_name", width: 26 },
      { header: "Participant", key: "full_name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Adult / Kid", key: "age", width: 12 },
      { header: "RITS Member", key: "member", width: 13 },
      { header: "Fee", key: "fee_cents", width: 12, type: "money" },
      { header: "Group Status", key: "status", width: 17 },
    ],
    groups.flatMap((g) =>
      g.participants.map((p) => ({
        group_name: g.group_name,
        event_name: g.event_name,
        full_name: p.full_name,
        email: p.email,
        age: p.age_category === "kid" ? "Kid" : "Adult",
        member: p.is_member ? "Yes" : "No",
        fee_cents: p.fee_cents,
        status: STATUS_LABELS[g.status] || g.status,
      }))
    )
  );
}

const today = () => new Date().toISOString().slice(0, 10);

// GET /api/reports/cultural.xlsx?event_id= — the Cultural Events tab's
// current selection as an Excel file (groups + participants sheets).
router.get("/cultural.xlsx", async (req, res) => {
  const parsed = readEventId(req, res);
  if (!parsed) return;
  try {
    const groups = await getCulturalGroupsDetailed(parsed.eventId, { excludeCancelled: false });
    const workbook = new ExcelJS.Workbook();
    addCulturalSheets(workbook, groups);
    await sendWorkbook(res, workbook, `rits-cultural-events-${today()}.xlsx`);
  } catch (err) {
    console.error("Cultural export failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Could not generate the export" });
  }
});

// GET /api/reports/event-report.xlsx?event_id= — everything on the Reports
// page's event sections for the current selection: registrations by event,
// by pricing option, by registrant, payments, and cultural groups.
router.get("/event-report.xlsx", async (req, res) => {
  const parsed = readEventId(req, res);
  if (!parsed) return;
  const eventId = parsed.eventId;

  try {
    const events = await getRsvpBreakdown(eventId);
    const workbook = new ExcelJS.Workbook();

    // Sheet order mirrors the Reports page's own top-to-bottom section
    // order (Recent Payments, then Event RSVP Breakdown, then Cultural
    // Registrations), and sheet names mirror those section headers, so
    // it's obvious which tab holds which part of what's on screen.
    const payments = await db.query(
      `SELECT p.created_at, m.first_name, m.last_name, m.email, p.purpose, mc.label AS tier_label,
              e.name AS event_name, p.amount_cents, p.method, p.status
       FROM payments p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN events e ON e.id = p.event_id
       LEFT JOIN membership_categories mc ON mc.key = p.tier
       WHERE ($1::uuid IS NULL OR p.event_id = $1)
       ORDER BY p.created_at DESC`,
      [eventId]
    );
    const PURPOSE_LABELS = { event: "Event", cultural_group: "Cultural group", membership: "Membership dues" };
    addSheet(
      workbook,
      "Recent Payments",
      [
        { header: "Date", key: "created_at", width: 18, type: "datetime" },
        { header: "Member", key: "member", width: 26 },
        { header: "Email", key: "email", width: 30 },
        { header: "For", key: "for", width: 18 },
        { header: "Event / Tier", key: "detail", width: 28 },
        { header: "Amount", key: "amount_cents", width: 12, type: "money" },
        { header: "Method", key: "method", width: 10 },
        { header: "Status", key: "status", width: 12 },
      ],
      payments.rows.map((p) => ({
        ...p,
        member: `${p.first_name} ${p.last_name}`,
        for: PURPOSE_LABELS[p.purpose] || p.purpose,
        detail: p.purpose === "membership" ? p.tier_label : p.event_name,
      }))
    );

    addSheet(
      workbook,
      "Event RSVP Summary",
      [
        { header: "Event", key: "event_name", width: 28 },
        { header: "Date", key: "event_date", width: 18, type: "date" },
        { header: "Confirmed", key: "confirmed_count", width: 12 },
        { header: "Pending Payment", key: "pending_count", width: 17 },
        { header: "Cancelled", key: "cancelled_count", width: 12 },
        { header: "Collected", key: "confirmed_revenue_cents", width: 14, type: "money" },
        { header: "Pending", key: "pending_revenue_cents", width: 14, type: "money" },
      ],
      events
    );

    addSheet(
      workbook,
      "Event RSVP by Option",
      [
        { header: "Event", key: "event_name", width: 28 },
        { header: "Option", key: "label", width: 28 },
        { header: "Type", key: "type", width: 14 },
        { header: "Quantity", key: "quantity", width: 10 },
        { header: "Registrants", key: "registrant_count", width: 13 },
        { header: "Collected", key: "confirmed_revenue_cents", width: 14, type: "money" },
        { header: "Pending", key: "pending_revenue_cents", width: 14, type: "money" },
      ],
      events.flatMap((ev) =>
        ev.options.map((o) => ({ ...o, event_name: ev.event_name, type: o.kind === "participation" ? "Participation" : "Add-on" }))
      )
    );

    addSheet(
      workbook,
      "Event RSVP Registrants",
      [
        { header: "Event", key: "event_name", width: 28 },
        { header: "First Name", key: "first_name", width: 16 },
        { header: "Last Name", key: "last_name", width: 16 },
        { header: "Email", key: "email", width: 30 },
        { header: "Member (Now)", key: "member_now", width: 14 },
        { header: "Member (At Signup)", key: "member_then", width: 18 },
        { header: "Selections", key: "selections", width: 44 },
        { header: "Amount", key: "amount_cents", width: 12, type: "money" },
        { header: "Status", key: "status", width: 17 },
      ],
      events.flatMap((ev) =>
        ev.registrants.map((r) => ({
          ...r,
          event_name: ev.event_name,
          member_now: r.is_member ? "Yes" : "No",
          member_then: r.member_at_registration === null ? "" : r.member_at_registration ? "Yes" : "No",
          selections: r.selections.map((s) => s.label + (s.quantity > 1 ? ` ×${s.quantity}` : "")).join("; "),
          status: r.status.replace("_", " "),
        }))
      )
    );

    addCulturalSheets(workbook, await getCulturalGroupsDetailed(eventId, { excludeCancelled: true }));

    await sendWorkbook(res, workbook, `rits-event-report-${today()}.xlsx`);
  } catch (err) {
    console.error("Event report export failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Could not generate the export" });
  }
});

module.exports = router;
