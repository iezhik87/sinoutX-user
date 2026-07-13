-- Create canvases table
CREATE TABLE IF NOT EXISTS "canvases" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "workspace_id" TEXT NOT NULL,
  "name"         TEXT NOT NULL DEFAULT 'Моя доска',
  "nodes"        JSONB NOT NULL DEFAULT '[]',
  "edges"        JSONB NOT NULL DEFAULT '[]',
  "viewport"     JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  "created_at"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "canvases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "canvases_workspace_id_idx" ON "canvases"("workspace_id");
