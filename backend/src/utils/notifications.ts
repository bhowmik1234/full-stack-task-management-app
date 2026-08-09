import { prisma } from "./db.js";
import {
  sendBackInStock,
  sendCheckoutRecovery,
  sendReviewRequest,
} from "./emails.js";

/**
 * The three notification sweeps, run on one interval alongside the expiry
 * sweep.
 *
 * **Why a sweep and not a hook on each event.** Back-in-stock is the clearest
 * case: stock rises in at least three places — an operator editing a product,
 * an order being cancelled, and the expiry sweep restoring a reservation — and
 * a hook would have to be added to each, correctly, forever. The condition that
 * actually matters is "this product has stock and somebody is waiting", which
 * is a query. Asking it periodically catches every path including ones added
 * later, and costs one indexed query per cycle. Timeliness is not the
 * constraint here: a customer waiting a fortnight for a restock does not
 * measure the difference between an instant alert and a five-minute one.
 *
 * **Every sweep marks before it sends.** The flag column is written first, and
 * the mail is queued after. A crash between the two loses a message; the
 * reverse order would re-send one on the next cycle. For notifications that is
 * the right way round — a missed restock alert is a disappointment, a duplicate
 * is the store looking broken, and a duplicate "how was your order?" to someone
 * who already replied is worse still.
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Bounded per cycle so a backlog drains steadily instead of in one burst. */
const MAX_PER_SWEEP = 100;

/**
 * How long after delivery to ask for a review. Long enough that the box has
 * been opened and the thing used at least once — asking on the doorstep gets
 * either silence or a review of the courier.
 */
const REVIEW_DELAY_DAYS = 3;

/**
 * How long after an abandoned checkout to nudge. Short enough that the intent
 * is still live, long enough not to arrive while they are still deciding — the
 * transactional "payment not completed" notice has already gone out
 * immediately, so this is not the customer's first word from us.
 */
const RECOVERY_DELAY_HOURS = 24;

/** The recipient fields every notification sender needs, in one place. */
const RECIPIENT = { id: true, name: true, email: true, emailOptOut: true } as const;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

/**
 * Restocked products with people waiting.
 *
 * The `notifiedAt: null` filter is what makes this idempotent: a request is
 * satisfied once and the row stays as a record. A product that sells out and
 * restocks again does not re-alert, because the request was already answered —
 * asking again is a new request the customer has to make.
 */
export const sweepBackInStock = async () => {
  const pending = await prisma.stockAlert.findMany({
    where: { notifiedAt: null, product: { stock: { gt: 0 } } },
    take: MAX_PER_SWEEP,
    select: {
      userId: true,
      productId: true,
      user: { select: RECIPIENT },
      product: { select: { id: true, name: true, price: true, stock: true } },
    },
  });

  let sent = 0;
  for (const alert of pending) {
    try {
      await prisma.stockAlert.update({
        where: { userId_productId: { userId: alert.userId, productId: alert.productId } },
        data: { notifiedAt: new Date() },
      });

      // Counting what was actually queued, not what was processed: an
      // opted-out or address-less customer is marked as handled but nothing
      // goes out, and a log claiming otherwise is a lie told to whoever is
      // debugging why an email never arrived.
      if (
        await sendBackInStock(alert.user, {
          id: alert.product.id,
          name: alert.product.name,
          price: Number(alert.product.price),
          stock: alert.product.stock,
        })
      )
        sent++;
    } catch (error) {
      console.error(`[notify] back-in-stock failed for ${alert.productId}`, error);
    }
  }

  return sent;
};

/**
 * Delivered orders old enough to ask about.
 *
 * `deliveredAt: { not: null }` matters as much as the age check: orders
 * delivered before that column existed have NULL and are deliberately never
 * asked, rather than being treated as delivered at the epoch and mailed all at
 * once on the first run after deploy.
 */
export const sweepReviewRequests = async () => {
  const due = await prisma.order.findMany({
    where: {
      status: "Delivered",
      reviewRequestedAt: null,
      deliveredAt: { not: null, lte: daysAgo(REVIEW_DELAY_DAYS) },
    },
    take: MAX_PER_SWEEP,
    select: {
      id: true,
      user: { select: RECIPIENT },
      items: { select: { productId: true, name: true } },
    },
  });

  let sent = 0;
  for (const order of due) {
    try {
      await prisma.order.update({
        where: { id: order.id },
        data: { reviewRequestedAt: new Date() },
      });

      if (await sendReviewRequest(order.user, { id: order.id, items: order.items })) sent++;
    } catch (error) {
      console.error(`[notify] review request failed for order ${order.id}`, error);
    }
  }

  return sent;
};

/**
 * Abandoned checkouts worth a nudge.
 *
 * Two conditions beyond the age, and both exist to avoid an embarrassing send.
 * The order must have been cancelled *for non-payment* — a customer who
 * deliberately cancelled does not want chasing — and the customer must not have
 * bought anything since, because nudging someone about a basket they have
 * already replaced with a completed order reads as the store not knowing who
 * its customers are.
 */
export const sweepCheckoutRecovery = async () => {
  const due = await prisma.order.findMany({
    where: {
      status: "Cancelled",
      paymentStatus: "Pending",
      recoveryEmailSentAt: null,
      cancelReason: { contains: "not completed in time" },
      cancelledAt: { not: null, lte: hoursAgo(RECOVERY_DELAY_HOURS) },
    },
    take: MAX_PER_SWEEP,
    select: {
      id: true,
      userId: true,
      user: { select: RECIPIENT },
      items: { select: { productId: true, name: true, price: true, quantity: true } },
    },
  });

  let sent = 0;
  for (const order of due) {
    try {
      // Checked per order rather than in the query above: "has this customer
      // paid for anything since" is a different table's state and cheap to ask
      // only for the handful that got this far.
      const boughtSince = await prisma.order.count({
        where: { userId: order.userId, paymentStatus: "Paid" },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { recoveryEmailSentAt: new Date() },
      });

      // Marked either way — this order has had its one chance at a nudge, and
      // leaving it unmarked would re-evaluate it every cycle forever.
      if (boughtSince > 0) continue;

      if (
        await sendCheckoutRecovery(order.user, {
          id: order.id,
          items: order.items.map((i) => ({
            productId: i.productId,
            name: i.name,
            price: Number(i.price),
            quantity: i.quantity,
          })),
        })
      )
        sent++;
    } catch (error) {
      console.error(`[notify] recovery failed for order ${order.id}`, error);
    }
  }

  return sent;
};

export const runNotificationSweeps = async () => {
  // Sequential, not Promise.all: these share a connection pool with live
  // requests and there is no deadline to race.
  const stock = await sweepBackInStock();
  const reviews = await sweepReviewRequests();
  const recovery = await sweepCheckoutRecovery();

  if (stock || reviews || recovery)
    console.log(
      `[notify] sent ${stock} restock, ${reviews} review request(s), ${recovery} recovery`
    );

  return { stock, reviews, recovery };
};

export const startNotificationSweep = () => {
  const run = () =>
    runNotificationSweeps().catch((error) =>
      console.error("[notify] sweep failed", error)
    );

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
};
