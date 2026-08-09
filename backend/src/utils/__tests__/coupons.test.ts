import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/index.js";
import { assertCouponRedeemable, couponConditionsFromBody } from "../coupons.js";

/**
 * Coupon rules.
 *
 * `assertCouponRedeemable` is the only thing that decides whether a code may be
 * used, and two callers with very different authority share it: the cart's
 * preview and checkout itself. Letting those grow separate copies of the rules
 * is how a customer is shown "₹500 off" in the cart and charged full price on
 * the next screen — so the behaviour is pinned here.
 *
 * The database is stubbed rather than run: every branch under test is a
 * comparison against columns, and the two counting queries are the only reason
 * a client is needed at all.
 */

const dec = (n: number) => new Prisma.Decimal(n);

type StubCoupon = {
  code: string;
  amount: Prisma.Decimal;
  isActive: boolean;
  expiresAt: Date | null;
  minOrderValue: Prisma.Decimal | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
};

const coupon = (patch: Partial<StubCoupon> = {}): StubCoupon => ({
  code: "SAVE10",
  amount: dec(100),
  isActive: true,
  expiresAt: null,
  minOrderValue: null,
  maxRedemptions: null,
  perUserLimit: null,
  ...patch,
});

/**
 * The narrow slice of PrismaClient the function touches: one coupon lookup and
 * a count of paid orders carrying the code.
 */
const stubDb = (row: StubCoupon | null, redemptions = 0) =>
  ({
    coupon: { findUnique: async () => row },
    order: { count: async () => redemptions },
  }) as never;

describe("assertCouponRedeemable", () => {
  it("accepts an unconditional code", async () => {
    await expect(
      assertCouponRedeemable(stubDb(coupon()), "SAVE10", "u1", dec(500))
    ).resolves.toMatchObject({ code: "SAVE10" });
  });

  it("gives the same answer for an unknown and a paused code", async () => {
    // Confirming that a paused code exists tells someone probing codes that
    // they guessed a real one.
    const missing = assertCouponRedeemable(stubDb(null), "NOPE", "u1", dec(500));
    const paused = assertCouponRedeemable(
      stubDb(coupon({ isActive: false })),
      "SAVE10",
      "u1",
      dec(500)
    );

    await expect(missing).rejects.toThrow("Invalid Coupon Code");
    await expect(paused).rejects.toThrow("Invalid Coupon Code");
  });

  it("refuses an expired code", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    await expect(
      assertCouponRedeemable(stubDb(coupon({ expiresAt: yesterday })), "SAVE10", "u1", dec(500))
    ).rejects.toThrow(/expired/i);
  });

  it("names the shortfall rather than saying 'invalid'", async () => {
    // A customer told the cart is too small adds an item; one told "invalid"
    // retypes the code and then contacts support.
    await expect(
      assertCouponRedeemable(
        stubDb(coupon({ minOrderValue: dec(1000) })),
        "SAVE10",
        "u1",
        dec(500)
      )
    ).rejects.toThrow(/at least ₹1000/);
  });

  it("skips the minimum check when the caller does not know the subtotal", async () => {
    // Only the preview passes null. Defaulting it to zero would silently refuse
    // every minimum-order coupon.
    await expect(
      assertCouponRedeemable(
        stubDb(coupon({ minOrderValue: dec(1000) })),
        "SAVE10",
        "u1",
        null
      )
    ).resolves.toBeTruthy();
  });

  it("refuses once the per-customer limit is reached", async () => {
    await expect(
      assertCouponRedeemable(
        stubDb(coupon({ perUserLimit: 1 }), 1),
        "SAVE10",
        "u1",
        dec(500)
      )
    ).rejects.toThrow(/already used/i);
  });

  it("refuses once the global cap is reached", async () => {
    await expect(
      assertCouponRedeemable(
        stubDb(coupon({ maxRedemptions: 100 }), 100),
        "SAVE10",
        "u1",
        dec(500)
      )
    ).rejects.toThrow(/fully redeemed/i);
  });
});

describe("couponConditionsFromBody", () => {
  it("distinguishes absent from explicitly cleared", () => {
    // Collapsing the two would make either partial updates or limit removal
    // impossible.
    expect(couponConditionsFromBody({})).toEqual({});
    expect(couponConditionsFromBody({ maxRedemptions: null })).toMatchObject({
      maxRedemptions: null,
    });
  });

  it("reads a supplied limit", () => {
    expect(couponConditionsFromBody({ perUserLimit: 2 })).toMatchObject({
      perUserLimit: 2,
    });
  });
});
