-- Back-in-stock requests, review requests and abandoned-checkout recovery.
--
-- These three are the store's first *non-transactional* mail: nobody entered
-- into a transaction that obliges us to send them, unlike a receipt or a
-- shipping notice. That distinction is why `emailOptOut` lands on User in the
-- same migration — an unsubscribe mechanism has to exist before the first such
-- message goes out, not after, and it is deliberately scoped so that opting out
-- can never suppress a receipt.
--
-- Everything else here is idempotency. All three run from a sweep that fires
-- every few minutes, so each needs a durable "already said this" marker; the
-- columns below are those markers.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
--
-- deliveredAt is a real gap rather than a convenience: `status` records that an
-- order arrived but not when, and "ask for a review three days after delivery"
-- cannot be expressed without it. Existing delivered rows keep NULL, which the
-- sweep reads as "unknown, do not ask" — backfilling from updatedAt would date
-- a year-old delivery to this migration and mail everyone at once.
ALTER TABLE "Order" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryEmailSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StockAlert" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateIndex
CREATE INDEX "StockAlert_productId_notifiedAt_idx" ON "StockAlert"("productId", "notifiedAt");

-- CreateIndex
CREATE INDEX "Order_status_deliveredAt_reviewRequestedAt_idx" ON "Order"("status", "deliveredAt", "reviewRequestedAt");

-- CreateIndex
CREATE INDEX "Order_status_recoveryEmailSentAt_idx" ON "Order"("status", "recoveryEmailSentAt");

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
