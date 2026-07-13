-- After consolidating workspaces, a user could end up with duplicate module
-- projects (e.g. two "Память"/"Финансы"/"Медкарта" — one from each old
-- workspace). Keep ONE per (workspace, module): the data-richest (most records),
-- tie-broken by oldest — i.e. the original with the real data. Delete the rest
-- (cascade removes their empty collections/records).
WITH proj_records AS (
  SELECT p.id AS project_id, p.workspace_id, p.module_id, p.created_at,
         (SELECT count(*) FROM collection_records cr
            JOIN collections c ON c.id = cr.collection_id
          WHERE c.project_id = p.id) AS rec_count
  FROM projects p
  WHERE p.is_module = true AND p.module_id IS NOT NULL
),
ranked AS (
  SELECT project_id,
         ROW_NUMBER() OVER (
           PARTITION BY workspace_id, module_id
           ORDER BY rec_count DESC, created_at ASC
         ) AS rn
  FROM proj_records
)
DELETE FROM projects WHERE id IN (SELECT project_id FROM ranked WHERE rn > 1);
