-- Give coupons the conditions a real campaign needs, and index the two
-- filters the dashboard actually runs.
--
-- Until now a Coupon was `code` + `amount` and nothing else: every code ever
-- issued was redeemable forever, by anyone, on a cart of any size, an unlimited
-- number of times. That is four columns of missing schema standing between a
-- one-week promotion and an open-ended liability.
--
-- Every limit is nullable and null means "no limit", so existing rows keep
-- behaving exactly as they do today. The permissive reading is the default;
-- a campaign that needs a ceiling has to state it.

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "minOrderValue" DECIMAL(10,2),
ADD COLUMN     "maxRedemptions" INTEGER,
ADD COLUMN     "perUserLimit" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Invariants belong in the schema, next to the columns they constrain, rather
-- than in whichever controller happens to write them. A limit of zero would
-- make a code that can never be redeemed while still reporting as active,
-- which reads as a bug in the store rather than as a deliberate setting —
-- `isActive = false` is how a code is turned off.
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_max_redemptions_positive"
  CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_per_user_limit_positive"
  CHECK ("perUserLimit" IS NULL OR "perUserLimit" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_min_order_value_non_negative"
  CHECK ("minOrderValue" IS NULL OR "minOrderValue" >= 0);

-- CreateIndex
CREATE INDEX "Coupon_code_isActive_idx" ON "Coupon"("code", "isActive");

-- CreateIndex
--
-- Every query in controllers/stats.ts filters on a status column *and* a
-- createdAt range in the same WHERE — the PLACED (status <> 'PendingPayment')
-- and PAID (paymentStatus = 'Paid') filters that the whole dashboard is built
-- from. The single-column indexes that existed let the planner use one of the
-- two and check the rest by hand; these match the predicates as written.
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_paymentStatus_createdAt_idx" ON "Order"("paymentStatus", "createdAt");

-- CreateIndex
--
-- Coupon redemptions are counted from orders rather than from a counter column
-- on Coupon (see utils/coupons.ts for why), which turns every coupon check
-- into a COUNT over this pair. Without the index that is a sequential scan on
-- the checkout path.
CREATE INDEX "Order_couponCode_paymentStatus_idx" ON "Order"("couponCode", "paymentStatus");
