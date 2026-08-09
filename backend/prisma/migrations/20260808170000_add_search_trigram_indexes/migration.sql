-- Make the catalogue's substring search index-backed.
--
-- Search is `name ILIKE '%term%'` (see getAllProducts). A leading wildcard
-- defeats a btree index, so every search was a sequential scan over Product.
-- That is free at the current catalogue size and is exactly the wrong shape for
-- an autocomplete, which runs the same query on almost every keystroke.
--
-- Trigram GIN indexes are the fix: pg_trgm can answer an infix ILIKE from an
-- index, and it also exposes similarity(), which is what a later typo-tolerant
-- pass ("labtop" -> "laptop") would rank on.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- lower(...) in the index expression must match the predicate the query builds,
-- or the planner will not use it. The suggest handler lowercases both sides for
-- exactly that reason.
CREATE INDEX "product_name_trgm" ON "Product" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX "product_brand_trgm" ON "Product" USING GIN (lower("brand") gin_trgm_ops);

-- Related products (part two) match on brand as well as category. Category is
-- already indexed; this is the other half, and it costs nothing to add now.
CREATE INDEX "Product_brand_idx" ON "Product"("brand");
