import NodeCache from "node-cache";

/**
 * A cache for search suggestions, deliberately separate from `myCache`.
 *
 * Every other cached key in the app is one the code chose — "latest-products",
 * `product-${id}`. This one is the *user's search term*, so the key space is
 * unbounded and attacker-controlled: a script issuing `?q=aaa`, `?q=aab`, … on
 * the shared instance would grow it without limit and evict every real entry on
 * the way. `maxKeys` turns that into a bounded, self-limiting cost, and keeping
 * it out of `myCache` means it can never push a product or an order out.
 *
 * The TTL is short because a suggestion dropdown is the one place stale data
 * costs nothing: sixty seconds after an admin renames a product, the worst case
 * is one visitor seeing the old name for a moment before the click resolves
 * against live data. `invalidateCache({ product: true })` flushes it anyway.
 */
export const suggestCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 120,
  maxKeys: 500,
  useClones: false,
});

/** `set` throws once `maxKeys` is reached; a full cache must not 500 a search. */
export const rememberSuggestion = (key: string, value: unknown) => {
  try {
    suggestCache.set(key, value);
  } catch {
    // Full. The next TTL sweep makes room; serving uncached is correct
    // behaviour in the meantime.
  }
};
