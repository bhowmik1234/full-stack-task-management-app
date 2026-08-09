import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/index.js";
import { codAllowed, pricingConfig, shippingFeeFor, taxFor } from "../pricing.js";

/**
 * Tax and shipping.
 *
 * These are the numbers on the payment screen, and they are computed twice — in
 * the cart for the preview and in `calculateOrderAmounts` for the charge. The
 * tests that matter are therefore about the *defaults* matching what was
 * hardcoded before this file existed, because a change there silently reprices
 * every order on a deploy that configured nothing.
 */

const dec = (n: number) => new Prisma.Decimal(n);

// Each test sets what it needs; this stops one leaking into the next.
const ENV_KEYS = [
  "TAX_RATE",
  "SHIPPING_FEE",
  "FREE_SHIPPING_THRESHOLD",
  "SHIPPING_ZONES",
  "COD_ENABLED",
  "COD_MAX_ORDER_VALUE",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("defaults", () => {
  it("reproduces the numbers that used to be hardcoded", () => {
    const config = pricingConfig();
    expect(config.taxRate).toBe(0.18);
    expect(config.shippingFee).toBe(200);
    expect(config.freeShippingThreshold).toBe(1000);
  });

  it("falls back rather than throwing on an unparseable value", () => {
    process.env.TAX_RATE = "not a number";
    // A typo in an optional variable must not stop the store taking orders.
    expect(pricingConfig().taxRate).toBe(0.18);
  });
});

describe("taxFor", () => {
  it("rounds to whole rupees, as the old inline expression did", () => {
    // 1234.56 * 0.18 = 222.2208
    expect(taxFor(dec(1234.56)).toNumber()).toBe(222);
  });

  it("is zero on an empty cart", () => {
    expect(taxFor(dec(0)).toNumber()).toBe(0);
  });
});

describe("shippingFeeFor", () => {
  it("charges the flat fee at or below the threshold", () => {
    expect(shippingFeeFor(dec(1000), undefined).toNumber()).toBe(200);
  });

  it("is free strictly above the threshold", () => {
    expect(shippingFeeFor(dec(1000.01), undefined).toNumber()).toBe(0);
  });

  it("applies a zone override below the threshold", () => {
    process.env.SHIPPING_ZONES = JSON.stringify({ kerala: 150 });
    expect(shippingFeeFor(dec(500), "Kerala").toNumber()).toBe(150);
  });

  it("lets free shipping beat a zone override", () => {
    // Being told "free over ₹1,000" and then charged for a zone is a surprise
    // in the most expensive possible place.
    process.env.SHIPPING_ZONES = JSON.stringify({ kerala: 150 });
    expect(shippingFeeFor(dec(5000), "Kerala").toNumber()).toBe(0);
  });

  it("ignores malformed zone JSON instead of throwing", () => {
    process.env.SHIPPING_ZONES = "{ not json";
    expect(shippingFeeFor(dec(500), "Kerala").toNumber()).toBe(200);
  });
});

describe("codAllowed", () => {
  it("is off unless explicitly enabled", () => {
    expect(codAllowed(100)).toBe(false);
  });

  it("refuses above the ceiling", () => {
    process.env.COD_ENABLED = "true";
    process.env.COD_MAX_ORDER_VALUE = "5000";
    expect(codAllowed(5000)).toBe(true);
    expect(codAllowed(5001)).toBe(false);
  });

  it("treats a ceiling of zero as no ceiling", () => {
    process.env.COD_ENABLED = "true";
    process.env.COD_MAX_ORDER_VALUE = "0";
    expect(codAllowed(10_000_000)).toBe(true);
  });
});
