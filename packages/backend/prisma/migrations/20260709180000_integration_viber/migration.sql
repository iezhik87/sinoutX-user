-- Viber as a second messenger channel. Postgres cannot ALTER TYPE ... ADD VALUE
-- inside a transaction that later uses the value, so it stands alone here.
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'VIBER';
