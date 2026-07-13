-- User plan fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "license_key" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "license_expires_at" TIMESTAMPTZ;

-- AppSettings plan limits
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "plan_limits" JSONB NOT NULL DEFAULT '{}';

-- Seed default plan limits
UPDATE "app_settings" SET "plan_limits" = '{
  "free":     {"workspaces": 1, "projects": 3, "storageMb": 1024,   "members": 3,  "aiRequests": 50},
  "pro":      {"workspaces": 5, "projects": 20, "storageMb": 10240,  "members": 15, "aiRequests": 500},
  "business": {"workspaces": -1,"projects": -1, "storageMb": 102400, "members": -1, "aiRequests": -1}
}'::jsonb WHERE id = 'singleton';

-- License keys table
CREATE TABLE IF NOT EXISTS "license_keys" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "key"          TEXT NOT NULL UNIQUE,
  "plan"         TEXT NOT NULL,
  "email"        TEXT,
  "note"         TEXT,
  "expires_at"   TIMESTAMPTZ,
  "activated_at" TIMESTAMPTZ,
  "activated_by" TEXT,
  "is_active"    BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
