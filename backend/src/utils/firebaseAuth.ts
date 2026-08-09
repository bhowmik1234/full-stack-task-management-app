import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import ErrorHandler from "./utiliy-class.js";

/**
 * Server-side verification of Firebase ID tokens, for admin routes only.
 *
 * The storefront still authenticates with `?id=<uid>`, and that is a deliberate
 * split rather than a half-finished migration. A uid on the query string is a
 * bearer credential: it reaches nginx access logs, browser history and the
 * Referer header, and — crucially — it says nothing about *how* its owner
 * signed in. That last part is what makes it unusable for the console.
 *
 * A rule like "operators must use Google, with a session no older than a day"
 * cannot be enforced in the console's UI: an attacker who can sign in as the
 * operator on the storefront gets the same uid and calls the admin API
 * directly, never loading a line of the console's code. The rule only becomes
 * real when the server can see the provider, the sign-in time and the second
 * factor — which is exactly what an ID token carries and a uid does not.
 */

/** Providers an operator may sign in with. Google alone by default. */
const allowedProviders = () =>
  (process.env.ADMIN_SIGN_IN_PROVIDERS || "google.com")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * How old a sign-in may be before the console makes them do it again.
 *
 * Distinct from the token's own one-hour lifetime, which refreshes silently
 * and forever: `auth_time` is when the human last actually authenticated, so
 * this is what puts a ceiling on a session left open on a warehouse machine.
 */
const sessionMaxAgeSeconds = () =>
  Number(process.env.ADMIN_SESSION_MAX_AGE_HOURS || 12) * 3600;

/**
 * Second-factor requirement. Off by default because turning it on without
 * enrolling first locks every operator out, including the owner — and Firebase
 * MFA needs the project upgraded to Identity Platform. Enrol, then set
 * ADMIN_REQUIRE_MFA=true.
 */
const requireMfa = () => process.env.ADMIN_REQUIRE_MFA === "true";

/**
 * Whether token verification is configured at all.
 *
 * Read lazily for the same reason the origin pin is: ESM evaluates this module
 * before app.ts calls config(), so anything read at import time is undefined
 * and the check silently disables itself.
 */
export const tokenAuthConfigured = () =>
  Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );

/**
 * Catches the credential being wrong *shaped* before it is used.
 *
 * The service-account JSON has `private_key_id` sitting directly above
 * `client_email`, and pasting the wrong one is a mistake that survives every
 * check further down: `cert()` accepts it, the app initialises, and the failure
 * only surfaces later as a token that will not verify — for no stated reason,
 * because the real error is Google refusing to mint an access token for an
 * identity that does not exist. This turns that into a sentence naming the
 * field.
 */
const assertCredentialShape = () => {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || "";

  if (!clientEmail.includes("@"))
    throw new Error(
      "FIREBASE_CLIENT_EMAIL does not look like an email address. Use the " +
        '`client_email` field from the service-account JSON ("firebase-adminsdk-' +
        'xxxxx@<project>.iam.gserviceaccount.com"), not `private_key_id`.'
    );

  if (!privateKey.includes("BEGIN PRIVATE KEY"))
    throw new Error(
      "FIREBASE_PRIVATE_KEY does not contain a PEM private key. Use the " +
        "`private_key` field from the service-account JSON, quoted, keeping " +
        "its \\n escapes."
    );
};

let initialized = false;

const app = () => {
  if (!initialized) {
    assertCredentialShape();

    if (getApps().length === 0)
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Service-account keys carry literal newlines, which .env files and
          // most secret managers flatten to the two characters \ and n.
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
        }),
      });
    initialized = true;
  }

  return getAuth();
};

export type AdminToken = DecodedIdToken & {
  firebase: DecodedIdToken["firebase"] & { sign_in_second_factor?: string };
};

/** Pulls the bearer token out of the Authorization header, if there is one. */
export const bearerToken = (header?: string) => {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
};

/**
 * Verifies a token and applies the console's sign-in policy.
 *
 * `checkRevoked` costs a lookup against Firebase but is what makes "sign this
 * operator out everywhere" work — without it a stolen token stays valid for up
 * to an hour after the account is disabled, which is the hour that matters.
 *
 * Throws ErrorHandler so the failures reach the client as ordinary messages
 * rather than as a 500 with a Firebase stack trace in it.
 */
export const verifyAdminToken = async (token: string): Promise<AdminToken> => {
  let decoded: AdminToken;

  try {
    decoded = (await app().verifyIdToken(token, true)) as AdminToken;
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";

    if (code.includes("id-token-expired"))
      throw new ErrorHandler("Your session expired. Sign in again.", 401);
    if (code.includes("id-token-revoked"))
      throw new ErrorHandler("Your session was ended. Sign in again.", 401);

    // Everything else is a misconfiguration wearing an authentication error's
    // clothes: the wrong project, a malformed credential, a clock out of step,
    // no route to Google's public keys. The operator must not be told which —
    // it is not their problem and the detail is a probing aid — but somebody
    // has to be, or the only symptom is a sign-in that fails silently forever.
    console.error(
      "[auth] ID token verification failed:",
      code || "(no code)",
      (error as Error)?.message
    );

    throw new ErrorHandler("Could not verify your session. Sign in again.", 401);
  }

  const provider = decoded.firebase?.sign_in_provider ?? "unknown";
  if (!allowedProviders().includes(provider))
    throw new ErrorHandler(
      `The console does not accept ${
        provider === "phone" ? "phone" : provider
      } sign-in. Use a permitted provider.`,
      403
    );

  if (requireMfa() && !decoded.firebase?.sign_in_second_factor)
    throw new ErrorHandler(
      "The console requires two-factor authentication on your account.",
      403
    );

  const age = Math.floor(Date.now() / 1000) - decoded.auth_time;
  if (age > sessionMaxAgeSeconds())
    throw new ErrorHandler("Your session is too old. Sign in again.", 401);

  return decoded;
};

/**
 * What Firebase itself holds for a uid — the identifiers, and which providers
 * are linked to the account.
 *
 * This exists so the "link a second sign-in method" endpoint never has to
 * believe the request body. Storefront auth is a bearer uid, so a client that
 * simply *asserted* "my email is now x@y.com" would let anyone who learned a
 * uid write an arbitrary address onto that account — and because `User.email`
 * is unique, also squat on an address a real person is about to sign up with.
 * Reading it back from Firebase turns the endpoint into a reconciliation of a
 * link the client already completed against a provider, which is a fact rather
 * than a claim.
 */
export const providerIdentities = async (uid: string) => {
  const record = await app().getUser(uid);

  return {
    email: record.email ?? null,
    phone: record.phoneNumber ?? null,
    providers: record.providerData.map((p) => p.providerId),
    disabled: record.disabled,
  };
};

/**
 * Step-up: how recently the human proved who they were, in seconds.
 *
 * Not the same question as "is this token valid" — a token refreshes itself
 * without anybody touching the keyboard, so only `auth_time` distinguishes an
 * operator who is present from a tab that has been open since Tuesday.
 */
export const secondsSinceAuth = (token: AdminToken) =>
  Math.floor(Date.now() / 1000) - token.auth_time;
