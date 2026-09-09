-- Front-desk check-in staff: a third login type, separate from board
-- admin and member logins, scoped only to the desk pages. Board/superadmin
-- create and manage these accounts from the admin dashboard.
CREATE TABLE IF NOT EXISTS desk_staff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  username      CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER desk_staff_set_updated_at
  BEFORE UPDATE ON desk_staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payments can now originate from the front desk with a manual payment
-- method, not just Square. `method` defaults to 'square' so every
-- existing row is correctly classified without a backfill.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'square';
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('square', 'cash', 'venmo', 'zelle', 'paypal'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by_desk_staff_id UUID REFERENCES desk_staff(id) ON DELETE SET NULL;

-- Which desk-staff login checked an RSVP in (attendance), if any.
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS checked_in_by_desk_staff_id UUID REFERENCES desk_staff(id) ON DELETE SET NULL;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
