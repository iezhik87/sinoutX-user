-- Keys we pay for (built-in model, image generation, embeddings), so an operator
-- can rotate them from the admin panel instead of editing .env and redeploying.
-- Values are encrypted at rest; the admin API never returns them.
ALTER TABLE "app_settings" ADD COLUMN "managed" JSONB NOT NULL DEFAULT '{}';
