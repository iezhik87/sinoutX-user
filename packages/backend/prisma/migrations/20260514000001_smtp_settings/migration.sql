ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "smtp_host" TEXT;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "smtp_port" INTEGER;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "smtp_user" TEXT;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "smtp_pass" TEXT;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "smtp_from" TEXT;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "app_url" TEXT;
