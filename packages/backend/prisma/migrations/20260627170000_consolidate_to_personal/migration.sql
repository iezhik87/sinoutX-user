-- Consolidate to the single-workspace model: every user keeps ONE workspace
-- (their Personal). Projects from a user's OTHER owned workspaces are reparented
-- into Personal so nothing is lost; the emptied workspaces are left in place but
-- hidden by the app. Finally, standardize the Personal workspace name.

-- 1. Move projects from each user's other OWNED workspaces into their Personal.
UPDATE "projects" p
SET "workspace_id" = u."personal_workspace_id"
FROM "workspace_members" m
JOIN "users" u ON u.id = m.user_id
WHERE m.workspace_id = p."workspace_id"
  AND m.role = 'OWNER'
  AND u."personal_workspace_id" IS NOT NULL
  AND p."workspace_id" <> u."personal_workspace_id";

-- 2. Standardize the Personal workspace name for everyone.
UPDATE "workspaces" SET "name" = 'Личное' WHERE "is_personal" = true;
