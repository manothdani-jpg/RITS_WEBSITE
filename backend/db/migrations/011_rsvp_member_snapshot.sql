-- Snapshot whether each registrant was a paid-up member at the moment they
-- registered, alongside the existing live lookup (members.payment_status),
-- so the two can be compared later even if someone's dues status changes
-- after they register.
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS member_at_registration BOOLEAN;

UPDATE rsvps r
SET member_at_registration = (m.payment_status = 'paid')
FROM members m
WHERE m.id = r.member_id AND r.member_at_registration IS NULL;
