-- 0001_initial created PageType as ('PAGE', 'TEMPLATE'); the schema later
-- gained FOLDER (added via `prisma db push`, never captured in a migration),
-- so on production (migrate deploy) folder creation failed with:
--   invalid input value for enum "PageType": "FOLDER"
ALTER TYPE "PageType" ADD VALUE IF NOT EXISTS 'FOLDER';
