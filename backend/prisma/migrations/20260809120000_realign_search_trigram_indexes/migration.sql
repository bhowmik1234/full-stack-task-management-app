-- Put the trigram indexes on the columns the queries actually filter on.
--
-- add_search_trigram_indexes created them over `lower("name")` and
-- `lower("brand")`, and its own comment names getAllProducts as the reason. But
-- getAllProducts filters with Prisma's `mode: "insensitive"`, which emits
-- `"name" ILIKE '%term%'` — and the planner will only use an expression index
-- when the predicate matches the expression exactly. `ILIKE` against a
-- `lower(name)` index does not match, so the endpoint the indexes were built
-- for never used them and kept sequentially scanning Product on every search.
-- Only suggestProducts, which lowercased both sides by hand, benefited.
--
-- Nothing looked broken because both queries returned the right rows. A missing
-- index is invisible until the table is large enough to hurt, and by then the
-- cause is a migration nobody is looking at.
--
-- pg_trgm answers LIKE, ILIKE and the regex operators from a gin_trgm_ops index
-- on the raw column, so one pair of indexes serves both callers. suggestProducts
-- moves to ILIKE in the same change; its ORDER BY still lowercases, which is
-- fine — ordering a handful of already-selected rows uses no index.
--
-- Dropping rather than keeping both: four trigram indexes on one table is real
-- write amplification on every product insert and update, to serve two
-- predicates that should have been one.

DROP INDEX IF EXISTS "product_name_trgm";
DROP INDEX IF EXISTS "product_brand_trgm";

CREATE INDEX "product_name_trgm" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "product_brand_trgm" ON "Product" USING GIN ("brand" gin_trgm_ops);
