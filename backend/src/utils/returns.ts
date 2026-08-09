import { Prisma } from "../generated/prisma/index.js";
import ErrorHandler from "./utiliy-class.js";
import { pricingConfig } from "./pricing.js";

/**
 * The rules a return has to satisfy, and the arithmetic of what it is worth.
 *
 * Kept out of the controller and free of Prisma calls so both are testable
 * against plain objects — the refund amount in particular is money the store
 * pays out, and "we worked it out inline in the handler" is how a rounding rule
 * ends up differing between the preview an operator sees and the figure that
 * actually leaves the account.
 */

/** What the customer picks from. Free text in the column; a fixed list here. */
export const RETURN_REASONS = [
  "Arrived damaged",
  "Wrong item sent",
  "Does not fit",
  "Not as described",
  "No longer needed",
  "Other",
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];

export const isReturnReason = (value: unknown): value is ReturnReason =>
  typeof value === "string" && (RETURN_REASONS as readonly string[]).includes(value);

/** The statuses that mean a request is still live and holds the order's slot. */
export const OPEN_RETURN_STATUSES = ["Requested", "Approved", "Received"] as const;

/**
 * Whether an order can be returned at all, and why not when it cannot.
 *
 * Only a delivered order qualifies. Anything earlier is a cancellation, which
 * is a different endpoint with different consequences — cancelling restores
 * stock the warehouse still has, returning waits for a parcel to come back.
 */
export const assertOrderReturnable = (
  order: { status: string; deliveredAt: Date | null; paymentStatus: string },
  now: Date = new Date()
) => {
  if (order.status !== "Delivered")
    throw new ErrorHandler(
      "Only delivered orders can be returned. Orders that have not shipped can be cancelled instead.",
      409
    );

  // An order delivered before the deliveredAt column existed has no date to
  // measure from. Refusing it outright would punish the customer for a schema
  // change, so the window is treated as open and a human decides — the same
  // reasoning that stops the review-request sweep mailing those orders.
  if (!order.deliveredAt) return;

  const { returnWindowDays } = pricingConfig();
  const deadline = new Date(
    order.deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000
  );

  if (now > deadline)
    throw new ErrorHandler(
      `The ${returnWindowDays}-day return window for this order has closed.`,
      409
    );
};

export type RequestedLine = { orderItemId: string; quantity: number };

export type OrderLine = {
  id: string;
  price: Prisma.Decimal;
  quantity: number;
  /** Units already committed to other live or completed returns. */
  alreadyReturned: number;
};

/**
 * Validates the requested lines against the order and returns them priced.
 *
 * The quantity check is against what is left after earlier returns, not against
 * what was ordered: without that, a customer could return the same shirt three
 * times and be refunded for all three. `alreadyReturned` is counted by the
 * caller from requests that were not rejected or withdrawn — a rejected request
 * consumed nothing and must not reduce the allowance.
 */
export const priceReturnLines = (
  requested: RequestedLine[],
  orderLines: OrderLine[]
) => {
  if (!Array.isArray(requested) || requested.length === 0)
    throw new ErrorHandler("Choose at least one item to return", 400);

  const byId = new Map(orderLines.map((l) => [l.id, l]));
  const seen = new Set<string>();

  let itemsValue = new Prisma.Decimal(0);
  let unitsReturned = 0;
  let unitsOrdered = 0;

  const lines = requested.map((line) => {
    const orderLine = byId.get(line.orderItemId);
    // Scoped to this order's items rather than looked up globally: an id from
    // the browser naming another customer's order line would otherwise price
    // and refund against it.
    if (!orderLine)
      throw new ErrorHandler("That item is not part of this order", 400);

    if (seen.has(line.orderItemId))
      throw new ErrorHandler("The same item was listed twice", 400);
    seen.add(line.orderItemId);

    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new ErrorHandler("Invalid return quantity", 400);

    const remaining = orderLine.quantity - orderLine.alreadyReturned;
    if (quantity > remaining)
      throw new ErrorHandler(
        remaining <= 0
          ? "That item has already been returned"
          : `Only ${remaining} of that item can still be returned`,
        400
      );

    itemsValue = itemsValue.add(orderLine.price.mul(quantity));
    unitsReturned += quantity;

    return { orderItemId: line.orderItemId, quantity };
  });

  for (const line of orderLines) unitsOrdered += line.quantity;

  return { lines, itemsValue, unitsReturned, unitsOrdered };
};

/**
 * What to refund for a set of returned lines.
 *
 * Two decisions worth stating, because both are the kind that get quietly
 * reversed by whoever touches this next:
 *
 *  - **Tax comes back proportionally.** The customer paid tax on the goods, so
 *    returning a third of the goods' value returns a third of the tax. Refunding
 *    the bare item price short-changes them by the tax rate on every return.
 *  - **Shipping comes back only on a full return.** Delivering the parcel cost
 *    what it cost, and a customer keeping one of three items has still had it
 *    delivered. Returning everything means the order should not have happened.
 *
 * The discount is handled by proportioning against what was actually charged:
 * `itemsValue / subtotal` is the share of the goods coming back, applied to the
 * tax and to the discount alike, so a coupon is clawed back in the same
 * proportion rather than being kept in full on a partial return.
 */
export const refundAmountFor = ({
  itemsValue,
  subtotal,
  tax,
  shippingCharges,
  discount,
  fullReturn,
}: {
  itemsValue: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  shippingCharges: Prisma.Decimal;
  discount: Prisma.Decimal;
  fullReturn: boolean;
}): Prisma.Decimal => {
  // A zero subtotal means there is nothing to take a proportion of. It should
  // not be reachable — CHECK constraints keep prices non-negative and an order
  // with no value cannot be placed — but dividing by it would produce NaN and
  // refund an arbitrary amount, so it is answered explicitly.
  if (subtotal.lte(0)) return new Prisma.Decimal(0);

  const share = itemsValue.div(subtotal);

  const taxBack = tax.mul(share);
  const discountBack = discount.mul(share);
  const shippingBack = fullReturn ? shippingCharges : new Prisma.Decimal(0);

  const refund = itemsValue.add(taxBack).add(shippingBack).sub(discountBack);

  // Rounded to whole rupees, matching how tax is computed at checkout, and
  // floored at zero so a discount larger than the returned goods cannot make
  // the store ask for money back.
  const rounded = new Prisma.Decimal(Math.round(refund.toNumber()));
  return rounded.lt(0) ? new Prisma.Decimal(0) : rounded;
};
