-- Per-user identity layer: AI settings live on the user; each user gets a
-- canonical Personal workspace (memory + personal modules) shared across all
-- their workspaces.

ALTER TABLE "users" ADD COLUMN "ai_settings" JSONB;
ALTER TABLE "users" ADD COLUMN "personal_workspace_id" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "is_personal" BOOLEAN NOT NULL DEFAULT false;

-- Designate each user's Personal space: prefer the OWNED workspace that already
-- holds their personal data — the one with the Memory module, then the most
-- module projects, then the oldest. So existing memory/personal modules end up
-- IN Personal (no data movement needed).
WITH owned AS (
  SELECT m.user_id, w.id AS workspace_id, w.created_at,
         EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id AND p.is_module = true AND p.module_id = 'memory') AS has_mem,
         (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id AND p.is_module = true) AS mod_count
  FROM workspace_members m
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.role = 'OWNER'
),
ranked AS (
  SELECT user_id, workspace_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY has_mem DESC, mod_count DESC, created_at ASC) AS rn
  FROM owned
)
UPDATE "users" u
SET "personal_workspace_id" = r.workspace_id
FROM ranked r
WHERE r.user_id = u.id AND r.rn = 1;

UPDATE "workspaces" w
SET "is_personal" = true
FROM "users" u
WHERE u."personal_workspace_id" = w.id;

-- Seed per-user AI settings from the owner's BEST-configured workspace: prefer a
-- workspace that actually has an AI provider configured, then the Personal one,
-- then the oldest. So existing models/keys carry over regardless of WHICH
-- workspace they were set in (keys stay encrypted — same scheme).
WITH cand AS (
  SELECT m.user_id, (w.settings -> 'ai') AS ai,
         ROW_NUMBER() OVER (
           PARTITION BY m.user_id
           ORDER BY ((w.settings -> 'ai' -> 'providers') IS NOT NULL) DESC,
                    w.is_personal DESC,
                    w.created_at ASC
         ) AS rn
  FROM workspace_members m
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.role = 'OWNER' AND (w.settings ? 'ai')
)
UPDATE "users" u
SET "ai_settings" = c.ai
FROM cand c
WHERE c.user_id = u.id AND c.rn = 1;
