-- The operator's own star rating per model, paired with the live provider price
-- to rank models by value. No provider API reports quality, so it is stored here.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "model_ratings" JSONB NOT NULL DEFAULT '{}';
