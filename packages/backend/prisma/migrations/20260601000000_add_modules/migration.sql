-- Pluggable modules: Collections engine + module catalog.

-- Project flags: a project can be the home of an installed module's data.
ALTER TABLE "projects" ADD COLUMN "is_module" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "module_id" TEXT;

-- Catalog of available modules (built-in synced from files + imported manifests).
CREATE TABLE "modules" (
  "id"         TEXT NOT NULL,
  "module_id"  TEXT NOT NULL,
  "version"    TEXT NOT NULL,
  "manifest"   JSONB NOT NULL,
  "source"     TEXT NOT NULL DEFAULT 'builtin',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "modules_module_id_key" ON "modules"("module_id");

-- Реестр: typed dataset inside a module-project.
CREATE TABLE "collections" (
  "id"         TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "module_id"  TEXT,
  "key"        TEXT NOT NULL,
  "name"       JSONB NOT NULL,
  "icon"       TEXT,
  "fields"     JSONB NOT NULL DEFAULT '[]',
  "position"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collections_project_id_key_key" ON "collections"("project_id", "key");
CREATE INDEX "collections_project_id_idx" ON "collections"("project_id");
ALTER TABLE "collections" ADD CONSTRAINT "collections_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Записи реестра.
CREATE TABLE "collection_records" (
  "id"            TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "data"          JSONB NOT NULL DEFAULT '{}',
  "created_by"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collection_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "collection_records_collection_id_idx" ON "collection_records"("collection_id");
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Виды реестра.
CREATE TABLE "collection_views" (
  "id"            TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "key"           TEXT NOT NULL,
  "type"          TEXT NOT NULL,
  "name"          JSONB NOT NULL,
  "config"        JSONB NOT NULL DEFAULT '{}',
  "position"      INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collection_views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collection_views_collection_id_key_key" ON "collection_views"("collection_id", "key");
CREATE INDEX "collection_views_collection_id_idx" ON "collection_views"("collection_id");
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
