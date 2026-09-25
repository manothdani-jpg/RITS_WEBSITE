-- Audit log of admin-made changes across the site (members, events,
-- pricing, site content, gallery, sponsors, volunteers, cultural groups,
-- admin logins, etc). Populated generically by middleware, not per-route,
-- so it covers every mutating admin request rather than needing to be
-- wired into each route by hand.
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID REFERENCES admins(id) ON DELETE SET NULL,
  admin_name   TEXT,   -- snapshot at the time of the action, survives the admin login being removed later
  admin_email  TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity_type  TEXT NOT NULL,  -- e.g. "members", "events/pricing", "site-content"
  entity_id    TEXT,           -- the UUID (or other id) in the request path, if any
  path         TEXT NOT NULL,  -- full request path, for the rare case entity_type/id aren't enough context
  changes      JSONB,          -- request body (secrets redacted); null for deletes, which send no body
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id ON audit_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON audit_log (entity_type);
