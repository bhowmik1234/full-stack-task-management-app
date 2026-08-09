import rateLimit from "express-rate-limit";

/**
 * Rate limits keyed on client IP. `app.set("trust proxy", 1)` is what makes
 * `req.ip` the real client behind the nginx container rather than the proxy's
 * own address — without it every request would share one bucket.
 */
const common = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
};

/**
 * Blanket ceiling so no endpoint is unbounded.
 *
 * Raised from 300 when search suggestions landed. A debounced type-ahead fires
 * on roughly every fourth keystroke, so a fast typist browsing normally can
 * produce a couple of hundred requests a minute *by themselves* — and because
 * this limiter is app-wide, hitting it would lock them out of the catalogue and
 * their own cart, not just the dropdown. The per-route `suggestLimiter` below
 * is what actually bounds the type-ahead; this stays a backstop for everything
 * else and has to sit above the traffic the feature legitimately generates.
 */
export const globalLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 900,
});

/**
 * Search suggestions.
 *
 * Fires far more often than any other read, so it needs its own bucket rather
 * than a share of a general one — but the query is a single indexed lookup with
 * no joins, and a cache in front of it, so it is cheap enough that the cap can
 * be generous. Tight enough that scraping the catalogue a dropdown at a time is
 * slower than just reading /product/all.
 */
export const suggestLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 240,
});

/**
 * Coupon lookup is an unauthenticated oracle over a small code space, and each
 * checkout creates a real order at Razorpay. Both need a much tighter cap
 * than ordinary reads.
 */
export const sensitiveLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 15,
});

/** Writes: order placement, account creation, admin mutations. */
export const writeLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 60,
});

/**
 * Everything under the admin console.
 *
 * A uid is a bearer credential, so a leaked admin uid is a working admin
 * session — this is what stops one from being used to walk the whole customer
 * table or the audit trail at machine speed. The cap is generous for a human
 * clicking through the console (the dashboard alone fires several queries per
 * page) and tight for a script.
 */
export const adminLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 120,
});
