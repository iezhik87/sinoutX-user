-- Per-user capability override (admin grants/revokes for the gating system).
ALTER TABLE "users" ADD COLUMN "capabilities" JSONB;
