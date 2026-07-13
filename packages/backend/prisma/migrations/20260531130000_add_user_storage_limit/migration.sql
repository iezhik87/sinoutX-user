-- Per-user storage limit override (MB). NULL = use the plan's storage limit.
ALTER TABLE "users" ADD COLUMN "storage_limit_mb" INTEGER;
