-- Everyone pays. An exempt list is a second mechanism that can disagree with the
-- first; an admin who wants to host someone for free just credits the balance.
ALTER TABLE "users" DROP COLUMN IF EXISTS "billing_exempt";
