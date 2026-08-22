-- Add WEBHOOK to IntegrationType enum
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'WEBHOOK';
