import crypto from "crypto";

/**
 * One-click unsubscribe links for non-transactional mail.
 *
 * The person clicking is reading email, not signed in — an unsubscribe that
 * demands a login is one people answer by hitting "mark as spam" instead, which
 * damages delivery for every message the store sends including receipts. So the
 * link has to carry its own authority, and that authority is an HMAC over the
 * user id.
 *
 * What the signature buys is narrow and worth being precise about: it stops
 * someone unsubscribing *other people* by walking uids through the endpoint. It
 * is not a session — the token grants exactly one capability, "stop sending
 * marketing to this uid", and nothing else. Anyone who intercepts the link can
 * use it, which is an acceptable trade for a capability whose worst outcome is
 * that a customer receives fewer emails.
 *
 * Deliberately not expiring. A message sits in a mailbox for years and an
 * unsubscribe link that has gone stale is functionally a broken one, which is
 * the failure this exists to prevent.
 */

/**
 * Derived from the Razorpay key secret rather than adding another required
 * variable, but namespaced so the two are not interchangeable: a token minted
 * here must never be a valid signature anywhere else, and vice versa.
 *
 * Read lazily, for the reason documented on ADMIN_URL — ESM evaluates imports
 * before `app.ts` calls `config()`, so a module-scope read would silently see
 * `undefined` on `.env`-based deploys.
 */
const secret = () => {
  const base = process.env.MAIL_UNSUBSCRIBE_SECRET || process.env.RAZORPAY_KEY_SECRET || "";
  return base ? `unsubscribe:${base}` : "";
};

export const unsubscribeConfigured = () => Boolean(secret());

const sign = (userId: string) =>
  crypto.createHmac("sha256", secret()).update(userId).digest("hex");

/** `<uid>.<hmac>`. The uid is in the clear so the endpoint knows who to act on. */
export const unsubscribeToken = (userId: string) =>
  unsubscribeConfigured() ? `${userId}.${sign(userId)}` : "";

/**
 * The uid a token vouches for, or null.
 *
 * Compared with `timingSafeEqual` like the payment signatures, and length is
 * checked first because that function throws on a mismatch rather than
 * returning false.
 */
export const verifyUnsubscribeToken = (token: unknown): string | null => {
  if (typeof token !== "string" || !unsubscribeConfigured()) return null;

  // The uid itself may contain no dot (Firebase uids are alphanumeric), so
  // splitting on the last one is safe and tolerates any future format that
  // does.
  const cut = token.lastIndexOf(".");
  if (cut <= 0) return null;

  const userId = token.slice(0, cut);
  const provided = token.slice(cut + 1);
  const expected = sign(userId);

  if (provided.length !== expected.length) return null;

  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
      ? userId
      : null;
  } catch {
    return null;
  }
};

/** The link that goes in the footer of every non-transactional message. */
export const unsubscribeUrl = (userId: string, siteUrl: string) => {
  const token = unsubscribeToken(userId);
  if (!token || !siteUrl) return "";
  return `${siteUrl}/api/v1/user/unsubscribe?token=${encodeURIComponent(token)}`;
};
