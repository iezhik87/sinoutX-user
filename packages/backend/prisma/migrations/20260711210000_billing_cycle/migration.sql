-- Per-user editable spend cap (null = instance default).
ALTER TABLE "users" ADD COLUMN "monthly_cap_micro_usd" INTEGER;
-- Subscription anchored to the user's own top-up date, not the calendar 1st.
ALTER TABLE "users" ADD COLUMN "next_charge_at" TIMESTAMP(3);
