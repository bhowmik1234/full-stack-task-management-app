import express from "express";
import { requirePermission, verifyUser } from "../middlewares/auth.js";
import {
  allCoupons,
  applyDiscount,
  deleteCoupon,
  getCoupon,
  newCoupon,
  razorpayWebhook,
  updateCoupon,
  verifyPayment,
} from "../controllers/payement.js";

import { adminLimiter, sensitiveLimiter, writeLimiter } from "../middlewares/rateLimit.js";

const app = express.Router();

// route - /api/v1/payement/webhook
// Razorpay's own callback, and the authoritative one: it arrives whether or
// not the customer's browser did. Deliberately unauthenticated — Razorpay has
// no user id to send — and instead verified by HMAC over the raw body, which
// app.ts arranges by mounting express.raw() on this path ahead of the JSON
// parser. No rate limit: throttling it would make Razorpay retry.
app.post("/webhook", razorpayWebhook);

// route - /api/v1/payement/verify
// The browser's report of a successful payment. Signature-checked and
// ownership-checked, but only a fast path — the webhook is what guarantees the
// order is promoted.
app.post("/verify", verifyUser, sensitiveLimiter, verifyPayment);

// route - /api/v1/payement/discount
// was unauthenticated: an open oracle for guessing coupon codes. Now requires
// a known user and is tightly rate limited.
app.get("/discount", verifyUser, sensitiveLimiter, applyDiscount);

// route - /api/v1/payement/coupon/new
app.post("/coupon/new", adminLimiter, requirePermission("coupons_write"), writeLimiter, newCoupon);

// route - /api/v1/payement/coupon/all
app.get("/coupon/all", adminLimiter, requirePermission("coupons_read"), allCoupons);

// route - /api/v1/payement/coupon/:id
app
  .route("/coupon/:id")
  .get(adminLimiter, requirePermission("coupons_read"), getCoupon)
  .put(adminLimiter, requirePermission("coupons_write"), writeLimiter, updateCoupon)
  .delete(adminLimiter, requirePermission("coupons_write"), writeLimiter, deleteCoupon);

export default app;
