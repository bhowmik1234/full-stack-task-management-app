import express from "express";
import { requireConsoleUser, requireRecentAuth, requireRoot } from "../middlewares/auth.js";
import { adminLimiter, writeLimiter } from "../middlewares/rateLimit.js";
import {
  candidates,
  catalog,
  grantAccess,
  listStaff,
  me,
  revokeAccess,
  setStatus,
  transferRoot,
  updateAccess,
} from "../controllers/access.js";

const app = express.Router();

/**
 * Every mutation here changes who can act on the store, so each one asks the
 * operator to prove they are still at the keyboard. A token refreshes itself
 * silently for as long as the browser is open; `auth_time` is the only thing
 * that tells an unattended tab apart from a person making a decision.
 *
 * Five minutes is long enough to grant access to two people in a row without
 * re-authenticating between them, and short enough that a tab left open over
 * lunch cannot be used to add an operator.
 */
const stepUp = requireRecentAuth(5 * 60);

app.use(adminLimiter);

// route - /api/v1/access/me
// The console's bootstrap call: who is signed in, and what may they do. Behind
// requireConsoleUser rather than requireStaff because "you have no console
// access" and "your access is suspended" are answers this endpoint has to be
// able to give, and a guard that refuses non-staff cannot give them. The token
// is still verified — the caller is authenticated, just not authorized.
app.get("/me", requireConsoleUser, me);

// Everything below is the owner account's, and only the owner account's.
// requireRoot is a column check, not a permission check, so none of these can
// be reached by an operator who was granted a generous permission set.

// route - /api/v1/access/catalog
app.get("/catalog", requireRoot, catalog);

// route - /api/v1/access/staff
app
  .route("/staff")
  .get(requireRoot, listStaff)
  .post(requireRoot, stepUp, writeLimiter, grantAccess);

// route - /api/v1/access/candidates?q=
app.get("/candidates", requireRoot, candidates);

// route - /api/v1/access/staff/:userId
app
  .route("/staff/:userId")
  .put(requireRoot, stepUp, writeLimiter, updateAccess)
  .delete(requireRoot, stepUp, writeLimiter, revokeAccess);

// route - /api/v1/access/staff/:userId/{suspend,restore}
app.post("/staff/:userId/suspend", requireRoot, stepUp, writeLimiter, setStatus("suspended"));
app.post("/staff/:userId/restore", requireRoot, stepUp, writeLimiter, setStatus("active"));

// route - /api/v1/access/root
// Ownership moves, it is never granted. Requires an explicit confirm token in
// the body so a misrouted click cannot hand the store away.
app.post("/root", requireRoot, stepUp, writeLimiter, transferRoot);

export default app;
