-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('Razorpay', 'COD');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('Requested', 'Approved', 'Rejected', 'Received', 'Refunded', 'Cancelled');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'Razorpay',
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingUrl" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantLabel" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "values" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "optionValues" TEXT[],
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'Requested',
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "refundAmount" DECIMAL(10,2),
    "razorpayRefundId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductOption_productId_position_idx" ON "ProductOption"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "ProductOption"("productId", "name");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_position_idx" ON "ProductVariant"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_razorpayRefundId_key" ON "ReturnRequest"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_userId_createdAt_idx" ON "ReturnRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnItem_returnRequestId_idx" ON "ReturnItem"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_returnRequestId_orderItemId_key" ON "ReturnItem"("returnRequestId", "orderItemId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants.
--
-- The same reasoning as the existing add_check_constraints migration: a rule
-- that lives only in a controller is a rule the next controller does not have.
-- ---------------------------------------------------------------------------

-- A variant is a sellable line like any other, so it gets the same guarantees
-- Product.stock/price already have.
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "variant_stock_non_negative" CHECK ("stock" >= 0),
  ADD CONSTRAINT "variant_price_non_negative" CHECK ("price" >= 0);

-- Returning zero (or minus one) of something is not a request, it is a bug
-- that would refund an arbitrary amount.
ALTER TABLE "ReturnItem"
  ADD CONSTRAINT "return_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "return_refund_amount_non_negative"
  CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0);

-- A refund is what closes a return, so Refunded must carry the evidence that
-- money actually moved. Without this, a hand-edited row could report a customer
-- as refunded with nothing to reconcile against.
ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "return_refunded_has_amount"
  CHECK ("status" <> 'Refunded' OR "refundAmount" IS NOT NULL);

-- At most one *open* return per order. Two concurrent "return this order"
-- requests would otherwise each pass a controller-side check and both refund
-- the same items; this is the read-then-write race that address_single_default
-- exists to avoid, in a different table.
CREATE UNIQUE INDEX "return_single_open_per_order"
  ON "ReturnRequest"("orderId")
  WHERE "status" IN ('Requested', 'Approved', 'Received');

-- A COD order has no payment window, so it must never carry an expiry — the
-- sweep in utils/expireOrders.ts cancels anything past one, and a COD order
-- that grew an expiry by accident would be silently cancelled half an hour
-- after it was placed. Enforced here rather than trusted from the checkout
-- controller because "silently cancels good orders" is the worst class of bug
-- to leave to a code path.
ALTER TABLE "Order"
  ADD CONSTRAINT "cod_order_has_no_payment_expiry"
  CHECK ("paymentMethod" <> 'COD' OR "paymentExpiresAt" IS NULL);
