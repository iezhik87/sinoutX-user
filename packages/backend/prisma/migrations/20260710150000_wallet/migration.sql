-- Wallet balance in micro-dollars (1e-6 USD), integer: floats drift over
-- thousands of sub-cent debits.
ALTER TABLE "users" ADD COLUMN "balance_micro_usd" INTEGER NOT NULL DEFAULT 0;

-- The credit ledger. Spending is not duplicated here: every debit already has a
-- row in ai_usage with the amount charged.
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_micro_usd" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "payment_id" TEXT,
    "order_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- Unique payment_id: a replayed webhook must not credit the balance twice.
CREATE UNIQUE INDEX "wallet_transactions_payment_id_key" ON "wallet_transactions"("payment_id");
CREATE UNIQUE INDEX "wallet_transactions_order_id_key" ON "wallet_transactions"("order_id");
CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "wallet_transactions"("user_id", "created_at" DESC);
CREATE INDEX "wallet_transactions_status_idx" ON "wallet_transactions"("status");

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
