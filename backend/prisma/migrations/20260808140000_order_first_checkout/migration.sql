-- Order-first checkout.
--
-- Before: the order was created by the browser *after* Stripe confirmed a
-- charge, so a closed tab meant a charged customer with no order, and stock was
-- only reserved at that point. Now checkout writes a PendingPayment order and
-- reserves its stock first, and the payment webhook promotes it.

-- OrderStatus gains PendingPayment and Cancelled. The type is recreated rather
-- than extended with ALTER TYPE ... ADD VALUE, because a value added inside a
-- transaction cannot be used by a later statement in the same transaction —
-- and the new column default needs exactly that.
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";

CREATE TYPE "OrderStatus" AS ENUM (
  'PendingPayment',
  'Processing',
  'Shipped',
  'Delivered',
  'Cancelled'
);

ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order"
  ALTER COLUMN "status" TYPE "OrderStatus" USING "status"::text::"OrderStatus";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PendingPayment';

DROP TYPE "OrderStatus_old";

CREATE TYPE "PaymentStatus" AS ENUM ('Pending', 'Paid', 'Failed', 'Refunded');

ALTER TABLE "Order"
  ADD COLUMN "paymentStatus"     "PaymentStatus" NOT NULL DEFAULT 'Pending',
  ADD COLUMN "razorpayOrderId"   TEXT,
  ADD COLUMN "razorpayPaymentId" TEXT,
  ADD COLUMN "amountCharged"     DECIMAL(10,2),
  ADD COLUMN "placedAt"          TIMESTAMP(3),
  ADD COLUMN "paymentExpiresAt"  TIMESTAMP(3),
  ADD COLUMN "cancelledAt"       TIMESTAMP(3),
  ADD COLUMN "cancelReason"      TEXT,
  ADD COLUMN "couponCode"        TEXT,
  ADD COLUMN "stockReserved"     BOOLEAN NOT NULL DEFAULT false;

-- Every pre-existing order was only ever created after a successful Stripe
-- charge, so all of them are paid; there is no Razorpay id to backfill.
UPDATE "Order"
SET "paymentStatus" = 'Paid',
    "placedAt"      = "createdAt",
    "amountCharged" = "total",
    "stockReserved" = true;

-- Unique, not just indexed: a webhook redelivery or a replayed verify call must
-- not be able to attach the same Razorpay payment to a second order.
CREATE UNIQUE INDEX "Order_razorpayOrderId_key"   ON "Order"("razorpayOrderId");
CREATE UNIQUE INDEX "Order_razorpayPaymentId_key" ON "Order"("razorpayPaymentId");

CREATE INDEX "Order_paymentStatus_idx"    ON "Order"("paymentStatus");
-- drives the expiry sweep, which scans for overdue PendingPayment orders
CREATE INDEX "Order_paymentExpiresAt_idx" ON "Order"("paymentExpiresAt");

-- A capture id may only sit on an order that is actually paid (or was, and has
-- since been refunded). Stated one-directionally on purpose: the orders
-- backfilled above are genuinely Paid but predate Razorpay, so they have no
-- capture id and the converse would reject them.
ALTER TABLE "Order"
  ADD CONSTRAINT "order_payment_id_implies_paid" CHECK (
    "razorpayPaymentId" IS NULL
    OR "paymentStatus" IN ('Paid', 'Refunded')
  );

ALTER TABLE "Order"
  ADD CONSTRAINT "order_amount_charged_non_negative"
  CHECK ("amountCharged" IS NULL OR "amountCharged" >= 0);
