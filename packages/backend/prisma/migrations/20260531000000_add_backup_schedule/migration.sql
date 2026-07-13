-- Scheduled full-instance backup settings on the singleton app_settings row.
ALTER TABLE "app_settings" ADD COLUMN "backup_schedule" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "app_settings" ADD COLUMN "backup_dir" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "backup_retention" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "app_settings" ADD COLUMN "backup_last_run_at" TIMESTAMP(3);
