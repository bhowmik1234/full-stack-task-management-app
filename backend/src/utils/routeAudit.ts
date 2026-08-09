import type { Router } from "express";
import { guardOf, type GuardKind } from "../middlewares/auth.js";

/**
 * Deny by default, checked at boot.
 *
 * Authorization here is per-route middleware, which means the failure mode is
 * omission: a route that forgets its guard is not a compile error, not a test
 * failure and not a visible bug — it is an open endpoint that behaves normally
 * for everyone who tries it. That is the single most likely way this app gets
 * an access-control hole, and it is the one thing a permission model cannot
 * fix by itself.
 *
 * So every route under /api/v1 must carry either a guard from
 * `middlewares/auth.ts` or an explicit entry in PUBLIC below, and the server
 * refuses to start otherwise. Making a route public becomes a deliberate line
 * of code with a reason next to it, reviewed like any other.
 */

/**
 * Routes that are meant to be reachable with no credential at all. Each one
 * needs a reason, because each one is a decision.
 */
const PUBLIC = new Map<string, string>([
  ["GET /api/v1/product/all", "Catalogue browse and search. The shop itself."],
  ["GET /api/v1/product/latest", "Home page rail."],
  ["GET /api/v1/product/category", "Category filter options."],
  [
    "GET /api/v1/product/suggest",
    "Search type-ahead. Returns the same public catalogue data as /product/all in a leaner shape; a signed-out visitor can already search, so requiring a uid here would only break the box for them. Bounded by suggestLimiter.",
  ],
  ["GET /api/v1/product/:id", "Product page. Signed-out visitors can browse."],
  ["GET /api/v1/product/:id/reviews", "Reviews are public; writing one is not."],
  [
    "GET /api/v1/product/:id/related",
    "The 'you may also like' rail on the product page. Returns the same public catalogue rows the product page already shows.",
  ],
  [
    "POST /api/v1/user/new",
    "Account creation. The caller has just proved identity to Firebase and has no app-side credential yet. Never reads `role` from the body.",
  ],
  [
    "GET /api/v1/user/unsubscribe",
    "One-click unsubscribe from an email footer. The caller is a mail client following a link and has no session; authority is an HMAC over the uid instead (utils/unsubscribe.ts), the same trade the Razorpay webhook makes. Requiring a sign-in here is what makes people press 'spam' instead, which costs delivery of the receipts too. The token grants exactly one capability — stop sending marketing to this uid — and the endpoint answers identically for a bad token so it cannot be used to probe for accounts.",
  ],
  [
    "GET /api/v1/config/storefront",
    "Tax, shipping and COD rules the cart needs to show a total. Public because the cart is: a signed-out visitor fills one before there is any account to attach it to. It exposes no data that is not already visible on the checkout page, and it is advisory — calculateOrderAmounts re-derives every figure inside the checkout transaction and its answer is what gets charged.",
  ],
  [
    "POST /api/v1/payement/webhook",
    "Razorpay's callback. It has no uid to send, so it is authenticated by an HMAC over the raw body instead (utils/razorpay.ts).",
  ],
]);

export type Mount = { path: string; router: Router };

type Registered = { method: string; path: string; guard?: GuardKind };

/** Express keeps no public accessor for a router's layers; this is that shape. */
type Layer = {
  name?: string;
  route?: {
    path: string | string[];
    stack: { method?: string; handle: unknown }[];
  };
  handle?: { stack?: Layer[] };
};

const collect = (router: Router, prefix: string): Registered[] => {
  const out: Registered[] = [];

  for (const layer of (router as unknown as { stack: Layer[] }).stack ?? []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];

      // One route runs several handlers — rate limiters, multer, the
      // controller — and exactly one of them is the guard, so the verdict is
      // per (method, path) and not per handler.
      for (const path of paths) {
        const byMethod = new Map<string, GuardKind | undefined>();

        for (const handler of layer.route.stack) {
          if (!handler.method) continue;
          const method = handler.method.toUpperCase();
          byMethod.set(method, byMethod.get(method) ?? guardOf(handler.handle));
        }

        for (const [method, guard] of byMethod)
          out.push({
            method,
            path: `${prefix}${path === "/" ? "" : path}`,
            guard,
          });
      }

      continue;
    }

    // A router mounted inside a router. None exist today; recursing keeps the
    // audit honest if one is ever added, at the cost of a vaguer path label.
    if (layer.name === "router" && layer.handle?.stack)
      out.push(...collect(layer.handle as unknown as Router, `${prefix}/*`));
  }

  return out;
};

/**
 * Folds the handlers of one route into a single verdict.
 *
 * A route lists several handlers (rate limiters, multer, the controller) and
 * only one of them is a guard, so the route is guarded if *any* handler is.
 * Two different guards on one route would be a mistake worth catching, but it
 * is not reachable through the helpers in auth.ts, so it is not checked here.
 */
const describe = (guard: GuardKind) => {
  switch (guard.kind) {
    case "permission":
      return guard.permission;
    case "self-or-staff":
      return `self or ${guard.permission}`;
    default:
      return guard.kind;
  }
};

/**
 * Throws — before the server listens — if any route is neither guarded nor
 * explicitly public. Also reports allowlist entries that no longer match a
 * route, so a deleted endpoint cannot leave a stale exemption behind that some
 * future route silently inherits by having the same path.
 */
export const auditRouteGuards = (mounts: Mount[]) => {
  const routes = mounts.flatMap(({ path, router }) => collect(router, path));

  const unguarded: string[] = [];
  const matched = new Set<string>();

  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (route.guard) continue;
    if (PUBLIC.has(key)) {
      matched.add(key);
      continue;
    }
    unguarded.push(key);
  }

  const stale = [...PUBLIC.keys()].filter((key) => !matched.has(key));

  if (unguarded.length || stale.length) {
    const lines = [
      "Route guard audit failed.",
      ...unguarded.map(
        (key) =>
          `  UNGUARDED  ${key}\n             add a guard from middlewares/auth.ts, or list it in utils/routeAudit.ts with a reason.`
      ),
      ...stale.map(
        (key) =>
          `  STALE      ${key}\n             listed as public but no such route exists; remove the entry.`
      ),
    ];
    throw new Error(lines.join("\n"));
  }

  const guarded = routes.filter((r) => r.guard).length;
  console.log(
    `[auth] ${guarded} guarded route${guarded === 1 ? "" : "s"}, ${
      PUBLIC.size
    } deliberately public`
  );

  return routes.map((r) => ({
    route: `${r.method} ${r.path}`,
    requires: r.guard ? describe(r.guard) : "public",
  }));
};
