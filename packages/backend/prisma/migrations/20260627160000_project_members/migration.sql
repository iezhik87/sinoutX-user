-- Project-level sharing (single-workspace model): grant a user access to a single
-- project without joining the owner's workspace.
CREATE TYPE "ProjectMemberRole" AS ENUM ('VIEWER', 'EDITOR');

CREATE TABLE "project_members" (
  "id"         TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "role"       "ProjectMemberRole" NOT NULL DEFAULT 'EDITOR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");
CREATE INDEX "project_members_project_id_idx" ON "project_members"("project_id");

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
