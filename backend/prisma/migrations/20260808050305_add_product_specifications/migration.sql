-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "highlights" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "inTheBox" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "warranty" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ProductSpec" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'General',
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSpec_productId_position_idx" ON "ProductSpec"("productId", "position");

-- AddForeignKey
ALTER TABLE "ProductSpec" ADD CONSTRAINT "ProductSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Matches the invariants added in 20260807162000_add_check_constraints: a
-- specification with no label or no value is not a specification.
ALTER TABLE "ProductSpec" ADD CONSTRAINT "productspec_position_non_negative" CHECK (position >= 0);
ALTER TABLE "ProductSpec" ADD CONSTRAINT "productspec_label_not_blank" CHECK (length(btrim(label)) > 0);
ALTER TABLE "ProductSpec" ADD CONSTRAINT "productspec_value_not_blank" CHECK (length(btrim(value)) > 0);
