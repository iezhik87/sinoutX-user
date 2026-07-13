CREATE TABLE "notifications" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT,
  "workspace_id" TEXT,
  "type"         TEXT NOT NULL DEFAULT 'info',
  "title"        TEXT NOT NULL,
  "body"         TEXT,
  "link"         TEXT,
  "is_read"      BOOLEAN NOT NULL DEFAULT false,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");
CREATE INDEX "notifications_workspace_id_created_at_idx" ON "notifications"("workspace_id", "created_at");
