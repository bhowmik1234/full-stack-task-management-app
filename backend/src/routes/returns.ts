import express from "express";
import { requirePermission, verifyUser } from "../middlewares/auth.js";
import {
  allReturns,
  cancelReturn,
  decideReturn,
  getReturn,
  getReturnReasons,
  myReturns,
  receiveReturn,
  refundReturn,
  requestReturn,
} from "../controllers/returns.js";
import { adminLimiter, writeLimiter } from "../middlewares/rateLimit.js";

const app = express.Router();

// The customer's own side. `verifyUser` throughout: every handler scopes its
// query by the uid the guard resolved, so a return id is a filter and never
// authority — the same rule the address book follows.

// route - /api/v1/returns/reasons
// Served rather than hardcoded in the client so the list cannot drift from the
// one `isReturnReason` accepts, which would show a customer an option the
// server refuses.
app.get("/reasons", verifyUser, getReturnReasons);

// route - /api/v1/returns/my
app.get("/my", verifyUser, myReturns);

// route - /api/v1/returns/new
app.post("/new", verifyUser, writeLimiter, requestReturn);

// route - /api/v1/returns/all
// Declared before /:id so the parameterised route below does not swallow it.
app.get("/all", adminLimiter, requirePermission("orders_read"), allReturns);

// route - /api/v1/returns/:id
// Readable by the customer it belongs to *or* by the order desk; the controller
// decides which, because "not yours" and "you are staff" are the same 404-or-403
// question and splitting the route would duplicate the lookup.
app.get("/:id", verifyUser, getReturn);

// route - /api/v1/returns/:id/cancel
app.post("/:id/cancel", verifyUser, writeLimiter, cancelReturn);

// The operator's side. Each transition is its own route so the audit trail
// records which one happened, and so a permission can be narrowed later without
// splitting a handler.
app.post(
  "/:id/decide",
  adminLimiter,
  requirePermission("orders_write"),
  writeLimiter,
  decideReturn
);

app.post(
  "/:id/receive",
  adminLimiter,
  requirePermission("orders_write"),
  writeLimiter,
  receiveReturn
);

app.post(
  "/:id/refund",
  adminLimiter,
  requirePermission("orders_write"),
  writeLimiter,
  refundReturn
);

export default app;
