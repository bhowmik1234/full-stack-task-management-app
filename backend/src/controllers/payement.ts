import { Request, Response } from "express";
import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { serializeCoupon, serializeCoupons } from "../utils/serialize.js";
import { markOrderPaid } from "../utils/orderPayment.js";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
  webhookConfigured,
} from "../utils/razorpay.js";
import { LIMITS, optionalString, requireAmount, requireString } from "../utils/validate.js";
import {
  assertCouponRedeemable,
  couponConditionsFromBody,
  describeConditions,
  redemptionCountsFor,
} from "../utils/coupons.js";
import { Prisma } from "../generated/prisma/index.js";
import { recordAudit } from "../utils/audit.js";

/**
 * Fast path: the browser hands back what Razorpay Checkout gave it, we check
 * the signature and mark the order paid immediately so the customer sees a
 * confirmation instead of a spinner.
 *
 * This is a convenience, not the source of truth. If the customer closes the
 * tab between paying and this call, the webhook does exactly the same thing a
 * few seconds later — `markOrderPaid` is idempotent and keyed on the Razorpay
 * order id, so whichever arrives first wins and the other is a no-op.
 */
export const verifyPayment = TryCatch(async (req, res, next) => {
  const razorpayOrderId = requireString(
    req.body.razorpay_order_id,
    "razorpay_order_id",
    LIMITS.paymentRef
  );
  const razorpayPaymentId = requireString(
    req.body.razorpay_payment_id,
    "razorpay_payment_id",
    LIMITS.paymentRef
  );
  const signature = requireString(
    req.body.razorpay_signature,
    "razorpay_signature",
    LIMITS.signature
  );

  if (
    !verifyCheckoutSignature({ razorpayOrderId, razorpayPaymentId, signature })
  )
    return next(new ErrorHandler("Payment verification failed", 400));

  // The signature proves Razorpay produced this pair; it does not prove the
  // caller owns the order. Check that separately before promoting anything.
  const owner = await prisma.order.findUnique({
    where: { razorpayOrderId },
    select: { userId: true },
  });

  if (!owner) return next(new ErrorHandler("Order Not Found", 404));
  if (owner.userId !== String(req.query.id))
    return next(new ErrorHandler("Not allowed to pay for this order", 403));

  const { outcome, orderId } = await markOrderPaid({
    razorpayOrderId,
    razorpayPaymentId,
  });

  if (outcome === "not-found")
    return next(new ErrorHandler("Order Not Found", 404));

  if (outcome === "conflict")
    return next(
      new ErrorHandler("This payment is already recorded elsewhere", 409)
    );

  return res.status(200).json({
    success: true,
    orderId,
    message: "Payment successful",
  });
});

/**
 * The authoritative payment path.
 *
 * Razorpay calls this whether or not the customer's browser survived the
 * payment, which is the entire reason the order is created before the payment
 * rather than after it. It must:
 *
 *  - verify against the *raw* body (app.ts mounts express.raw() here ahead of
 *    express.json(); re-serializing the parsed JSON changes the bytes and the
 *    digest no longer matches)
 *  - be idempotent, because Razorpay retries a delivery until it gets a 2xx
 *  - answer 2xx for anything it has handled or deliberately ignored, so a
 *    retry storm isn't triggered by an event type we don't care about
 *
 * Not wrapped in TryCatch: a thrown error here would reach errorMiddleware and
 * return 500, which makes Razorpay retry. That is right for a transient
 * failure, so the throw is left to propagate — but the signature check must
 * fail closed with 400 first.
 */
export const razorpayWebhook = async (req: Request, res: Response) => {
  if (!webhookConfigured) {
    console.error("[webhook] RAZORPAY_WEBHOOK_SECRET is not set; rejecting");
    return res.status(503).json({ success: false });
  }

  const signature = req.get("x-razorpay-signature") || "";
  const rawBody = req.body as Buffer;

  if (!Buffer.isBuffer(rawBody) || !verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhook] rejected a delivery with a bad signature");
    return res.status(400).json({ success: false });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false });
  }

  const payment = event?.payload?.payment?.entity;

  switch (event?.event) {
    // Both mean the money is ours. `order.paid` carries the payment entity too,
    // and markOrderPaid dedupes, so handling both is safe and covers the case
    // where only one is enabled in the dashboard.
    case "payment.captured":
    case "order.paid": {
      if (!payment?.order_id || !payment?.id) break;
      await markOrderPaid({
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        amountPaise: payment.amount,
      });
      break;
    }

    // A failed attempt is not a cancellation: Razorpay lets the customer retry
    // against the same order, and the stock stays reserved until the expiry
    // sweep reclaims it. Recording anything here would only race that retry.
    case "payment.failed": {
      console.warn(
        `[webhook] payment failed for razorpay order ${payment?.order_id}`
      );
      break;
    }

    default:
      break;
  }

  // 200 for handled and ignored alike — anything else makes Razorpay redeliver.
  return res.status(200).json({ success: true });
};

export const newCoupon = TryCatch(async (req, res, next) => {
  const code = requireString(req.body.code, "code", LIMITS.couponCode);
  const amount = requireAmount(req.body.amount, "amount");
  const conditions = couponConditionsFromBody(req.body);

  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing)
    return next(new ErrorHandler("Coupon code already exists", 400));

  const coupon = await prisma.coupon.create({ data: { code, amount, ...conditions } });

  recordAudit(req, {
    action: "coupon.create",
    targetId: coupon.id,
    summary: `Created coupon ${code} — ₹${amount} off${describeConditions(coupon)}`,
  });

  return res.status(201).json({
    success: true,
    message: `Coupon ${code} Created Successfully`,
  });
});

/**
 * The cart's coupon preview.
 *
 * Advisory only, and deliberately so. `subtotal` arrives from the browser, so a
 * customer could claim any cart size they like and get an encouraging answer
 * here — which buys them nothing, because `calculateOrderAmounts` re-runs the
 * identical check at checkout against a subtotal it derives from the product
 * rows itself. This endpoint exists to tell someone *before* the payment screen
 * that their code is expired or their cart is too small; it is not a gate.
 *
 * The subtotal is optional: an older client that omits it still gets a valid
 * answer for every condition except the minimum-order one.
 */
export const applyDiscount = TryCatch(async (req, res, next) => {
  const code = requireString(req.query.coupon, "coupon", LIMITS.couponCode);
  const subtotal =
    req.query.subtotal != null
      ? new Prisma.Decimal(requireAmount(req.query.subtotal, "subtotal"))
      : null;

  // The guard resolved this; the query param is not trusted for identity.
  const userId = req.appUser!.id;

  const coupon = await assertCouponRedeemable(prisma, code, userId, subtotal);

  return res.status(200).json({
    success: true,
    discount: Number(coupon.amount),
  });
});

export const allCoupons = TryCatch(async (req, res, next) => {
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });

  // "47 of 100 used" is the number an operator running a campaign actually
  // wants, and without it the redemption cap is a setting whose effect is
  // invisible until the day the code stops working.
  const redeemed = await redemptionCountsFor(
    prisma,
    coupons.map((c) => c.code)
  );

  return res.status(200).json({
    success: true,
    coupons: serializeCoupons(coupons, redeemed),
  });
});

export const getCoupon = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const coupon = await prisma.coupon.findUnique({ where: { id } });

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  // Counted here too, so `redeemed` is present on every coupon this API
  // returns rather than only on the list — a field that exists on one route
  // and not another is the kind of shape difference a client discovers at
  // runtime.
  const redeemed = await redemptionCountsFor(prisma, [coupon.code]);

  return res.status(200).json({
    success: true,
    coupon: serializeCoupon(coupon, redeemed.get(coupon.code) ?? 0),
  });
});

export const updateCoupon = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const coupon = await prisma.coupon.findUnique({ where: { id } });

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  const code = optionalString(req.body.code, "code", LIMITS.couponCode);
  const amount =
    req.body.amount != null && req.body.amount !== ""
      ? requireAmount(req.body.amount, "amount")
      : undefined;

  // A rename must not collide with another row; the unique index would throw a
  // Prisma error that errorMiddleware correctly refuses to echo, leaving the
  // operator with a bare 500 instead of the reason.
  if (code && code !== coupon.code) {
    const clash = await prisma.coupon.findUnique({ where: { code } });
    if (clash) return next(new ErrorHandler("Coupon code already exists", 400));
  }

  const updated = await prisma.coupon.update({
    where: { id },
    data: {
      ...(code ? { code } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...couponConditionsFromBody(req.body),
    },
  });

  recordAudit(req, {
    action: "coupon.update",
    targetId: updated.id,
    summary: `Updated coupon ${updated.code} — ₹${Number(updated.amount)} off${describeConditions(updated)}`,
  });

  return res.status(200).json({
    success: true,
    message: `Coupon ${updated.code} Updated Successfully`,
  });
});

export const deleteCoupon = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const coupon = await prisma.coupon.findUnique({ where: { id } });

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  await prisma.coupon.delete({ where: { id } });

  recordAudit(req, {
    action: "coupon.delete",
    targetId: id,
    summary: `Deleted coupon ${coupon.code} (₹${Number(coupon.amount)} off)`,
  });

  return res.status(200).json({
    success: true,
    message: `Coupon ${coupon.code} Deleted Successfully`,
  });
});
