-- The 2026-05 migration seeded plan_limits for a five-tier model that no longer
-- exists. `retire_pro` later stripped only the 'pro' entry, so 'free' and
-- 'business' stayed — and stored overrides WIN over the code defaults.
--
-- The effect was invisible in review: the code and the landing page both say the
-- free tier is one person and 200 MB, while every instance actually granted
-- three people and 1 GB. The paid boundary began at the fourth collaborator
-- instead of the second, and the storage packs we sell were needed five times
-- later than intended.
--
-- 'business' is dropped outright: the tier was removed from the product.
-- 'free' is dropped only when it still carries the seeded values, so an operator
-- who deliberately edited the limits in the admin panel keeps his choice.
UPDATE "app_settings"
   SET "plan_limits" = "plan_limits" - 'business'
 WHERE "plan_limits" ? 'business';

UPDATE "app_settings"
   SET "plan_limits" = "plan_limits" - 'free'
 WHERE "plan_limits" -> 'free' ->> 'members'   = '3'
   AND "plan_limits" -> 'free' ->> 'storageMb' = '1024';
