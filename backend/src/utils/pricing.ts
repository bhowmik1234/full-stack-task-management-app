import { Prisma } from "../generated/prisma/index.js";

/**
 * Tax, shipping and cash-on-delivery rules — the single place they are decided.
 *
 * These used to be three literals sitting in two files that had to agree by
 * hand: `18`, `200` and `1000` appeared in the client's `cartReducer` and again
 * in `calculateOrderAmounts`, with a comment on the server one asking the next
 * person to keep them matching. That is the arrangement that shows a customer
 * one total in the cart and charges them another at checkout, and no test can
 * catch it because both numbers are individually correct.
 *
 * Now the server owns them, the client reads them from `GET /config/pricing`,
 * and changing a rate is an environment variable rather than a rebuild of two
 * applications.
 *
 * Every value is read **lazily, inside the accessor**, never at module scope.
 * ESM evaluates every import before `app.ts` reaches its own `config()`, so a
 * module-level read sees `undefined` on any `.env`-based deploy — the same trap
 * `ADMIN_URL` and the mail senders document. Here the failure would be silent
 * and expensive: shipping would quietly fall back to the default on exactly the
 * deploys that configured it.
 */

/** Per-state shipping overrides, keyed by lowercased state name. */
export type ShippingZones = Record<string, number>;

export type PricingConfig = {
  /** Fraction, not a percentage: 0.18 is 18%. */
  taxRate: number;
  /** Flat fee applied when the subtotal is at or below the free threshold. */
  shippingFee: number;
  /** Subtotal strictly above this ships free. */
  freeShippingThreshold: number;
  /** Overrides `shippingFee` for a matching destination state. */
  shippingZones: ShippingZones;
  currency: "INR";
  cod: {
    enabled: boolean;
    /** COD is refused above this order total. 0 means no ceiling. */
    maxOrderValue: number;
    /** Handling charge added to a COD order's total. */
    fee: number;
  };
  /** Days after delivery a return may still be requested. */
  returnWindowDays: number;
};

const num = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
};

/**
 * `SHIPPING_ZONES` is a JSON object of state → fee. Malformed JSON falls back to
 * "no overrides" with a loud log rather than throwing: a typo in an optional
 * environment variable must not stop the store taking orders, but it must also
 * not pass unnoticed, because the symptom is silently charging everyone the
 * default rate.
 */
const zones = (value: string | undefined): ShippingZones => {
  if (!value || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");

    const out: ShippingZones = {};
    for (const [state, fee] of Object.entries(parsed)) {
      const n = Number(fee);
      if (typeof state === "string" && Number.isFinite(n) && n >= 0)
        out[state.trim().toLowerCase()] = n;
    }
    return out;
  } catch (error) {
    console.error("[pricing] SHIPPING_ZONES is not valid JSON; ignoring it", error);
    return {};
  }
};

/**
 * The defaults reproduce exactly what was hardcoded before this file existed:
 * 18% tax, ₹200 shipping, free above ₹1000. An existing deploy that sets none
 * of these variables therefore charges precisely what it charged yesterday,
 * which is the only acceptable behaviour for a change that touches money.
 */
export const pricingConfig = (): PricingConfig => ({
  taxRate: num(process.env.TAX_RATE, 0.18),
  shippingFee: num(process.env.SHIPPING_FEE, 200),
  freeShippingThreshold: num(process.env.FREE_SHIPPING_THRESHOLD, 1000),
  shippingZones: zones(process.env.SHIPPING_ZONES),
  currency: "INR",
  cod: {
    enabled: bool(process.env.COD_ENABLED, false),
    maxOrderValue: num(process.env.COD_MAX_ORDER_VALUE, 20000),
    fee: num(process.env.COD_FEE, 0),
  },
  returnWindowDays: num(process.env.RETURN_WINDOW_DAYS, 7),
});

/**
 * Shipping for a destination. A zone override wins over the flat fee, but the
 * free-shipping threshold wins over both — a customer told "free over ₹1000"
 * and then charged ₹150 because they live in the wrong state has been lied to,
 * and a surprise on the payment screen is the most expensive place to put one.
 */
export const shippingFeeFor = (
  subtotal: Prisma.Decimal,
  state: string | undefined,
  config: PricingConfig = pricingConfig()
): Prisma.Decimal => {
  if (subtotal.gt(config.freeShippingThreshold)) return new Prisma.Decimal(0);

  const zone = state ? config.shippingZones[state.trim().toLowerCase()] : undefined;
  return new Prisma.Decimal(zone ?? config.shippingFee);
};

/**
 * Tax on a subtotal, rounded to whole rupees.
 *
 * The rounding is deliberate and is kept identical to what the old inline
 * expression did (`Math.round(subtotal * 0.18)`), so no existing order's total
 * would come out a rupee different if it were recomputed today.
 */
export const taxFor = (
  subtotal: Prisma.Decimal,
  config: PricingConfig = pricingConfig()
): Prisma.Decimal =>
  new Prisma.Decimal(Math.round(subtotal.mul(config.taxRate).toNumber()));

/**
 * Whether COD may be offered for an order of this size.
 *
 * Checked at checkout as well as rendered in the UI, because the UI's copy of
 * the answer is a courtesy and the request is what actually creates the order.
 */
export const codAllowed = (
  total: number,
  config: PricingConfig = pricingConfig()
): boolean => {
  if (!config.cod.enabled) return false;
  if (config.cod.maxOrderValue > 0 && total > config.cod.maxOrderValue) return false;
  return true;
};
