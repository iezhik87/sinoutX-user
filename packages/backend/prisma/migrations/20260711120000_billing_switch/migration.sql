-- Billing is switched from the admin panel, not from the environment: an
-- operator should not need a redeploy to start (or stop) charging.
-- NULL means "follow DEPLOYMENT_MODE", which keeps existing instances as they are.
ALTER TABLE "app_settings" ADD COLUMN "billing_enabled" BOOLEAN;

-- Individual exemption. The instance owner is exempt by role; this covers
-- everyone else the admin decides to host for free.
ALTER TABLE "users" ADD COLUMN "billing_exempt" BOOLEAN NOT NULL DEFAULT false;
