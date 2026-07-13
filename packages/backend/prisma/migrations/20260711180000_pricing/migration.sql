-- Provider prices change more often than we deploy. The admin edits them here;
-- an empty table falls back to the defaults compiled into lib/pricing.ts.
ALTER TABLE "app_settings" ADD COLUMN "pricing" JSONB NOT NULL DEFAULT '{}';
