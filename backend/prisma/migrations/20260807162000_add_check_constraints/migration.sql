-- Invariants enforced by the database rather than by convention in application
-- code. stock_non_negative in particular makes overselling structurally
-- impossible: the concurrent-checkout race that could drive stock below zero
-- can no longer commit.
ALTER TABLE "Product" ADD CONSTRAINT "product_stock_non_negative" CHECK (stock >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "product_price_non_negative" CHECK (price >= 0);

ALTER TABLE "Order" ADD CONSTRAINT "order_total_non_negative" CHECK (total >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_subtotal_non_negative" CHECK (subtotal >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_discount_non_negative" CHECK (discount >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "orderitem_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "orderitem_price_non_negative" CHECK (price >= 0);

ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_amount_non_negative" CHECK (amount >= 0);
