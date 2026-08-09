import { prisma } from "./db.js";
import { Prisma } from "../generated/prisma/index.js";
import ErrorHandler from "./utiliy-class.js";
import {
  LIMITS,
  requireAmount,
  requireDate,
  requireInteger,
  requireString,
} from "./validate.js";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Whether a coupon may be redeemed, and by whom.
 *
 * This is the **only** place that answers that question. Two callers need it
 * and they are not equally trustworthy:
 *
 *   - `applyDiscount` (GET /payement/discount) is the cart's preview. It is
 *     told the subtotal by the browser, so its answer is advisory.
 *   - `calculateOrderAmounts` is checkout. It derives the subtotal from the
 *     product rows itself, inside the checkout transaction, and its answer is
 *     the one that decides what is charged.
 *
 * Keeping both on one function is the point. If the preview and the checkout
 * each grew their own copy of these rules they would drift, and the failure is
 * a customer who is shown "₹500 off" in the cart and charged full price on the
 * next screen — the discount silently disappearing between two pages is worse
 * than being told up front that the code does not apply.
 */

/**
 * Parses the constraint fields out of a coupon create/update body.
 *
 * Three states per field, and the difference between the last two is the whole
 * reason this is not a one-liner:
 *
 *   - **absent** (`undefined`) — leave whatever is stored alone. This is what
 *     lets the update endpoint accept a partial body.
 *   - **explicitly empty** (`null` or `""`) — clear the limit. An operator
 *     removing an expiry date has to be able to say so, and a form that submits
 *     an emptied input sends `""`.
 *   - a value — set it.
 *
 * Collapsing "absent" and "empty" together would make one of those two
 * operations impossible: either a partial update wipes every field it does not
 * mention, or a limit can be set but never removed.
 *
 * `isActive` has no clear-state — it is a boolean with a default, so absent
 * means "unchanged" and there is nothing to null out.
 */
const CLEARED = (value: unknown) => value === null || value === "";

export const couponConditionsFromBody = (body: Record<string, unknown>) => {
  const data: {
    isActive?: boolean;
    expiresAt?: Date | null;
    minOrderValue?: number | null;
    maxRedemptions?: number | null;
    perUserLimit?: number | null;
  } = {};

  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  if (body.expiresAt !== undefined) {
    data.expiresAt = CLEARED(body.expiresAt)
      ? null
      : requireDate(body.expiresAt, "expiresAt");
    // A code that expired before it was created is a typo every time, and it
    // fails in the least visible way possible: silently, for every customer,
    // while the console shows an active coupon.
    if (data.expiresAt && data.expiresAt.getTime() <= Date.now())
      throw new ErrorHandler("The expiry date must be in the future", 400);
  }

  if (body.minOrderValue !== undefined)
    data.minOrderValue = CLEARED(body.minOrderValue)
      ? null
      : requireAmount(body.minOrderValue, "minOrderValue");

  // The database CHECKs these too; rejecting here is what turns a constraint
  // violation into a sentence the operator can act on.
  if (body.maxRedemptions !== undefined) {
    data.maxRedemptions = CLEARED(body.maxRedemptions)
      ? null
      : requireInteger(body.maxRedemptions, "maxRedemptions");
    if (data.maxRedemptions === 0)
      throw new ErrorHandler(
        "A redemption limit of 0 would make the coupon unusable — deactivate it instead",
        400
      );
  }

  if (body.perUserLimit !== undefined) {
    data.perUserLimit = CLEARED(body.perUserLimit)
      ? null
      : requireInteger(body.perUserLimit, "perUserLimit");
    if (data.perUserLimit === 0)
      throw new ErrorHandler(
        "A per-customer limit of 0 would make the coupon unusable — deactivate it instead",
        400
      );
  }

  return data;
};

/**
 * The conditions on a coupon, as a phrase for the audit trail.
 *
 * The log is read by people asking "why did this code stop working" months
 * later, so a summary that records only the discount is the one line that would
 * have answered them and did not.
 */
export const describeConditions = (coupon: {
  isActive: boolean;
  expiresAt: Date | null;
  minOrderValue: Prisma.Decimal | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
}) => {
  const parts: string[] = [];
  if (!coupon.isActive) parts.push("inactive");
  if (coupon.expiresAt) parts.push(`expires ${coupon.expiresAt.toISOString().slice(0, 10)}`);
  if (coupon.minOrderValue) parts.push(`min cart ₹${coupon.minOrderValue.toFixed(0)}`);
  if (coupon.maxRedemptions != null) parts.push(`max ${coupon.maxRedemptions} uses`);
  if (coupon.perUserLimit != null) parts.push(`${coupon.perUserLimit} per customer`);
  return parts.length ? ` · ${parts.join(", ")}` : "";
};

/**
 * How many times this code has been redeemed, optionally by one customer.
 *
 * Counted from orders, not from a counter column on Coupon. A counter would
 * have to be incremented when payment lands and decremented when an order is
 * cancelled or expires — and the three things that settle payment
 * (`/payement/verify`, the Razorpay webhook, and the expiry sweep in
 * utils/expireOrders.ts) all race each other. Every one of them would need to
 * touch the counter exactly once, which is the same class of bug that
 * `stockReserved` exists to prevent for inventory. Orders already record what
 * was redeemed; deriving from them cannot drift, and it cannot double-count.
 *
 * Only **paid** orders count. Checkout writes the order before payment, so
 * counting placed orders would let an abandoned cart burn a redemption that
 * nobody ever received a discount for.
 */
const redemptionCount = (db: Db, code: string, userId?: string) =>
  db.order.count({
    where: { couponCode: code, paymentStatus: "Paid", ...(userId ? { userId } : {}) },
  });

/**
 * Paid redemptions for a set of codes, in one grouped query rather than one
 * count per coupon — the same shape as reviewStatsFor. Codes with no
 * redemptions are absent from the map; callers read them as 0.
 */
export const redemptionCountsFor = async (
  db: Db,
  codes: string[]
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (codes.length === 0) return counts;

  const rows = await db.order.groupBy({
    by: ["couponCode"],
    where: { couponCode: { in: codes }, paymentStatus: "Paid" },
    _count: { _all: true },
  });

  for (const row of rows)
    if (row.couponCode) counts.set(row.couponCode, row._count._all);

  return counts;
};

/**
 * Resolves `code` and throws unless it may be redeemed right now, by `userId`,
 * against a cart of `subtotal`. Returns the coupon on success.
 *
 * `subtotal` is the cart before tax and shipping — the same basis the console's
 * "minimum order" field is described in, because a minimum that quietly
 * included an 18% tax line would be a different number from the one the
 * operator typed.
 *
 * The messages name the condition that failed ("expired", "carts over ₹999")
 * rather than a generic refusal. A customer who is told only "invalid" retypes
 * the code, then contacts support; one who is told the cart is too small adds
 * an item.
 */
export const assertCouponRedeemable = async (
  db: Db,
  rawCode: unknown,
  userId: string,
  // `null` means "the caller does not know the cart" — only the preview may
  // pass it, and it skips the minimum-order check rather than failing it. A
  // default of zero here would silently refuse every minimum-order coupon.
  // Checkout always knows its subtotal and always passes one.
  subtotal: Prisma.Decimal | null
) => {
  const code = requireString(rawCode, "couponCode", LIMITS.couponCode);

  const coupon = await db.coupon.findUnique({ where: { code } });

  // An inactive code is not distinguishable from a non-existent one on
  // purpose: both answers are "this code does nothing", and confirming that a
  // paused code exists tells someone probing codes that they guessed a real
  // one.
  if (!coupon || !coupon.isActive)
    throw new ErrorHandler("Invalid Coupon Code", 400);

  if (coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now())
    throw new ErrorHandler("This coupon has expired", 400);

  if (coupon.minOrderValue && subtotal !== null && subtotal.lt(coupon.minOrderValue))
    throw new ErrorHandler(
      `This coupon needs a cart subtotal of at least ₹${coupon.minOrderValue.toFixed(0)}`,
      400
    );

  // Per-customer first: it is the cheaper query of the two, and it is the one
  // that fails most often on a repeat-use code.
  if (coupon.perUserLimit != null) {
    const mine = await redemptionCount(db, code, userId);
    if (mine >= coupon.perUserLimit)
      throw new ErrorHandler(
        coupon.perUserLimit === 1
          ? "You have already used this coupon"
          : `This coupon may only be used ${coupon.perUserLimit} times per customer`,
        400
      );
  }

  if (coupon.maxRedemptions != null) {
    const used = await redemptionCount(db, code);
    if (used >= coupon.maxRedemptions)
      throw new ErrorHandler("This coupon has been fully redeemed", 400);
  }

  return coupon;
};

/**
 * The discount `code` is worth on a cart of `subtotal`, or 0 for no code.
 *
 * Residual race, stated rather than papered over: the counts above are of
 * *paid* orders, and checkout runs before payment. Two customers can therefore
 * both pass the last-redemption check and both go on to pay, taking a
 * `maxRedemptions: 100` code to 101. Closing that would mean holding a lock on
 * the coupon row from checkout until the money lands — minutes later, across a
 * third-party redirect — which is a far worse trade than occasionally
 * overshooting a promotional cap by the number of simultaneous checkouts.
 * Stock is not allowed this slack because overselling a physical item cannot be
 * absorbed; a discount overshoot is bounded and costs a known amount.
 */
export const discountFor = async (
  db: Db,
  code: string | undefined,
  userId: string,
  subtotal: Prisma.Decimal
): Promise<Prisma.Decimal> => {
  // Note the non-null subtotal: checkout is never the caller that guesses.
  if (!code) return new Prisma.Decimal(0);
  const coupon = await assertCouponRedeemable(db, code, userId, subtotal);
  return coupon.amount;
};
