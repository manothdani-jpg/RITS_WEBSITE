const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAdmin);

// GET /api/audit-log?entity_type=&admin_id=&action=&limit=&before=
// Paginated with a "before" cursor (an entry id) rather than offset, since
// new rows keep arriving between page loads.
router.get("/", async (req, res) => {
  const { entity_type, admin_id, action } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

  const conditions = [];
  const params = [];
  if (entity_type) {
    params.push(entity_type);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (admin_id) {
    params.push(admin_id);
    conditions.push(`admin_id = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (req.query.before) {
    params.push(req.query.before);
    conditions.push(`created_at < (SELECT created_at FROM audit_log WHERE id = $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const { rows } = await db.query(
    `SELECT id, admin_id, admin_name, admin_email, action, entity_type, entity_id, path, changes, created_at
     FROM audit_log ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const entityTypesResult = await db.query(
    "SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type"
  );

  res.json({
    entries: rows,
    has_more: rows.length === limit,
    entity_types: entityTypesResult.rows.map((r) => r.entity_type),
  });
});

module.exports = router;
