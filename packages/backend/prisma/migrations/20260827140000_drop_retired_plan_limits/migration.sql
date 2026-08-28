-- `retire_pro` (2026-07) already stripped the 'pro' override once, yet a boevoy
-- instance still carries it: {"pro": {"members": 15, "projects": 20, ...}} — the
-- shape of the original five-tier seed, with fields the model no longer has.
-- Most likely a restore from a pre-retirement backup: `_prisma_migrations` keeps
-- retire_pro marked as applied, so it never ran again.
--
-- Two live consequences. The admin's plan-limits screen renders whatever is
-- stored, so a lone retired tier pushed the real plans off the page entirely.
-- And the storage endpoint resolved limits from the raw `users.plan` column, so
-- an account left on 'pro' drew this row's 10 GB instead of the free 200 MB.
--
-- Dropping the entry by name would only fix today's instance. Keep only the
-- tiers that exist, so a restore from any older backup cannot bring a retired
-- one back.
UPDATE "app_settings"
   SET "plan_limits" = (
         SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
           FROM jsonb_each("plan_limits")
          WHERE key IN ('free', 'team')
       )
 WHERE "plan_limits" IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM jsonb_object_keys("plan_limits") AS k
          WHERE k NOT IN ('free', 'team')
       );

-- Same reasoning for the accounts themselves: retire_pro moved them to free, but
-- a restored row can still say 'pro'. `effectivePlan()` reads anything unknown as
-- free, so this only makes the column agree with the behaviour.
UPDATE "users"
   SET "plan" = 'free'
 WHERE "plan" NOT IN ('free', 'team');
