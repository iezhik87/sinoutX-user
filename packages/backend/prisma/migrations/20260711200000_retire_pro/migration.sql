-- Pro was cut before the product sold, but a few accounts had activated it in
-- testing. Retire those rows: drop them to free and clear the Pro key (SXR-),
-- which no longer maps to any tier. Team licences (SXP-) are left untouched.
UPDATE "users"
   SET "plan" = 'free',
       "license_key" = NULL,
       "license_expires_at" = NULL
 WHERE "plan" = 'pro'
    OR ("license_key" IS NOT NULL AND "license_key" LIKE 'SXR%');

-- A stale per-plan override for 'pro' in app settings would still surface its
-- old storage limit. Strip it if present.
UPDATE "app_settings"
   SET "plan_limits" = "plan_limits" - 'pro'
 WHERE "plan_limits" ? 'pro';
