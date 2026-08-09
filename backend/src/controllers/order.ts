import { myCache } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import { CheckoutRequestBody } from "../types/types.js";
import {
  calculateOrderAmounts,
  invalidateCache,
  reduceStock,
  restoreStock,
} from "../utils/features.js";
import { serializeOrder, serializeOrders } from "../utils/serialize.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { LIMITS, optionalString, requireHttpUrl, requireString } from "../utils/validate.js";
import { codAllowed, pricingConfig } from "../utils/pricing.js";
import { staffCan } from "../utils/permissions.js";
import {
  assertRazorpayConfigured,
  razorpay,
  razorpayKeyId,
  toPaise,
} from "../utils/razorpay.js";
import { releaseOrder } from "../utils/orderPayment.js";
import { sendOrderPlacedByCod, sendOrderStatusUpdate } from "../utils/emails.js";
import { recordAudit } from "../utils/audit.js";
import { PAYMENT_WINDOW_MINUTES } from "../utils/expireOrders.js";
import { Request } from "express";

// every read that gets serialized back to the client needs the items and the
// user's name, matching what .populate("user", "name") used to return
const orderInclude = {
  items: true,
  user: { select: { id: true, name: true } },
} as const;

/**
 * The single-order view also carries the order's returns.
 *
 * Only this endpoint: the list views render a row per order and have no use for
 * them, and joining two more tables across every order a customer has ever
 * placed to render a status chip would be a real cost for no gain. The customer
 * needs them here because this is the page where a return is opened, and the
 * form has to know what is already spoken for.
 */
const singleOrderInclude = {
  ...orderInclude,
  returns: {
    include: {
      items: {
        include: {
          orderItem: {
            select: { id: true, name: true, photo: true, variantLabel: true, price: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  },
} as const;

/**
 * Creates a Razorpay order for an existing local order and stores its id.
 *
 * Split out because two endpoints need it: checkout, and the pay page when a
 * customer comes back to an order whose Razorpay order was never created (the
 * external call failed after the local commit).
 */
const attachRazorpayOrder = async (order: { id: string; total: unknown }) => {
  const rzpOrder = await razorpay.orders.create({
    amount: toPaise(Number(order.total)),
    currency: "INR",
    // our own order id, so a Razorpay dashboard row can be traced back here
    receipt: order.id,
    notes: { orderId: order.id },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { razorpayOrderId: rzpOrder.id },
  });

  return rzpOrder.id;
};

/**
 * Step 1 of checkout: write the order, reserve its stock, open a Razorpay
 * order. Replaces the old `newOrder` + `POST /payement/create` pair.
 *
 * The ordering is the whole point. Previously the customer was charged first
 * and the browser created the order afterwards, so a closed tab or a failed
 * request meant money taken with no order, and stock was only checked — never
 * held — until after the charge. Now the order exists and owns its stock
 * before any payment UI is shown, and `POST /payement/{verify,webhook}` only
 * ever promote a row that is already there.
 */
export const createCheckout = TryCatch(
  async (req: Request<{}, {}, CheckoutRequestBody>, res, next) => {
    const { id: requesterId } = req.query;
    const { shippingInfo, orderItems, couponCode } = req.body;
    const user = String(requesterId);

    // Anything that is not literally "COD" is prepaid, so an older client that
    // sends nothing — or a tampered value — lands on the path that takes money
    // up front rather than the one that ships goods on trust.
    const paymentMethod = req.body.paymentMethod === "COD" ? "COD" : "Razorpay";
    const config = pricingConfig();

    if (paymentMethod === "COD" && !config.cod.enabled)
      return next(new ErrorHandler("Cash on delivery is not available", 400));

    // Only the prepaid path needs Razorpay, and demanding it for COD would make
    // an unconfigured key block the one flow that does not use it.
    if (paymentMethod === "Razorpay") assertRazorpayConfigured();

    if (!shippingInfo || !orderItems)
      return next(new ErrorHandler("Please Enter All Fields", 400));

    // bounded so a request can't write megabytes into the address columns
    const shipping = {
      address: requireString(shippingInfo.address, "address", LIMITS.address),
      city: requireString(shippingInfo.city, "city", LIMITS.city),
      state: requireString(shippingInfo.state, "state", LIMITS.state),
      country: requireString(shippingInfo.country, "country", LIMITS.country),
      pinCode: requireString(shippingInfo.pinCode, "pinCode", LIMITS.pinCode),
    };

    // A COD order has no payment window, so it gets no expiry — and must not,
    // or the sweep in utils/expireOrders.ts would cancel it half an hour after
    // it was placed. `cod_order_has_no_payment_expiry` enforces that in the
    // database too, because "silently cancels good orders" is the last thing
    // that should depend on one branch in one controller.
    const expiresAt =
      paymentMethod === "COD"
        ? null
        : new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000);

    let order;
    try {
      // Pricing, stock reservation and order creation commit together or not
      // at all.
      order = await prisma.$transaction(async (tx) => {
        // subtotal/tax/shippingCharges/discount/total/prices are re-derived
        // from the DB — never trust the client-supplied numbers for these
        const computed = await calculateOrderAmounts(orderItems, couponCode, user, tx, {
          state: shipping.state,
          paymentMethod,
        });

        if (computed.total <= 0)
          throw new ErrorHandler("Invalid order amount", 400);

        // Re-checked here and not only in the UI: the ceiling exists so the
        // store is not shipping an expensive parcel on a promise, and a limit
        // that only the browser enforces is not a limit.
        if (paymentMethod === "COD" && !codAllowed(computed.total, config))
          throw new ErrorHandler(
            `Cash on delivery is not available for orders above ₹${config.cod.maxOrderValue}`,
            400
          );

        await reduceStock(tx, computed.orderItems);

        return tx.order.create({
          data: {
            userId: user,
            ...shipping,
            subtotal: computed.subtotal,
            tax: computed.tax,
            shippingCharges: computed.shippingCharges,
            discount: computed.discount,
            total: computed.total,
            couponCode: couponCode || null,
            paymentMethod,
            // COD skips PendingPayment entirely. That state exists to hold
            // stock while a customer is away at a payment page; a COD order has
            // nowhere to go, so it is a real order the moment it is placed and
            // starts where a paid one lands.
            status: paymentMethod === "COD" ? "Processing" : "PendingPayment",
            paymentStatus: "Pending",
            placedAt: paymentMethod === "COD" ? new Date() : null,
            stockReserved: true,
            paymentExpiresAt: expiresAt,
            items: {
              create: computed.orderItems.map((i) => ({
                productId: i.productId,
                variantId: i.variantId,
                name: i.name,
                photo: i.photo,
                variantLabel: i.variantLabel,
                price: i.price,
                quantity: i.quantity,
              })),
            },
          },
          include: orderInclude,
        });
      });
    } catch (error) {
      // calculateOrderAmounts/reduceStock throw ErrorHandler with their own
      // status. Anything else is a database failure and must not have its
      // message forwarded to the client.
      if (error instanceof ErrorHandler) return next(error);
      return next(error as Error);
    }

    // COD is done: the order exists, its stock is held and there is nothing to
    // charge. The receipt goes out here because for a prepaid order it is
    // `markOrderPaid` that sends one, and that never runs for COD — without
    // this the customer would get no confirmation of an order they placed.
    if (paymentMethod === "COD") {
      invalidateCache({
        product: true,
        order: true,
        admin: true,
        userId: user,
        productId: order.items.map((i) => i.productId),
      });

      void sendOrderPlacedByCod(order.id);

      return res.status(201).json({
        success: true,
        orderId: order.id,
        paymentMethod: "COD",
        amount: Number(order.total),
        currency: "INR",
      });
    }

    // Stock is held from here on, so anything that fails below must give it
    // back rather than leave a dangling reservation.
    let razorpayOrderId: string;
    try {
      razorpayOrderId = await attachRazorpayOrder(order);
    } catch (error) {
      console.error(`[checkout] razorpay order failed for ${order.id}`, error);
      await releaseOrder(order.id, "Could not reach the payment provider");
      return next(
        new ErrorHandler("Could not start payment. Please try again.", 502)
      );
    }

    invalidateCache({
      product: true,
      order: true,
      admin: true,
      userId: user,
      productId: order.items.map((i) => i.productId),
    });

    return res.status(201).json({
      success: true,
      orderId: order.id,
      paymentMethod: "Razorpay",
      razorpayOrderId,
      keyId: razorpayKeyId,
      amount: toPaise(Number(order.total)),
      currency: "INR",
      expiresAt: expiresAt!.toISOString(),
    });
  }
);

/**
 * What the pay page needs to open the Razorpay modal, fetched by order id.
 *
 * This is what makes a refresh on /pay survive: the old flow carried the
 * Stripe clientSecret in router state, so reloading the page lost it and sent
 * the customer back to re-enter their address, creating a second payment
 * object every time. Here the order is the durable handle and its Razorpay
 * order is re-created only if it is genuinely missing.
 */
export const getOrderPayment = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);
  const requesterId = String(req.query.id);

  assertRazorpayConfigured();

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      total: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      razorpayOrderId: true,
      paymentExpiresAt: true,
      user: { select: { name: true, email: true, phone: true } },
    },
  });

  if (!order) return next(new ErrorHandler("Order Not Found", 404));

  // A COD order has nothing to pay online. Without this the call below would
  // helpfully *create* a Razorpay order for it, which is how a customer ends up
  // able to pay for a parcel they are also going to be asked to pay the courier
  // for.
  if (order.paymentMethod === "COD")
    return next(
      new ErrorHandler("This order is paid on delivery", 409)
    );

  // Paying is not something an admin does on someone's behalf, so this is a
  // strict owner check rather than the selfOrAdmin used for reads.
  if (order.userId !== requesterId)
    return next(new ErrorHandler("Not allowed to pay for this order", 403));

  if (order.paymentStatus === "Paid")
    return next(new ErrorHandler("This order is already paid", 409));

  if (order.status === "Cancelled")
    return next(
      new ErrorHandler("This order was cancelled and can no longer be paid", 409)
    );

  if (order.paymentExpiresAt && order.paymentExpiresAt < new Date())
    return next(
      new ErrorHandler("This checkout has expired. Please order again.", 409)
    );

  const razorpayOrderId =
    order.razorpayOrderId ?? (await attachRazorpayOrder(order));

  return res.status(200).json({
    success: true,
    orderId: order.id,
    razorpayOrderId,
    keyId: razorpayKeyId,
    amount: toPaise(Number(order.total)),
    currency: "INR",
    expiresAt: order.paymentExpiresAt?.toISOString() ?? null,
    // prefill, so the customer doesn't retype what we already know. A phone
    // sign-in has no email and vice versa; both are nullable.
    prefill: {
      name: order.user.name,
      email: order.user.email ?? "",
      contact: order.user.phone ?? "",
    },
  });
});

/**
 * Customer- or admin-initiated cancellation.
 *
 * Allowed only before the parcel moves. A paid order is refunded through
 * Razorpay first — cancelling without refunding would leave the customer's
 * money with us and the stock back on the shelf.
 */
export const cancelOrder = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);
  const requesterId = String(req.query.id);

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      paymentStatus: true,
      razorpayPaymentId: true,
      total: true,
    },
  });

  if (!order) return next(new ErrorHandler("Order Not Found", 404));

  // Cancelling is a fulfilment action, so it is the fulfilment permission
  // that stands in for the customer — not "is an admin". An analyst with
  // read-only access cannot cancel someone else's order.
  const onBehalf = staffCan(req.staff, "orders_write");
  if (order.userId !== requesterId && !onBehalf)
    return next(new ErrorHandler("Not allowed to cancel this order", 403));

  if (order.status === "Cancelled")
    return next(new ErrorHandler("This order is already cancelled", 409));

  if (order.status === "Shipped" || order.status === "Delivered")
    return next(
      new ErrorHandler(
        "This order has already shipped and must go through returns",
        409
      )
    );

  // Refund before cancelling: if the refund call fails the order stays as it
  // was and the customer can retry, rather than being left cancelled and out
  // of pocket.
  if (order.paymentStatus === "Paid" && order.razorpayPaymentId) {
    try {
      await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: toPaise(Number(order.total)),
        speed: "normal",
      });
    } catch (error) {
      console.error(`[cancel] refund failed for order ${order.id}`, error);
      return next(
        new ErrorHandler(
          "Could not refund this payment. Please contact support.",
          502
        )
      );
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: "Refunded" },
    });
  }

  await releaseOrder(
    order.id,
    onBehalf && order.userId !== requesterId
      ? "Cancelled by admin"
      : "Cancelled by customer"
  );

  return res.status(200).json({
    success: true,
    message:
      order.paymentStatus === "Paid"
        ? "Order cancelled and refund initiated"
        : "Order cancelled",
  });
});


  export const myOrders = TryCatch(async (req, res, next) => {
    const { id: user } = req.query;

    const key = `my-orders-${user}`;

    let orders = [];

    if (myCache.has(key)) orders = JSON.parse(myCache.get(key) as string);
    else {
      const rows = await prisma.order.findMany({
        where: { userId: String(user) },
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      });
      orders = serializeOrders(rows);
      myCache.set(key, JSON.stringify(orders));
    }

    return res.status(200).json({
      success: true,
      orders,
    });
  });


  export const allOrders = TryCatch(async (req, res, next) => {
    const key = `all-orders`;

    let orders = [];

    if (myCache.has(key)) orders = JSON.parse(myCache.get(key) as string);
    else {
      const rows = await prisma.order.findMany({
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      });
      orders = serializeOrders(rows);
      myCache.set(key, JSON.stringify(orders));
    }
    return res.status(200).json({
      success: true,
      orders,
    });
  });

  export const getSingleOrder = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const { id: requesterId } = req.query;
    const key = `order-${id}`;

    let order;

    if (myCache.has(key)) order = JSON.parse(myCache.get(key) as string);
    else {
      const row = await prisma.order.findUnique({
        where: { id },
        include: singleOrderInclude,
      });

      if (!row) return next(new ErrorHandler("Order Not Found", 404));

      order = serializeOrder(row);
      myCache.set(key, JSON.stringify(order));
    }

    // only the order's own user, or an admin, may view it. verifyUser already
    // loaded and validated the caller onto req.appUser.
    const orderUserId = order.user?._id ?? order.user;
    if (
      String(orderUserId) !== String(requesterId) &&
      !staffCan(req.staff, "orders_read")
    )
      return next(new ErrorHandler("Not allowed to view this order", 403));

    return res.status(200).json({
      success: true,
      order,
    });
  });

  export const processOrder = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);

    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) return next(new ErrorHandler("Order Not Found", 404));

    // Fulfilment starts at Processing. An unpaid or cancelled order has no
    // business being shipped, and the old unconditional fallthrough would
    // happily have marked either of them Delivered.
    if (order.status === "PendingPayment")
      return next(
        new ErrorHandler("This order has not been paid for yet", 409)
      );

    if (order.status === "Cancelled")
      return next(new ErrorHandler("This order was cancelled", 409));

    if (order.status === "Delivered")
      return next(new ErrorHandler("This order is already delivered", 409));

    const nextStatus = order.status === "Processing" ? "Shipped" : "Delivered";

    // Tracking details are optional — plenty of small stores hand parcels to a
    // local courier with no number to give — but when they are supplied they
    // are captured on the transition that creates them, so the shipping email
    // below can carry them. There is no separate "add tracking" endpoint on
    // purpose: a second screen to remember is a screen that gets skipped.
    const carrier = optionalString(req.body?.carrier, "carrier", LIMITS.name);
    const trackingNumber = optionalString(
      req.body?.trackingNumber,
      "trackingNumber",
      LIMITS.paymentRef
    );
    const trackingUrl =
      req.body?.trackingUrl === undefined ||
      req.body?.trackingUrl === null ||
      req.body?.trackingUrl === ""
        ? undefined
        : // Rendered as an href in the email and on the order page, so the same
          // rule as a profile photo applies: http(s) only, never `javascript:`.
          requireHttpUrl(req.body.trackingUrl, "trackingUrl");

    await prisma.order.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(nextStatus === "Shipped"
          ? {
              shippedAt: new Date(),
              ...(carrier ? { carrier } : {}),
              ...(trackingNumber ? { trackingNumber } : {}),
              ...(trackingUrl ? { trackingUrl } : {}),
            }
          : {}),
        // Stamped here because `status` records that a parcel arrived but not
        // when, and the review request is scheduled off "a few days after
        // delivery". Set only on the transition, so it keeps the time of the
        // first Delivered rather than of any later touch.
        ...(nextStatus === "Delivered"
          ? {
              deliveredAt: new Date(),
              // Delivery *is* the payment event for a COD order: the courier
              // has the cash. A prepaid order's paymentStatus was settled long
              // ago by the webhook and must not be touched here — hence the
              // guard on both method and current status rather than a blanket
              // write.
              ...(order.paymentMethod === "COD" && order.paymentStatus === "Pending"
                ? { paymentStatus: "Paid" as const, placedAt: order.placedAt ?? new Date() }
                : {}),
            }
          : {}),
      },
    });

    invalidateCache({
      product: false,
      order: true,
      admin: true,
      userId: order.userId,
      orderId: String(order.id),
    });

    recordAudit(req, {
      action: "order.process",
      targetId: order.id,
      summary: `Advanced order ${order.id} from ${order.status} to ${nextStatus}`,
    });

    // The status guards above make each transition happen once, so the notice
    // does too — an operator clicking twice gets a 409 on the second click
    // rather than a second email.
    void sendOrderStatusUpdate(order.id, nextStatus);

    return res.status(200).json({
      success: true,
      message: "Order Processed Successfully",
    });
  });

  export const deleteOrder = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: { select: { productId: true, variantId: true, quantity: true } } },
    });
    if (!order) return next(new ErrorHandler("Order Not Found", 404));

    // Deleting used to drop the row and leave its stock debited forever — the
    // units simply left inventory. Restore and delete in one transaction so a
    // failure can't do one without the other.
    await prisma.$transaction(async (tx) => {
      if (order.stockReserved) await restoreStock(tx, order.items);
      // OrderItem rows go with it via onDelete: Cascade
      await tx.order.delete({ where: { id } });
    });

    invalidateCache({
      product: true,
      order: true,
      admin: true,
      userId: order.userId,
      orderId: String(order.id),
      productId: order.items.map((i) => i.productId),
    });

    recordAudit(req, {
      action: "order.delete",
      targetId: order.id,
      summary: `Deleted order ${order.id} (₹${order.total}, ${order.status})${
        order.stockReserved ? " and returned its stock" : ""
      }`,
    });

    return res.status(200).json({
      success: true,
      message: "Order Deleted Successfully",
    });
  });
