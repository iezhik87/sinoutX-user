-- Cost of the answer, frozen at write time: provider prices change, and a row
-- from March must keep March's price. Micro-dollars (1e-6 USD) as integers —
-- floats drift over thousands of sub-cent answers.
ALTER TABLE "ai_usage" ADD COLUMN "cost_micro_usd" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_usage" ADD COLUMN "charged_micro_usd" INTEGER NOT NULL DEFAULT 0;
