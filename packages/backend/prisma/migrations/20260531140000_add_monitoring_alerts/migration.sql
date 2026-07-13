-- Monitoring alert thresholds (percent). NULL = disabled.
ALTER TABLE "app_settings" ADD COLUMN "alert_cpu_pct" INTEGER;
ALTER TABLE "app_settings" ADD COLUMN "alert_mem_pct" INTEGER;
ALTER TABLE "app_settings" ADD COLUMN "alert_disk_pct" INTEGER;
