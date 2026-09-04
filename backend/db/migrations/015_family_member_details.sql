-- Family members can now carry their own contact/address details
-- (useful for adult children, parents, etc. who don't live at the
-- primary member's address), editable from both the member portal
-- and the admin dashboard.
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS zip TEXT;
