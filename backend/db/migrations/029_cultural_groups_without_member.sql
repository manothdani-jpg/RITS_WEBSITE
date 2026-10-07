-- Cultural group registrations no longer create a member record for the
-- choreographer/trainer (they only need to be checked for member vs
-- non-member pricing). The group already stores their name/email/phone, so
-- the member link becomes optional on both the group and its payment.
--
-- The choreographer link also stops cascading: deleting a member should never
-- silently delete the cultural groups they registered.

ALTER TABLE cultural_groups ALTER COLUMN choreographer_member_id DROP NOT NULL;
ALTER TABLE cultural_groups DROP CONSTRAINT IF EXISTS cultural_groups_choreographer_member_id_fkey;
ALTER TABLE cultural_groups
  ADD CONSTRAINT cultural_groups_choreographer_member_id_fkey
  FOREIGN KEY (choreographer_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE payments ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE payments
  ADD CONSTRAINT payments_member_required_check
  CHECK (member_id IS NOT NULL OR purpose = 'cultural_group');
