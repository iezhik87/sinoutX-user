-- Freeze, not delete: an unpaid account keeps its data readable and exportable.
-- Losing a person's notes over $5 buys a refund request and a bad review.
ALTER TABLE "users" ADD COLUMN "frozen_at" TIMESTAMP(3);
CREATE INDEX "users_frozen_at_idx" ON "users"("frozen_at");
