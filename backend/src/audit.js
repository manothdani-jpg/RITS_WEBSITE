const db = require("./db");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACTION_BY_METHOD = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

// Never store credentials/secrets, even though they can arrive in a
// mutating request body (e.g. setting an admin's password or SMTP creds).
const REDACT_KEYS = new Set(["password", "smtp_pass", "smtp_pass_encrypted", "current_password", "new_password"]);

function redact(body) {
  if (!body || typeof body !== "object") return null;
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = REDACT_KEYS.has(key) ? "[redacted]" : value;
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Turns "/api/events/<uuid>/pricing" into { entityType: "events/pricing",
// entityId: "<uuid>" } — a readable label without per-route wiring. Takes
// req.originalUrl (stable for the request's lifetime) rather than req.path,
// which gets rewritten while Express dispatches into nested routers and
// isn't reliably restored by the time a `finish` listener runs.
function describe(originalUrl) {
  const path = originalUrl.split("?")[0];
  const segments = path.split("/").filter(Boolean).slice(1); // drop "api"
  const words = segments.filter((s) => !UUID_RE.test(s));
  const ids = segments.filter((s) => UUID_RE.test(s));
  return { entityType: words.join("/") || "unknown", entityId: ids[ids.length - 1] || null };
}

/**
 * Records every successful admin-authenticated mutation (POST/PUT/PATCH/
 * DELETE) to the audit_log table, generically — no per-route wiring needed.
 * Runs on every request but only writes once req.admin has been set by a
 * downstream requireAdmin/requireRole and the response has actually
 * succeeded, so public/member endpoints and failed requests are never
 * logged. A logging failure is swallowed (never breaks the real request).
 */
function auditMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  res.on("finish", () => {
    if (!req.admin || res.statusCode >= 400) return;
    const { entityType, entityId } = describe(req.originalUrl);
    db.query(
      `INSERT INTO audit_log (admin_id, admin_name, admin_email, action, entity_type, entity_id, path, changes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.admin.sub,
        req.admin.name || null,
        req.admin.email || null,
        ACTION_BY_METHOD[req.method],
        entityType,
        entityId,
        req.originalUrl,
        JSON.stringify(redact(req.body)),
      ]
    ).catch((err) => console.error("[audit] Failed to record log entry:", err));
  });

  next();
}

module.exports = { auditMiddleware };
