-- Accounting survives removal of the workspace that generated it.
ALTER TABLE "ai_usage" ALTER COLUMN "workspace_id" DROP NOT NULL;
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_workspace_id_fkey";
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage"("created_at" DESC);
