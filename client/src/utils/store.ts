/**
 * The store's own identity, as the storefront renders it.
 *
 * These are read in the policy pages, the contact page and every `<title>`, and
 * they are the details a customer needs to be able to act on: who they bought
 * from, where to write, how long they have to send something back.
 *
 * Every accessor has a default that is visibly a placeholder rather than a
 * plausible-looking invention. A returns policy that quietly states a made-up
 * postal address is worse than one that says "set VITE_STORE_ADDRESS" — the
 * first is wrong in a way nobody catches until a customer posts a parcel to it.
 */

const value = (raw: string | undefined, fallback: string) => {
  const trimmed = (raw ?? "").trim();
  return trimmed || fallback;
};

export const storeName = () => value(import.meta.env.VITE_STORE_NAME, "ebag");

export const supportEmail = () =>
  value(import.meta.env.VITE_SUPPORT_EMAIL, "support@example.com");

export const supportPhone = () => value(import.meta.env.VITE_SUPPORT_PHONE, "");

export const storeAddress = () =>
  value(import.meta.env.VITE_STORE_ADDRESS, "[set VITE_STORE_ADDRESS]");

/** Canonical origin, no trailing slash. Empty when unset — callers skip. */
export const siteUrl = () =>
  value(import.meta.env.VITE_SITE_URL, "").replace(/\/$/, "");

/**
 * The store's social profiles, for the footer.
 *
 * These have **no defaults**, deliberately, and the footer renders only the
 * ones that are set. They used to be four `href="#"` anchors, which is a click
 * that scrolls the page to the top and does nothing — a visitor reads that as a
 * broken site, where a missing icon reads as a shop that is not on Pinterest.
 * An absent link is honest; a dead one is not.
 *
 * Only http(s) URLs pass, so a misconfigured value cannot become a
 * `javascript:` href in a footer that renders on every page.
 */
export type SocialLink = { label: string; url: string };

const httpUrl = (raw: string | undefined): string => {
  const trimmed = (raw ?? "").trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
};

export const socialLinks = (): SocialLink[] =>
  (
    [
      { label: "Facebook", url: httpUrl(import.meta.env.VITE_SOCIAL_FACEBOOK) },
      { label: "Twitter", url: httpUrl(import.meta.env.VITE_SOCIAL_TWITTER) },
      { label: "Instagram", url: httpUrl(import.meta.env.VITE_SOCIAL_INSTAGRAM) },
      { label: "Pinterest", url: httpUrl(import.meta.env.VITE_SOCIAL_PINTEREST) },
    ] as SocialLink[]
  ).filter((link) => link.url);
