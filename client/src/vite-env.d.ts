/// <reference types="vite/client" />

/**
 * The VITE_* values both entries read. Declaring them turns a typo into a
 * compile error rather than `undefined` at runtime, and documents which build
 * needs which.
 */
interface ImportMetaEnv {
  /** Storefront API origin. Empty means same-origin, which is the deployed case. */
  readonly VITE_SERVER: string;
  /** Console API origin. Only needed for `npm run dev`; same-origin otherwise. */
  readonly VITE_ADMIN_SERVER: string;

  readonly VITE_FIREBASE_KEY: string;
  readonly VITE_FIREBASE_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_BUCKET: string;
  readonly VITE_FIREBASE_SENDER_ID: string;
  readonly VITE_FIREBASE_APPID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID: string;

  /** "true" enables the dev sign-in bypass; compiled out of a production build. */
  readonly VITE_DEV_AUTH_BYPASS: string;

  /**
   * Store identity, rendered into the policy pages and the page titles.
   *
   * These exist because the policies are real documents a customer (and a
   * payment provider's onboarding review) will read, and every one of them has
   * to name the business, say where it is and give an address to write to. They
   * are build-time values like every other VITE_*, so changing one needs
   * `docker compose build web`.
   *
   * All four have defaults, so an unconfigured build renders complete pages with
   * obvious placeholders rather than the word "undefined" in a legal document.
   */
  readonly VITE_STORE_NAME: string;
  readonly VITE_SUPPORT_EMAIL: string;
  readonly VITE_SUPPORT_PHONE: string;
  readonly VITE_STORE_ADDRESS: string;

  /** Canonical storefront origin, for <link rel="canonical"> and og:url. */
  readonly VITE_SITE_URL: string;

  /**
   * Social profiles for the footer. Unlike the values above these have no
   * defaults: the footer renders an icon only when its URL is set, because the
   * alternative — the `href="#"` placeholders these replaced — is a click that
   * does nothing, which reads as a broken page rather than an absent account.
   */
  readonly VITE_SOCIAL_FACEBOOK: string;
  readonly VITE_SOCIAL_TWITTER: string;
  readonly VITE_SOCIAL_INSTAGRAM: string;
  readonly VITE_SOCIAL_PINTEREST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
