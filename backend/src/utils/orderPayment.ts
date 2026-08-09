import { prisma } from "./db.js";
import { invalidateCache, restoreStock } from "./features.js";
import { fromPaise } from "./razorpay.js";
import { sendOrderCancelled, sendOrderConfirmation } from "./emails.js";

/**
 * The state transitions an order's payment can make, in one place.
 *
 * Three callers reach these: the checkout-handler verify endpoint (fast path,
 * so the customer sees a result immediately), the Razorpay webhook (the
 * authority — it arrives whether or not the browser is still open), and the
 * expiry sweep. All three can fire for the same order, in any order, more than
 * once; every function here is therefore idempotent and decides what to do from
 * the row's current state rather than from who called it.
 */

export type PaymentOutcome =
  | "paid"
  /** Redelivery, or the webhook racing the browser callback. */
  | "already-paid"
  | "not-found"
  /** The capture is already recorded against a different order. */
  | "conflict";

/**
 * Promotes a PendingPayment order to Processing once money has actually landed.
 *
 * Keyed on the Razorpay order id rather than ours, so the webhook — which only
 * knows Razorpay's identifiers — and the browser callback converge on the same
 * row.
 */
export const markOrderPaid = async ({
  razorpayOrderId,
  razorpayPaymentId,
  amountPaise,
}: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise?: number;
}): Promise<{ outcome: PaymentOutcome; orderId?: string }> => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { razorpayOrderId },
        select: { id: true, userId: true, total: true, paymentStatus: true },
      });

      if (!order) return { outcome: "not-found" as const };

      if (order.paymentStatus === "Paid" || order.paymentStatus === "Refunded")
        return { outcome: "already-paid" as const, orderId: order.id };

      const charged =
        amountPaise != null ? fromPaise(amountPaise) : Number(order.total);

      // We create the Razorpay order with this exact amount, so a mismatch
      // means something is wrong upstream and needs a human. It is not the
      // customer's problem though — their money has moved — so the order is
      // still fulfilled and the discrepancy is logged for reconciliation
      // rather than left stuck in PendingPayment.
      if (Math.abs(charged - Number(order.total)) > 0.01)
        console.error(
          `[payment] amount mismatch on order ${order.id}: charged ${charged}, expected ${Number(order.total)}`
        );

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "Paid",
          razorpayPaymentId,
          amountCharged: charged,
          placedAt: new Date(),
          status: "Processing",
          // it is paid; the expiry sweep must never touch it again
          paymentExpiresAt: null,
        },
      });

      return {
        outcome: "paid" as const,
        orderId: order.id,
        userId: order.userId,
      };
    });

    if (result.outcome === "paid") {
      invalidateCache({
        order: true,
        admin: true,
        userId: result.userId,
        orderId: result.orderId,
      });

      // Exactly-once, for free: all three callers race to this transition but
      // only the one that actually moved the row gets `paid` — the others see
      // `already-paid` and fall past this. Nothing about the receipt needed a
      // flag of its own. It is not awaited; see mailer.ts.
      void sendOrderConfirmation(result.orderId!);
    }

    return { outcome: result.outcome, orderId: result.orderId };
  } catch (error: any) {
    // Unique violation on razorpayPaymentId: this capture already belongs to
    // another order. Never reassign it — that would be money credited to the
    // wrong customer.
    if (error?.code === "P2002") {
      console.error(
        `[payment] ${razorpayPaymentId} is already attached to another order`
      );
      return { outcome: "conflict" };
    }
    throw error;
  }
};

/**
 * Cancels an order and returns its stock to the shelf.
 *
 * The `stockReserved` flag — not this function — is what makes a double
 * restore impossible: it is read and cleared inside the same transaction as
 * the increment, so the expiry sweep and a customer cancelling at the same
 * moment cannot both give the units back.
 */
export const releaseOrder = async (orderId: string, reason: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        stockReserved: true,
        // Read here rather than by the caller: the cancel handler refunds
        // *before* calling this, so by now the column already says whether
        // money moved, and the notice can say so without being told.
        paymentStatus: true,
        // variantId comes along because restoreStock has to put the units back
        // into the variant they came out of, not just into the product rollup.
        items: { select: { productId: true, variantId: true, quantity: true } },
      },
    });

    if (!order) return { released: false, order: null };
    if (order.status === "Cancelled") return { released: false, order };

    if (order.stockReserved) await restoreStock(tx, order.items);

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "Cancelled",
        stockReserved: false,
        cancelledAt: new Date(),
        cancelReason: reason,
        paymentExpiresAt: null,
      },
    });

    return { released: true, order };
  });

  if (result.released && result.order) {
    invalidateCache({
      product: true,
      order: true,
      admin: true,
      userId: result.order.userId,
      orderId: result.order.id,
      productId: result.order.items.map((i) => i.productId),
    });

    // Guarded by `released`, which is only true for the transition that
    // actually happened — the expiry sweep and a customer cancelling at the
    // same moment cannot both send a notice, for the same reason they cannot
    // both restore the stock.
    void sendOrderCancelled(result.order.id, {
      reason,
      refunded: result.order.paymentStatus === "Refunded",
    });
  }

  return result.released;
};
