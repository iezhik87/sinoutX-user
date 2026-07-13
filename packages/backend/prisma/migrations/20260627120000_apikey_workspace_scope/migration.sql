-- Per-key workspace scope: empty array = all workspaces (backward compatible).
ALTER TABLE "api_keys" ADD COLUMN "workspace_ids" TEXT[] NOT NULL DEFAULT '{}'::text[];
