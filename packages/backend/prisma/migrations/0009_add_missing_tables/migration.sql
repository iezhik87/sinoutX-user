-- =====================================================================
-- Migration: add missing tables and columns (were created via db push)
-- =====================================================================

-- -----------------------------------------------------------------------
-- Alter: attachments — add project_id, page_id, description, is_important
-- -----------------------------------------------------------------------
ALTER TABLE "attachments"
  ADD COLUMN IF NOT EXISTS "project_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "page_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "description"  TEXT,
  ADD COLUMN IF NOT EXISTS "is_important" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "attachments_project_id_idx" ON "attachments"("project_id");
CREATE INDEX IF NOT EXISTS "attachments_page_id_idx"    ON "attachments"("page_id");

ALTER TABLE "attachments"
  DROP CONSTRAINT IF EXISTS "attachments_project_id_fkey",
  DROP CONSTRAINT IF EXISTS "attachments_page_id_fkey";

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "attachments_page_id_fkey"    FOREIGN KEY ("page_id")    REFERENCES "pages"("id")    ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- Alter: budget_entries — add account column
-- -----------------------------------------------------------------------
ALTER TABLE "budget_entries"
  ADD COLUMN IF NOT EXISTS "account" TEXT NOT NULL DEFAULT 'Наличные';

-- -----------------------------------------------------------------------
-- Alter: comments — make task_id nullable, add page_id and parent_id
-- -----------------------------------------------------------------------
ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "page_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "parent_id" TEXT;

-- Drop NOT NULL constraint on task_id if it is currently NOT NULL
-- (safe to run even if already nullable)
ALTER TABLE "comments" ALTER COLUMN "task_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "comments_page_id_idx" ON "comments"("page_id");

ALTER TABLE "comments"
  DROP CONSTRAINT IF EXISTS "comments_page_id_fkey",
  DROP CONSTRAINT IF EXISTS "comments_parent_id_fkey";

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_page_id_fkey"   FOREIGN KEY ("page_id")   REFERENCES "pages"("id")    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: ai_project_templates
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_project_templates" (
  "id"           TEXT        NOT NULL,
  "workspace_id" TEXT        NOT NULL,
  "name"         TEXT        NOT NULL,
  "description"  TEXT        NOT NULL DEFAULT '',
  "icon"         TEXT        NOT NULL DEFAULT 'lucide:FolderKanban',
  "instructions" TEXT        NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_project_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_project_templates_workspace_id_idx" ON "ai_project_templates"("workspace_id");

ALTER TABLE "ai_project_templates"
  DROP CONSTRAINT IF EXISTS "ai_project_templates_workspace_id_fkey";
ALTER TABLE "ai_project_templates"
  ADD CONSTRAINT "ai_project_templates_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: ai_conversations
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_conversations" (
  "id"           TEXT        NOT NULL,
  "workspace_id" TEXT        NOT NULL,
  "project_id"   TEXT,
  "title"        TEXT        NOT NULL DEFAULT 'Новый чат',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_conversations_workspace_id_idx" ON "ai_conversations"("workspace_id");
CREATE INDEX IF NOT EXISTS "ai_conversations_project_id_idx"   ON "ai_conversations"("project_id");

ALTER TABLE "ai_conversations"
  DROP CONSTRAINT IF EXISTS "ai_conversations_workspace_id_fkey",
  DROP CONSTRAINT IF EXISTS "ai_conversations_project_id_fkey";
ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_conversations_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: ai_messages
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_messages" (
  "id"              TEXT        NOT NULL,
  "conversation_id" TEXT        NOT NULL,
  "role"            TEXT        NOT NULL,
  "content"         TEXT        NOT NULL,
  "tool_calls"      JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_messages_conversation_id_idx" ON "ai_messages"("conversation_id");

ALTER TABLE "ai_messages"
  DROP CONSTRAINT IF EXISTS "ai_messages_conversation_id_fkey";
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: custom_fields
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "custom_fields" (
  "id"          TEXT        NOT NULL,
  "project_id"  TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "field_type"  TEXT        NOT NULL,
  "options"     JSONB,
  "position"    INTEGER     NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "custom_fields_project_id_idx" ON "custom_fields"("project_id");

ALTER TABLE "custom_fields"
  DROP CONSTRAINT IF EXISTS "custom_fields_project_id_fkey";
ALTER TABLE "custom_fields"
  ADD CONSTRAINT "custom_fields_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: custom_field_values
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "custom_field_values" (
  "id"              TEXT  NOT NULL,
  "custom_field_id" TEXT  NOT NULL,
  "task_id"         TEXT  NOT NULL,
  "value"           TEXT,

  CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_values_custom_field_id_task_id_key"
  ON "custom_field_values"("custom_field_id", "task_id");
CREATE INDEX IF NOT EXISTS "custom_field_values_task_id_idx" ON "custom_field_values"("task_id");

ALTER TABLE "custom_field_values"
  DROP CONSTRAINT IF EXISTS "custom_field_values_custom_field_id_fkey",
  DROP CONSTRAINT IF EXISTS "custom_field_values_task_id_fkey";
ALTER TABLE "custom_field_values"
  ADD CONSTRAINT "custom_field_values_custom_field_id_fkey"
    FOREIGN KEY ("custom_field_id") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "custom_field_values_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: automation_rules
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id"            TEXT        NOT NULL,
  "project_id"    TEXT        NOT NULL,
  "name"          TEXT        NOT NULL,
  "enabled"       BOOLEAN     NOT NULL DEFAULT true,
  "trigger"       TEXT        NOT NULL,
  "trigger_value" TEXT,
  "action"        TEXT        NOT NULL,
  "action_value"  TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "automation_rules_project_id_idx" ON "automation_rules"("project_id");

ALTER TABLE "automation_rules"
  DROP CONSTRAINT IF EXISTS "automation_rules_project_id_fkey";
ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: objectives
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "objectives" (
  "id"           TEXT        NOT NULL,
  "workspace_id" TEXT        NOT NULL,
  "title"        TEXT        NOT NULL,
  "description"  TEXT,
  "quarter"      TEXT        NOT NULL,
  "status"       TEXT        NOT NULL DEFAULT 'active',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "objectives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "objectives_workspace_id_idx" ON "objectives"("workspace_id");

ALTER TABLE "objectives"
  DROP CONSTRAINT IF EXISTS "objectives_workspace_id_fkey";
ALTER TABLE "objectives"
  ADD CONSTRAINT "objectives_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: key_results
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "key_results" (
  "id"           TEXT        NOT NULL,
  "objective_id" TEXT        NOT NULL,
  "title"        TEXT        NOT NULL,
  "target"       DOUBLE PRECISION NOT NULL DEFAULT 100,
  "current"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit"         TEXT,
  "status"       TEXT        NOT NULL DEFAULT 'active',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "key_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "key_results_objective_id_idx" ON "key_results"("objective_id");

ALTER TABLE "key_results"
  DROP CONSTRAINT IF EXISTS "key_results_objective_id_fkey";
ALTER TABLE "key_results"
  ADD CONSTRAINT "key_results_objective_id_fkey"
    FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: journal_entries
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id"         TEXT        NOT NULL,
  "user_id"    TEXT        NOT NULL,
  "date"       TEXT        NOT NULL,
  "content"    JSONB       NOT NULL DEFAULT '{}',
  "mood"       TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_user_id_date_key" ON "journal_entries"("user_id", "date");
CREATE INDEX IF NOT EXISTS "journal_entries_user_id_idx" ON "journal_entries"("user_id");

ALTER TABLE "journal_entries"
  DROP CONSTRAINT IF EXISTS "journal_entries_user_id_fkey";
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: habits
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "habits" (
  "id"           TEXT        NOT NULL,
  "workspace_id" TEXT        NOT NULL,
  "name"         TEXT        NOT NULL,
  "description"  TEXT,
  "icon"         TEXT,
  "color"        TEXT,
  "archived"     BOOLEAN     NOT NULL DEFAULT false,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "habits_workspace_id_idx" ON "habits"("workspace_id");

ALTER TABLE "habits"
  DROP CONSTRAINT IF EXISTS "habits_workspace_id_fkey";
ALTER TABLE "habits"
  ADD CONSTRAINT "habits_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: habit_entries
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "habit_entries" (
  "id"       TEXT NOT NULL,
  "habit_id" TEXT NOT NULL,
  "date"     TEXT NOT NULL,
  "note"     TEXT,

  CONSTRAINT "habit_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "habit_entries_habit_id_date_key" ON "habit_entries"("habit_id", "date");
CREATE INDEX IF NOT EXISTS "habit_entries_habit_id_idx" ON "habit_entries"("habit_id");

ALTER TABLE "habit_entries"
  DROP CONSTRAINT IF EXISTS "habit_entries_habit_id_fkey";
ALTER TABLE "habit_entries"
  ADD CONSTRAINT "habit_entries_habit_id_fkey"
    FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------
-- New table: time_entries
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "time_entries" (
  "id"           TEXT      NOT NULL,
  "task_id"      TEXT      NOT NULL,
  "started_at"   TIMESTAMP(3) NOT NULL,
  "stopped_at"   TIMESTAMP(3),
  "duration_sec" INTEGER,
  "note"         TEXT,

  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "time_entries_task_id_idx" ON "time_entries"("task_id");

ALTER TABLE "time_entries"
  DROP CONSTRAINT IF EXISTS "time_entries_task_id_fkey";
ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
