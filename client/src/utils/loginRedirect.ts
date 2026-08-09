/**
 * Where /login sends people once they are signed in.
 *
 * `ProtectedRoute` was the only thing in the app that recorded where a visitor
 * was headed. Every other route to the sign-in page — the header icon, "Log in
 * to checkout", "Buy now", the review prompt — dropped it, so signing in from
 * anywhere landed on the home page and the customer had to find their way back
 * and click the same control again. This module is the one place that builds
 * that state, so a new sign-in entry point cannot quietly forget it.
 */

/** An action to finish once the visitor is back. See components/LoginIntent.tsx. */
export type LoginIntent = { type: "wishlist"; productId: string };

export type LoginState = { from: string; intent?: LoginIntent };

/**
 * Sanitise a return path.
 *
 * `from` ends up in `<Navigate to={from}>`, so it is not just a display value:
 * a protocol-relative path (`//example.com`) is a different *site*, and
 * `/login` is a redirect to the page doing the redirecting — which is the loop
 * that made `/login` unsafe to wrap in `ProtectedRoute` in the first place.
 * Anything that is not plainly an internal path falls back to the home page.
 */
export const safeReturnTo = (from?: string | null): string => {
  if (typeof from !== "string") return "/";
  if (!from.startsWith("/")) return "/";
  // `//host` and `/\host` are both read as protocol-relative by browsers.
  if (from.startsWith("//") || from.startsWith("/\\")) return "/";
  if (from === "/login" || from.startsWith("/login?")) return "/";
  return from;
};

/** Router state for any link or navigate() that lands on /login. */
export const loginState = (from: string, intent?: LoginIntent): LoginState => ({
  from: safeReturnTo(from),
  ...(intent ? { intent } : {}),
});

/** Read the state back on the other side, tolerating anything in history. */
export const readLoginState = (state: unknown): LoginState => {
  const raw = (state ?? {}) as Partial<LoginState>;
  return {
    from: safeReturnTo(raw.from),
    ...(raw.intent?.type === "wishlist" && typeof raw.intent.productId === "string"
      ? { intent: raw.intent }
      : {}),
  };
};

/** The current location as a return path — `pathname` plus its query. */
export const currentPath = (location: { pathname: string; search: string }) =>
  `${location.pathname}${location.search}`;
