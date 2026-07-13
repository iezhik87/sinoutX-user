-- Add period fields to habits
ALTER TABLE "habits" ADD COLUMN IF NOT EXISTS "period" TEXT NOT NULL DEFAULT 'forever';
ALTER TABLE "habits" ADD COLUMN IF NOT EXISTS "start_date" TEXT;

-- Add goal enhancement fields to objectives
ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMP;
ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "progress_mode" TEXT NOT NULL DEFAULT 'kr';
ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "manual_progress" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Make quarter optional (set default for existing rows)
ALTER TABLE "objectives" ALTER COLUMN "quarter" SET DEFAULT '';
