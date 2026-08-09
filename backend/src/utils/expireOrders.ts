import { prisma } from "./db.js";
import { releaseOrder } from "./orderPayment.js";

/**
 * Reclaims stock from checkouts that were never paid for.
 *
 * Checkout reserves stock *before* the customer is sent to Razorpay, which is
 * what stops two people paying for the last unit. The cost of that is an
 * abandoned checkout holding inventory, so something has to give it back. Any
 * PendingPayment order past its `paymentExpiresAt` is cancelled and its units
 * returned.
 *
 * Deliberately not a cron container: one interval in the API process is enough
 * for a single-instance deployment, and `releaseOrder` is idempotent, so a
 * second instance running the same sweep is harmless rather than a
 * double-restore.
 */

/** How long a customer has to complete payment before the hold is released. */
export const PAYMENT_WINDOW_MINUTES = 30;

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Bounded so a long backlog can't hold a transaction open indefinitely. */
const MAX_PER_SWEEP = 100;

export const expireStaleOrders = async () => {
  const stale = await prisma.order.findMany({
    where: {
      status: "PendingPayment",
      paymentStatus: "Pending",
      paymentExpiresAt: { lt: new Date() },
      // Belt and braces against COD. A COD order never enters PendingPayment
      // and the `cod_order_has_no_payment_expiry` CHECK stops it carrying an
      // expiry at all, so this predicate should match nothing extra — it is
      // here because the failure it guards against is this sweep silently
      // cancelling good orders, which nobody would notice until a customer
      // asked where their parcel went.
      paymentMethod: "Razorpay",
    },
    select: { id: true },
    take: MAX_PER_SWEEP,
  });

  let released = 0;
  for (const { id } of stale) {
    try {
      // One transaction per order rather than one for the batch: a single bad
      // row must not roll back everything else in the sweep.
      if (await releaseOrder(id, "Payment not completed in time")) released++;
    } catch (error) {
      console.error(`[expire] could not release order ${id}`, error);
    }
  }

  if (released > 0)
    console.log(`[expire] released ${released} unpaid order(s)`);

  return released;
};

export const startOrderExpirySweep = () => {
  const run = () =>
    expireStaleOrders().catch((error) =>
      console.error("[expire] sweep failed", error)
    );

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  // don't hold the event loop open on shutdown
  timer.unref();
  return timer;
};
