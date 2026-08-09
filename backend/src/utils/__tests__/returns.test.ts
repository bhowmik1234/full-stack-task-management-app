import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/index.js";
import {
  assertOrderReturnable,
  isReturnReason,
  priceReturnLines,
  refundAmountFor,
} from "../returns.js";

/**
 * Returns.
 *
 * `refundAmountFor` decides money that leaves the account, and `priceReturnLines`
 * decides how much of an order may come back at all — the two places where an
 * off-by-one is a refund somebody was not owed.
 */

const dec = (n: number) => new Prisma.Decimal(n);

const line = (id: string, price: number, quantity: number, alreadyReturned = 0) => ({
  id,
  price: dec(price),
  quantity,
  alreadyReturned,
});

describe("assertOrderReturnable", () => {
  const delivered = (deliveredAt: Date | null) => ({
    status: "Delivered",
    paymentStatus: "Paid",
    deliveredAt,
  });

  it("refuses an order that has not been delivered", () => {
    expect(() =>
      assertOrderReturnable({ status: "Processing", paymentStatus: "Paid", deliveredAt: null })
    ).toThrow(/delivered/i);
  });

  it("allows one inside the window", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(() => assertOrderReturnable(delivered(yesterday))).not.toThrow();
  });

  it("refuses one past the window", () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(() => assertOrderReturnable(delivered(longAgo))).toThrow(/window/i);
  });

  it("allows an order delivered before deliveredAt existed", () => {
    // Those rows keep NULL. Refusing them would punish the customer for a
    // schema change, so the window is treated as open and a human decides.
    expect(() => assertOrderReturnable(delivered(null))).not.toThrow();
  });
});

describe("priceReturnLines", () => {
  const order = [line("a", 500, 2), line("b", 300, 1)];

  it("prices the selected units", () => {
    const result = priceReturnLines([{ orderItemId: "a", quantity: 2 }], order);
    expect(result.itemsValue.toNumber()).toBe(1000);
    expect(result.unitsReturned).toBe(2);
  });

  it("refuses an item that is not on the order", () => {
    // The id comes from the browser; scoping it to this order's lines is what
    // stops it pricing against somebody else's.
    expect(() =>
      priceReturnLines([{ orderItemId: "elsewhere", quantity: 1 }], order)
    ).toThrow(/not part of this order/i);
  });

  it("refuses more than were ordered", () => {
    expect(() => priceReturnLines([{ orderItemId: "b", quantity: 2 }], order)).toThrow(
      /only 1/i
    );
  });

  it("counts units already returned against the allowance", () => {
    // Without this a customer could return the same shirt three times and be
    // refunded for all three.
    const partly = [line("a", 500, 2, 1)];
    expect(() => priceReturnLines([{ orderItemId: "a", quantity: 2 }], partly)).toThrow(
      /only 1/i
    );
    expect(() =>
      priceReturnLines([{ orderItemId: "a", quantity: 1 }], partly)
    ).not.toThrow();
  });

  it("refuses zero and negative quantities", () => {
    expect(() => priceReturnLines([{ orderItemId: "a", quantity: 0 }], order)).toThrow();
    expect(() => priceReturnLines([{ orderItemId: "a", quantity: -1 }], order)).toThrow();
  });

  it("refuses the same item twice in one request", () => {
    expect(() =>
      priceReturnLines(
        [
          { orderItemId: "a", quantity: 1 },
          { orderItemId: "a", quantity: 1 },
        ],
        order
      )
    ).toThrow(/twice/i);
  });

  it("refuses an empty selection", () => {
    expect(() => priceReturnLines([], order)).toThrow(/at least one/i);
  });
});

describe("refundAmountFor", () => {
  // An order of ₹1,000 goods, 18% tax, ₹200 delivery, no discount.
  const base = {
    subtotal: dec(1000),
    tax: dec(180),
    shippingCharges: dec(200),
    discount: dec(0),
  };

  it("returns tax proportionally on a partial return", () => {
    // Half the goods back = half the tax back. Refunding the bare item price
    // short-changes the customer by the tax rate on every return.
    expect(
      refundAmountFor({ ...base, itemsValue: dec(500), fullReturn: false }).toNumber()
    ).toBe(590);
  });

  it("refunds delivery only on a whole-order return", () => {
    expect(
      refundAmountFor({ ...base, itemsValue: dec(1000), fullReturn: true }).toNumber()
    ).toBe(1380);
    expect(
      refundAmountFor({ ...base, itemsValue: dec(1000), fullReturn: false }).toNumber()
    ).toBe(1180);
  });

  it("claws a discount back in the same proportion", () => {
    // A ₹200 coupon on the whole order is worth ₹100 against half of it. Keeping
    // it in full on a partial return refunds more than was paid.
    const withCoupon = { ...base, discount: dec(200) };
    expect(
      refundAmountFor({ ...withCoupon, itemsValue: dec(500), fullReturn: false }).toNumber()
    ).toBe(490);
  });

  it("never goes negative", () => {
    const hugeDiscount = { ...base, discount: dec(5000) };
    expect(
      refundAmountFor({ ...hugeDiscount, itemsValue: dec(100), fullReturn: false }).toNumber()
    ).toBe(0);
  });

  it("answers zero for a zero subtotal rather than dividing by it", () => {
    expect(
      refundAmountFor({
        itemsValue: dec(0),
        subtotal: dec(0),
        tax: dec(0),
        shippingCharges: dec(0),
        discount: dec(0),
        fullReturn: true,
      }).toNumber()
    ).toBe(0);
  });
});

describe("isReturnReason", () => {
  it("accepts one from the catalogue and refuses anything else", () => {
    expect(isReturnReason("Arrived damaged")).toBe(true);
    expect(isReturnReason("because I said so")).toBe(false);
    expect(isReturnReason(undefined)).toBe(false);
  });
});
