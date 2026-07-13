-- Storage is sold in 200 MB packs, not whole gigabytes: at $3/GB a single byte
-- over the free allowance would have cost $3. Same rate, gentler steps.
ALTER TABLE "users" ADD COLUMN "storage_packs" INTEGER NOT NULL DEFAULT 0;
