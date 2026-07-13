-- Change notes.project_id FK from SET NULL to CASCADE
-- Notes should be deleted when their project is deleted

ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_project_id_fkey";

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
