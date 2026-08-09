import { NextFunction, Request, RequestHandler, Response } from "express";
import type { Permission } from "../generated/prisma/index.js";
import { prisma } from "../utils/db.js";
import {
  bearerToken,
  secondsSinceAuth,
  tokenAuthConfigured,
  verifyAdminToken,
  type AdminToken,
} from "../utils/firebaseAuth.js";
import { staffCan } from "../utils/permissions.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { LIMITS } from "../utils/validate.js";
import { TryCatch } from "./error.js";

/**
 * Authorization for the whole API.
 *
 * Two questions, answered by two different records, and they are not the same
 * question:
 *
 *   - `User.role` — is this account staff at all? Read by the *storefront* to
 *     decide whether to show a link. **No decision in this file reads it.**
 *   - `StaffMember` — and what may they do? The only thing consulted here.
 *
 * `adminOnly` used to answer both with one boolean and is deliberately gone
 * rather than deprecated: leaving it in place is how the next admin route ends
 * up with an all-or-nothing guard. Every admin route now names the permission
 * it needs, and `utils/routeAudit.ts` refuses to start the server if one
 * doesn't.
 */

/**
 * The marker `utils/routeAudit.ts` looks for. A handler without one is not a
 * guard as far as the boot check is concerned, so a middleware that *looks*
 * like authorization but was never registered here cannot satisfy it.
 */
export const GUARD = Symbol("route.guard");

export type GuardKind =
  | { kind: "user" }
  | { kind: "self" }
  | { kind: "self-or-staff"; permission: Permission }
  | { kind: "staff" }
  | { kind: "permission"; permission: Permission }
  | { kind: "root" };

type Guard = RequestHandler & { [GUARD]: GuardKind };

const guard = (handler: RequestHandler, kind: GuardKind): Guard =>
  Object.assign(handler, { [GUARD]: kind });

export const guardOf = (handler: unknown): GuardKind | undefined =>
  (handler as Partial<Guard>)?.[GUARD];

/**
 * Resolves the caller from `?id=<firebase uid>` — the app's only proof of
 * identity. The length cap keeps a multi-kilobyte query string from reaching
 * the database on every request.
 *
 * The staff row is loaded in the same query rather than a second one, so
 * authorization never costs an extra round trip and can never read a staff row
 * from a different instant than the user row it belongs to.
 */
const resolveRequester = async (req: Request) => {
  const { id } = req.query;

  if (typeof id !== "string" || id.length === 0 || id.length > LIMITS.userId)
    return null;

  return prisma.user.findUnique({ where: { id }, include: { staff: true } });
};

/**
 * A closed account. The row survives because orders reference it, but the uid
 * stops being a credential the moment the customer closes the account —
 * Firebase would still authenticate them, so this is the only thing that makes
 * closure take effect. Every guard checks it for that reason.
 */
const isClosed = (user: { deletedAt: Date | null }) => user.deletedAt !== null;

/** Loads the caller onto the request, or returns the error to send. */
const attachRequester = async (req: Request): Promise<ErrorHandler | null> => {
  if (!req.query.id) return new ErrorHandler("Please Login first", 401);

  const user = await resolveRequester(req);
  if (!user) return new ErrorHandler("Invalid Id ", 401);
  if (isClosed(user))
    return new ErrorHandler("This account has been closed", 401);

  const { staff, ...plain } = user;
  req.appUser = plain;
  req.staff = staff;
  return null;
};

/**
 * Origins allowed to call an admin endpoint from a browser.
 *
 * The console lives on its own host (app.admin.<domain>) precisely so this list
 * can be one entry long. Storefront pages are never supposed to reach an admin
 * route, so a request carrying the storefront's Origin is either a bug or a
 * page doing something on a signed-in admin's behalf — refuse both.
 */
/**
 * Read on first use, not at import.
 *
 * ESM evaluates every import before `app.ts` reaches its own `config()` call,
 * so a module-level read of process.env here saw `undefined` and disabled the
 * pin entirely for any deploy that gets its configuration from a `.env` file.
 * It only appeared to work under compose, where ADMIN_URL is a real environment
 * variable. A security control whose failure mode is "silently off" has to be
 * evaluated late.
 */
let adminOriginCache: string[] | null = null;

const adminOrigins = () =>
  (adminOriginCache ??= (process.env.ADMIN_URL || "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean));

/**
 * `Origin` is set by the browser and cannot be forged by page script, so when
 * it is present it is trustworthy. It is *absent* on same-origin GETs and on
 * non-browser callers (curl, the seed script, a monitoring probe), which is why
 * a missing header is not itself a rejection — there is no browser to lie about
 * it. With ADMIN_URL unset the check is off entirely: an unconfigured deploy
 * should keep working, and CORS already refuses cross-origin reads.
 */
const originAllowed = (req: Request) => {
  const allowed = adminOrigins();
  if (allowed.length === 0) return true;

  const origin = req.get("origin");
  if (!origin) return true;

  return allowed.includes(origin.replace(/\/$/, ""));
};

/**
 * Establishes *who* is calling an admin route, and how they proved it.
 *
 * The uid comes from the verified token and never from `?id=`. That is the
 * whole point of the split: if the query parameter were still consulted here,
 * an operator could authenticate as themselves and then act as somebody else
 * by changing one character in the URL — which is worse than the bearer-uid
 * scheme it replaced, not better. `?id=` is ignored on these routes entirely.
 *
 * Storefront routes keep `?id=`, deliberately. They authorize a person to touch
 * their own cart and orders; the console authorizes them to touch everyone's.
 */
const resolveAdminIdentity = async (req: Request): Promise<string> => {
  if (!tokenAuthConfigured()) {
    // Fail closed in production. An unconfigured deploy that quietly fell back
    // to `?id=` would be a console protected by a string in a URL while
    // everything — the docs, this file, the console's own UI — claimed
    // otherwise. Loud breakage is the correct outcome.
    if (process.env.NODE_ENV === "production")
      throw new ErrorHandler(
        "Console authentication is not configured on this server",
        503
      );

    // Development only, and only so the dev sign-in bypass (which has no
    // Firebase session and therefore no token) keeps working. A real Google
    // sign-in in dev sends a token, which nothing here can verify — hence the
    // instruction rather than a bare 401, because "Please Login first" in
    // response to having just logged in is the least helpful answer available.
    const { id } = req.query;
    if (typeof id !== "string" || !id)
      throw new ErrorHandler(
        "Console authentication is not configured on this server. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in backend/.env, or use the dev sign-in bypass.",
        401
      );
    return id;
  }

  const token = bearerToken(req.get("authorization"));
  if (!token) throw new ErrorHandler("Please Login first", 401);

  const decoded = await verifyAdminToken(token);
  req.adminToken = decoded;
  return decoded.uid;
};

/**
 * Common prologue for every console route: right origin, verified identity,
 * staff row present and not suspended.
 *
 * Suspension is reported distinctly from "not staff" on purpose. The caller is
 * already authenticated as themselves, so telling them their own access is
 * paused leaks nothing, and the alternative — a generic refusal — sends people
 * to re-authenticate over and over against a door that will never open.
 *
 * The staff row is re-read on every request, so suspending someone bites on
 * their next click. Verifying a token does not change that and must not be
 * allowed to: the token says who they are, the row says what they may do, and
 * only one of those is safe to cache.
 */
const staffPrologue = async (
  req: Request,
  skipStaffChecks = false
): Promise<ErrorHandler | null> => {
  if (!originAllowed(req))
    return new ErrorHandler("Not allowed to access this resource", 403);

  let uid: string;
  try {
    uid = await resolveAdminIdentity(req);
  } catch (error) {
    return error instanceof ErrorHandler
      ? error
      : new ErrorHandler("Could not verify your session", 401);
  }

  if (uid.length > LIMITS.userId) return new ErrorHandler("Invalid Id ", 401);

  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: { staff: true },
  });
  if (!user) return new ErrorHandler("Invalid Id ", 401);
  if (isClosed(user))
    return new ErrorHandler("This account has been closed", 401);

  const { staff, ...plain } = user;
  req.appUser = plain;
  req.staff = staff;

  if (skipStaffChecks) return null;

  if (!staff) return new ErrorHandler("This account has no console access", 403);

  if (staff.status === "suspended")
    return new ErrorHandler("Your console access has been suspended", 403);

  return null;
};

/**
 * Step-up authentication, for changes to who has access.
 *
 * A token refreshes itself hourly with nobody at the keyboard, so a valid token
 * proves the session exists, not that its owner is present. `auth_time` — when
 * the human last actually authenticated — is the only thing that separates an
 * operator making a decision from an unattended tab, and granting somebody
 * console access is the decision most worth being sure about.
 *
 * Answers 401 with a distinguishable code so the console can offer a
 * re-authentication prompt instead of a dead-end error.
 */
export const requireRecentAuth = (withinSeconds = 300): RequestHandler =>
  TryCatch(async (req, res, next) => {
    // The dev bypass has no token and no way to produce one; step-up cannot
    // apply where there was no authentication step to repeat.
    if (!tokenAuthConfigured() && process.env.NODE_ENV !== "production")
      return next();

    if (!req.adminToken)
      return next(new ErrorHandler("Please Login first", 401));

    if (secondsSinceAuth(req.adminToken) > withinSeconds)
      return res.status(401).json({
        success: false,
        code: "REAUTH_REQUIRED",
        message: "Confirm it is you before changing console access.",
      });

    next();
  });

/**
 * A verified console caller, staff or not.
 *
 * `GET /access/me` is the only route that wants this: it has to be able to
 * answer "you have no console access" and "your access is suspended", and a
 * guard that refuses those callers cannot tell them so. It still verifies the
 * token and still pins the origin — the caller is authenticated, they are just
 * not authorized for anything.
 */
export const requireConsoleUser: Guard = guard(
  TryCatch(async (req, res, next) => {
    const failed = await staffPrologue(req, true);
    return failed ? next(failed) : next();
  }),
  { kind: "user" }
);

/**
 * Console access with no particular capability. Used only where the answer is
 * about the caller themselves (`GET /access/me` sits behind verifyUser instead,
 * because a non-staff account has to be able to be *told* it is not staff).
 */
export const requireStaff: Guard = guard(
  TryCatch(async (req, res, next) => {
    const failed = await staffPrologue(req);
    return failed ? next(failed) : next();
  }),
  { kind: "staff" }
);

/**
 * The guard every admin route wears.
 *
 * Naming the permission at the route is what makes the boot-time audit
 * possible: the router stack can be read for what each endpoint requires, so a
 * new route with no permission is a startup failure rather than an open door
 * nobody noticed.
 */
export const requirePermission = (permission: Permission): Guard =>
  guard(
    TryCatch(async (req, res, next) => {
      const failed = await staffPrologue(req);
      if (failed) return next(failed);

      if (!staffCan(req.staff, permission))
        return next(
          new ErrorHandler("You do not have permission to do that", 403)
        );

      next();
    }),
    { kind: "permission", permission }
  );

/**
 * The owner account, and only it.
 *
 * Root is a column, not a permission, so it cannot be handed out by the very
 * endpoints it protects. `access_manage` exists alongside it purely so the
 * console has something to render a tab from; nothing can be granted it.
 */
export const requireRoot: Guard = guard(
  TryCatch(async (req, res, next) => {
    const failed = await staffPrologue(req);
    if (failed) return next(failed);

    if (!req.staff!.isRoot)
      return next(
        new ErrorHandler("Only the owner account can manage console access", 403)
      );

    next();
  }),
  { kind: "root" }
);

/** Any known uid. The storefront's own guard; grants nothing in the console. */
export const verifyUser: Guard = guard(
  TryCatch(async (req, res, next) => {
    const failed = await attachRequester(req);
    return failed ? next(failed) : next();
  }),
  { kind: "user" }
);

/**
 * Allows a caller through only for their own `:id` route param, or if they hold
 * the permission that covers reading other people's records. Used on endpoints
 * that return another user's row — `GET /api/v1/user/:id` returns email, date
 * of birth and role, so it must not be readable by anyone who merely knows a
 * Firebase uid.
 */
export const selfOrAdmin = (param = "id"): Guard =>
  guard(
    TryCatch(async (req, res, next) => {
      const failed = await attachRequester(req);
      if (failed) return next(failed);

      const isSelf = req.appUser!.id === String(req.params[param]);
      if (!isSelf && !staffCan(req.staff, "customers_read"))
        return next(new ErrorHandler("Not allowed to access this resource", 403));

      next();
    }),
    { kind: "self-or-staff", permission: "customers_read" }
  );

/**
 * The caller, and only the caller, for their own `:id` route param.
 *
 * Distinct from `selfOrAdmin` because that one's escape hatch is
 * `customers_read` — the right answer for an endpoint that *returns* a customer
 * record, and the wrong one for an endpoint that *changes* it. An operator
 * holding only read access must not be able to rewrite somebody's name through
 * a route that let them look at it. There is deliberately no staff bypass at
 * all: editing a customer's own profile is not an operator task, and a console
 * that can do it is a console that can be used to impersonate.
 */
export const requireSelf = (param = "id"): Guard =>
  guard(
    TryCatch(async (req, res, next) => {
      const failed = await attachRequester(req);
      if (failed) return next(failed);

      if (req.appUser!.id !== String(req.params[param]))
        return next(new ErrorHandler("Not allowed to access this resource", 403));

      next();
    }),
    { kind: "self" }
  );

/** Re-exported so controllers can ask the same question the guards asked. */
export { staffCan };
export type { NextFunction, Request, Response };
