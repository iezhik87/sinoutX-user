-- Add is_system flag to projects. System projects (e.g. the Telegram assistant's
-- home project) are excluded from the plan's project quota.
ALTER TABLE "projects" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;
