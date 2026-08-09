import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import { Prisma } from "../generated/prisma/index.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { invalidateCache, restoreStock } from "../utils/features.js";
import { serializeReturn, serializeReturns } from "../utils/serialize.js";
import { staffCan } from "../utils/permissions.js";
import { recordAudit } from "../utils/audit.js";
import { razorpay, toPaise } from "../utils/razorpay.js";
import { LIMITS, optionalString, requireString } from "../utils/validate.js";
import {
  assertOrderReturnable,
  isReturnReason,
  OPEN_RETURN_STATUSES,
  priceReturnLines,
  refundAmountFor,
  RETURN_REASONS,
} from "../utils/returns.js";
import {
  sendReturnDecision,
  sendReturnRefunded,
  sendReturnRequested,
} from "../utils/emails.js";

/**
 * Returns.
 *
 * The state machine is `Requested → Approved → Received → Refunded`, with
 * `Rejected` and `Cancelled` as exits. Each transition is a separate endpoint
 * and each checks the current status rather than trusting the caller to call
 * them in order, which is the same discipline `utils/orderPayment.ts` applies to
 * payment — an operator with two tabs open must not be able to refund twice.
 *
 * Money moves at `Received`, not at `Approved`. Approving is a promise; the
 * refund is a payment, and in a real warehouse they are days apart.
 */

/** Everything a serialized return needs, in one shape both queries share. */
const returnInclude = {
  items: {
    include: {
      orderItem: {
        select: { id: true, name: true, photo: true, variantLabel: true, price: true },
      },
    },
  },
  order: { select: { id: true, total: true, createdAt: true } },
  user: { select: { id: true, name: true } },
} as const;

/** The caller may see this return if it is theirs, or if they staff the desk. */
const mayView = (req: any, ownerId: string) =>
  String(req.query.id) === ownerId || staffCan(req.staff, "orders_read");

/**
 * How many units of each order line are already spoken for.
 *
 * Rejected and Cancelled requests are excluded: neither took any goods, so
 * counting them would permanently reduce what a customer may return because
 * they once asked and were told no.
 */
const returnedCounts = async (
  db: Prisma.TransactionClient | typeof prisma,
  orderId: string
) => {
  const rows = await db.returnItem.findMany({
    where: {
      request: {
        orderId,
        status: { notIn: ["Rejected", "Cancelled"] },
      },
    },
    select: { orderItemId: true, quantity: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.orderItemId, (counts.get(row.orderItemId) ?? 0) + row.quantity);

  return counts;
};

/** The list of reasons the form offers, so the client does not hardcode it. */
export const getReturnReasons = TryCatch(async (_req, res) => {
  return res.status(200).json({ success: true, reasons: RETURN_REASONS });
});

/**
 * The customer opening a return.
 *
 * Everything that decides whether this is allowed — the window, the ownership,
 * how many units are left — is checked here against database rows, never taken
 * from the body. The body supplies only which items and how many.
 */
export const requestReturn = TryCatch(async (req, res, next) => {
  const requesterId = String(req.query.id);
  const orderId = requireString(req.body?.orderId, "orderId", LIMITS.userId);

  const reason = req.body?.reason;
  if (!isReturnReason(reason))
    return next(new ErrorHandler("Choose a reason for the return", 400));

  const note = optionalString(req.body?.note, "note", LIMITS.reviewComment) ?? "";

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      paymentStatus: true,
      deliveredAt: true,
      items: { select: { id: true, price: true, quantity: true } },
    },
  });

  if (!order) return next(new ErrorHandler("Order Not Found", 404));

  // Opening a return is the customer's own act. Unlike cancellation there is no
  // operator stand-in here: an operator who needs to start one has the console's
  // order page and acts with their own audited identity.
  if (order.userId !== requesterId)
    return next(new ErrorHandler("Not allowed to return this order", 403));

  assertOrderReturnable(order);

  const counts = await returnedCounts(prisma, order.id);
  const priced = priceReturnLines(
    req.body?.items,
    order.items.map((i) => ({
      id: i.id,
      price: i.price,
      quantity: i.quantity,
      alreadyReturned: counts.get(i.id) ?? 0,
    }))
  );

  try {
    const created = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        reason,
        note,
        items: { create: priced.lines },
      },
      include: returnInclude,
    });

    invalidateCache({ order: true, admin: true, userId: order.userId, orderId: order.id });

    void sendReturnRequested(created.id);

    return res.status(201).json({ success: true, return: serializeReturn(created) });
  } catch (error: any) {
    // `return_single_open_per_order` fired: another request for this order is
    // already open. Enforced as a partial unique index rather than a read-then-
    // write here precisely because two concurrent submissions both pass a
    // check-first version, and the second one would refund items the first is
    // already refunding.
    if (error?.code === "P2002")
      return next(
        new ErrorHandler(
          "There is already an open return for this order. Please wait for it to be resolved.",
          409
        )
      );
    throw error;
  }
});

/** The customer's own returns, newest first, for the account page. */
export const myReturns = TryCatch(async (req, res) => {
  const rows = await prisma.returnRequest.findMany({
    where: { userId: String(req.query.id) },
    include: returnInclude,
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json({ success: true, returns: serializeReturns(rows) });
});

/**
 * The console's queue.
 *
 * Defaults to the open statuses rather than to everything: the page exists to
 * be worked through, and a list that opens on years of settled requests buries
 * the four that need a decision today.
 */
export const allReturns = TryCatch(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "open";

  const where =
    status === "all"
      ? {}
      : status === "open"
        ? { status: { in: [...OPEN_RETURN_STATUSES] } }
        : { status: status as any };

  const rows = await prisma.returnRequest.findMany({
    where,
    include: returnInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return res.status(200).json({ success: true, returns: serializeReturns(rows) });
});

export const getReturn = TryCatch(async (req, res, next) => {
  const row = await prisma.returnRequest.findUnique({
    where: { id: String(req.params.id) },
    include: returnInclude,
  });

  if (!row) return next(new ErrorHandler("Return Not Found", 404));
  if (!mayView(req, row.userId))
    return next(new ErrorHandler("Not allowed to view this return", 403));

  return res.status(200).json({ success: true, return: serializeReturn(row) });
});

/** The customer withdrawing a request they opened. */
export const cancelReturn = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const row = await prisma.returnRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, orderId: true },
  });

  if (!row) return next(new ErrorHandler("Return Not Found", 404));
  if (row.userId !== String(req.query.id))
    return next(new ErrorHandler("Not allowed to cancel this return", 403));

  // Once the goods are back, withdrawing is not a thing the customer can do —
  // the store is holding items it has to either refund or return to them, and
  // that is a conversation, not a button.
  if (row.status !== "Requested" && row.status !== "Approved")
    return next(
      new ErrorHandler(`A return that is ${row.status.toLowerCase()} cannot be withdrawn`, 409)
    );

  await prisma.returnRequest.update({
    where: { id },
    data: { status: "Cancelled" },
  });

  invalidateCache({ order: true, admin: true, userId: row.userId, orderId: row.orderId });

  return res.status(200).json({ success: true, message: "Return withdrawn" });
});

/** Operator approving or rejecting. */
export const decideReturn = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);
  const approved = req.body?.approved === true || req.body?.approved === "true";
  const note = optionalString(req.body?.note, "note", LIMITS.reviewComment) ?? "";

  const row = await prisma.returnRequest.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true, orderId: true },
  });

  if (!row) return next(new ErrorHandler("Return Not Found", 404));

  // Keyed on the current status, not on the caller: two operators opening the
  // same request get one decision and one 409, rather than two emails telling
  // the customer opposite things.
  if (row.status !== "Requested")
    return next(
      new ErrorHandler(`This return has already been ${row.status.toLowerCase()}`, 409)
    );

  await prisma.returnRequest.update({
    where: { id },
    data: {
      status: approved ? "Approved" : "Rejected",
      decidedAt: new Date(),
      decidedById: req.appUser?.id ?? null,
      decisionNote: note,
    },
  });

  invalidateCache({ order: true, admin: true, userId: row.userId, orderId: row.orderId });

  recordAudit(req, {
    action: approved ? "return.approve" : "return.reject",
    targetId: row.id,
    summary: `${approved ? "Approved" : "Rejected"} return ${row.id} on order ${row.orderId}${
      note ? ` — ${note}` : ""
    }`,
  });

  void sendReturnDecision(row.id, { approved, note });

  return res.status(200).json({
    success: true,
    message: approved ? "Return approved" : "Return rejected",
  });
});

/**
 * The goods arrived. Restocks them and nothing else.
 *
 * Split from the refund on purpose: the parcel turning up and the money going
 * out are separate events that fail separately. If they were one endpoint, a
 * Razorpay outage would leave the operator unable to record that the shirts are
 * on the shelf — and they would restock them by hand, twice.
 *
 * `restocked` is the flag that makes this idempotent, read and written inside
 * the same transaction as the increment, exactly as `Order.stockReserved` is.
 */
export const receiveReturn = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);
  const restock = req.body?.restock !== false && req.body?.restock !== "false";

  const row = await prisma.returnRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      userId: true,
      orderId: true,
      restocked: true,
      items: {
        select: {
          quantity: true,
          orderItem: { select: { productId: true, variantId: true } },
        },
      },
    },
  });

  if (!row) return next(new ErrorHandler("Return Not Found", 404));
  if (row.status !== "Approved")
    return next(
      new ErrorHandler("Only an approved return can be marked as received", 409)
    );

  await prisma.$transaction(async (tx) => {
    // Damaged goods come back but do not go back on the shelf, which is why
    // this is the operator's choice rather than automatic.
    if (restock && !row.restocked) {
      await restoreStock(
        tx,
        row.items.map((i) => ({
          productId: i.orderItem.productId,
          variantId: i.orderItem.variantId,
          quantity: i.quantity,
        }))
      );
    }

    await tx.returnRequest.update({
      where: { id },
      data: { status: "Received", restocked: restock ? true : row.restocked },
    });
  });

  invalidateCache({
    product: true,
    order: true,
    admin: true,
    userId: row.userId,
    orderId: row.orderId,
    productId: row.items.map((i) => i.orderItem.productId),
  });

  recordAudit(req, {
    action: "return.receive",
    targetId: row.id,
    summary: `Received return ${row.id} on order ${row.orderId}${
      restock ? " and restocked it" : " without restocking"
    }`,
  });

  return res.status(200).json({ success: true, message: "Return marked as received" });
});

/**
 * The refund.
 *
 * The amount is computed here from the order's own rows — proportional tax,
 * shipping only on a full return (see `refundAmountFor`) — and an operator may
 * override it downwards for a restocking fee, never upwards past what is left
 * unrefunded on the order.
 *
 * Razorpay is called *before* the row is marked Refunded, for the same reason
 * `cancelOrder` refunds before cancelling: if the call fails the request stays
 * `Received` and can be retried, rather than being recorded as refunded with no
 * money having moved.
 */
export const refundReturn = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const row = await prisma.returnRequest.findUnique({
    where: { id },
    include: {
      items: { select: { quantity: true, orderItemId: true } },
      order: {
        select: {
          id: true,
          subtotal: true,
          tax: true,
          shippingCharges: true,
          discount: true,
          total: true,
          paymentStatus: true,
          paymentMethod: true,
          razorpayPaymentId: true,
          items: { select: { id: true, price: true, quantity: true } },
        },
      },
    },
  });

  if (!row) return next(new ErrorHandler("Return Not Found", 404));
  if (row.status !== "Received")
    return next(
      new ErrorHandler("Mark the return as received before refunding it", 409)
    );

  const order = row.order;

  const requestedIds = new Set(row.items.map((i) => i.orderItemId));
  const byId = new Map(order.items.map((i) => [i.id, i]));

  let itemsValue = new Prisma.Decimal(0);
  let unitsReturned = 0;
  for (const line of row.items) {
    const orderLine = byId.get(line.orderItemId);
    if (!orderLine) continue;
    itemsValue = itemsValue.add(orderLine.price.mul(line.quantity));
    unitsReturned += line.quantity;
  }

  const unitsOrdered = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const fullReturn = unitsReturned >= unitsOrdered && requestedIds.size === order.items.length;

  let amount = refundAmountFor({
    itemsValue,
    subtotal: order.subtotal,
    tax: order.tax,
    shippingCharges: order.shippingCharges,
    discount: order.discount,
    fullReturn,
  });

  // An override is a restocking fee or a goodwill adjustment, so it may only
  // reduce. Allowing it upwards would make the endpoint a way to pay out an
  // arbitrary amount against an order, which is not a thing an orders_write
  // permission should carry.
  if (req.body?.amount !== undefined && req.body?.amount !== null && req.body?.amount !== "") {
    const requested = new Prisma.Decimal(Number(req.body.amount));
    if (!Number.isFinite(Number(req.body.amount)) || requested.lt(0))
      return next(new ErrorHandler("Invalid refund amount", 400));
    if (requested.gt(amount))
      return next(
        new ErrorHandler(`This return is worth at most ₹${amount.toString()}`, 400)
      );
    amount = requested;
  }

  // What every earlier return on this order has already paid back. Without this
  // three partial returns could each be computed correctly and still refund
  // more than the order was worth.
  const previous = await prisma.returnRequest.aggregate({
    where: { orderId: order.id, status: "Refunded" },
    _sum: { refundAmount: true },
  });
  const alreadyRefunded = previous._sum.refundAmount ?? new Prisma.Decimal(0);
  const headroom = order.total.sub(alreadyRefunded);

  if (amount.gt(headroom))
    return next(
      new ErrorHandler(
        `Only ₹${headroom.toString()} of this order is left to refund`,
        409
      )
    );

  let razorpayRefundId: string | null = null;

  if (order.paymentStatus === "Paid" && order.razorpayPaymentId) {
    try {
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: toPaise(Number(amount)),
        speed: "normal",
      });
      razorpayRefundId = refund.id;
    } catch (error) {
      console.error(`[return] refund failed for ${row.id}`, error);
      return next(
        new ErrorHandler("Could not refund this payment. Please try again.", 502)
      );
    }
  } else if (order.paymentMethod === "COD") {
    // Nothing to reverse: the money came as cash and goes back the same way,
    // outside this system. Recorded rather than refused so the return can be
    // closed and the amount owed is written down somewhere.
    console.log(`[return] ${row.id} on COD order ${order.id} needs a manual payout of ${amount}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({
      where: { id },
      data: { status: "Refunded", refundAmount: amount, razorpayRefundId },
    });

    // The order's own payment status only becomes Refunded when the whole thing
    // came back. A partial return leaves it Paid, because it was — and marking
    // it Refunded would make every revenue query in stats.ts drop the part the
    // customer kept.
    if (fullReturn && order.paymentStatus === "Paid")
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "Refunded" },
      });
  });

  invalidateCache({ order: true, admin: true, userId: row.userId, orderId: order.id });

  recordAudit(req, {
    action: "return.refund",
    targetId: row.id,
    summary: `Refunded ₹${amount.toString()} for return ${row.id} on order ${order.id}${
      razorpayRefundId ? ` (${razorpayRefundId})` : " (manual payout)"
    }`,
  });

  void sendReturnRefunded(row.id, Number(amount));

  return res.status(200).json({
    success: true,
    message: "Refund issued",
    amount: Number(amount),
  });
});
