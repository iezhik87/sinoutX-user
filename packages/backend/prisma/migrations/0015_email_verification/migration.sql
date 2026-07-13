ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_verified" BOOLEAN NOT NULL DEFAULT false;

-- Existing users are considered verified (they registered before this feature)
UPDATE "users" SET "is_verified" = true WHERE "is_verified" = false;
