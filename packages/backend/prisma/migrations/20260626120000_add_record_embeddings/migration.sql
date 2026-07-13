-- Semantic index for collection records (Phase 2 memory recall).
CREATE TABLE "record_embeddings" (
  "id"            TEXT NOT NULL,
  "record_id"     TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "workspace_id"  TEXT NOT NULL,
  "model"         TEXT NOT NULL,
  "vector"        JSONB NOT NULL,
  "text_hash"     TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "record_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "record_embeddings_record_id_key" ON "record_embeddings"("record_id");
CREATE INDEX "record_embeddings_workspace_id_idx" ON "record_embeddings"("workspace_id");
CREATE INDEX "record_embeddings_collection_id_idx" ON "record_embeddings"("collection_id");

ALTER TABLE "record_embeddings"
  ADD CONSTRAINT "record_embeddings_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "collection_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
