import express from "express";
import { requirePermission, verifyUser } from "../middlewares/auth.js";
import {
  allOrders,
  cancelOrder,
  createCheckout,
  deleteOrder,
  getOrderPayment,
  getSingleOrder,
  myOrders,
  processOrder,
} from "../controllers/order.js";

import { adminLimiter, sensitiveLimiter, writeLimiter } from "../middlewares/rateLimit.js";

const app = express.Router();

// route - /api/v1/order/checkout
// Opens a checkout: writes the order, reserves its stock and returns what the
// browser needs to open Razorpay. Replaces both the old POST /order/new and
// POST /payement/create. Rate limited like a payment endpoint because each
// call creates a real order at Razorpay.
app.post("/checkout", verifyUser, sensitiveLimiter, createCheckout);

// route - /api/v1/order/my
app.get("/my", verifyUser, myOrders);

// route - /api/v1/order/all
app.get("/all", adminLimiter, requirePermission("orders_read"), allOrders);

// route - /api/v1/order/:id/payment
// Re-opens the Razorpay handle for an unpaid order. Declared before /:id so
// the parameterised route below doesn't swallow it.
app.get("/:id/payment", verifyUser, getOrderPayment);

// route - /api/v1/order/:id/cancel
app.post("/:id/cancel", verifyUser, writeLimiter, cancelOrder);

app
  .route("/:id")
  .get(verifyUser, getSingleOrder)
  .put(adminLimiter, requirePermission("orders_write"), writeLimiter, processOrder)
  .delete(adminLimiter, requirePermission("orders_write"), writeLimiter, deleteOrder);

export default app;
