/**
 * Where the console talks to the API.
 *
 * Same-origin by default, and that is the deployed case: nginx serves the
 * console on app.admin.<domain> and proxies /api and /uploads from that same
 * host, so no CORS is involved and the backend's admin-origin pin (ADMIN_URL,
 * see backend/src/middlewares/auth.ts) sees exactly one origin.
 *
 * `VITE_SERVER` is deliberately *not* consulted here: it points at the
 * storefront's backend origin, and pointing the console at it would make every
 * admin request cross-origin — which the origin pin is there to refuse.
 * `VITE_ADMIN_SERVER` exists for `npm run dev`, where Vite is on :5173 and the
 * API on :3000 and same-origin cannot be true.
 */
export const adminServer =
  (import.meta.env.VITE_ADMIN_SERVER || "").replace(/\/$/, "") ||
  window.location.origin;

/** Builds a URL for an uploaded product image. */
export const uploadUrl = (path: string) => `${adminServer}/${path}`;

/**
 * The console's credential: a Firebase ID token, refreshed by the SDK.
 *
 * Unlike the storefront's `?id=<uid>`, this is short-lived, unforgeable, and —
 * the reason it exists here — it tells the server *how* the person signed in.
 * "Operators must use Google, with a session no older than a day" is only a
 * real rule if the server can check it; enforced in the console's UI alone it
 * is bypassed by signing in on the storefront and calling the API directly.
 *
 * Returns null when there is no Firebase session at all, which is the dev
 * bypass's case — it falls back to `?id=` and only works in development.
 */
export const currentIdToken = async (forceRefresh = false) => {
  const { auth } = await import("./firebase");
  const user = auth.currentUser;
  if (!user) return null;

  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    // Network trouble or a revoked account. The request goes out without a
    // token and comes back 401, which is the right outcome either way.
    return null;
  }
};
