-- AlterTable: add yjs_state column to pages for real-time collaboration
ALTER TABLE "pages" ADD COLUMN "yjs_state" BYTEA;
