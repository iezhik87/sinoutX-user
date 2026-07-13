-- Scheduled-backup time-of-day + weekday on the singleton app_settings row.
ALTER TABLE "app_settings" ADD COLUMN "backup_hour" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "app_settings" ADD COLUMN "backup_weekday" INTEGER NOT NULL DEFAULT 1;
