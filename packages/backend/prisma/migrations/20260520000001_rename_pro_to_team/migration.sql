-- Rename "pro" plan to "team" to align with public pricing tiers.
UPDATE users SET plan = 'team' WHERE plan = 'pro';
UPDATE license_keys SET plan = 'team' WHERE plan = 'pro';
