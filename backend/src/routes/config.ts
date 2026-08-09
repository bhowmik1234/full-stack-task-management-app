import express from "express";
import { TryCatch } from "../middlewares/error.js";
import { pricingConfig } from "../utils/pricing.js";

const app = express.Router();

/**
 * The rules the storefront needs to show a total before it asks for one.
 *
 * The cart computes a preview client-side — it has to, because the numbers move
 * as the customer changes quantities and a round trip per keystroke is not a
 * cart. Previously that preview used three literals (`0.18`, `200`, `1000`) that
 * had to match three more in `calculateOrderAmounts` by hand, and the failure
 * mode was showing one total and charging another.
 *
 * Serving them instead makes the server the single source. The preview is still
 * advisory: `calculateOrderAmounts` re-derives every figure inside the checkout
 * transaction and its answer is what gets charged. That relationship is the same
 * one `applyDiscount` has with the coupon rules.
 *
 * Public, because so is the cart — a signed-out visitor fills one before there
 * is any account to attach it to, and a total that only appears after sign-in is
 * a total nobody sees.
 */
app.get(
  "/storefront",
  TryCatch(async (_req, res) => {
    const config = pricingConfig();

    return res.status(200).json({
      success: true,
      config: {
        currency: config.currency,
        taxRate: config.taxRate,
        shippingFee: config.shippingFee,
        freeShippingThreshold: config.freeShippingThreshold,
        shippingZones: config.shippingZones,
        returnWindowDays: config.returnWindowDays,
        cod: {
          enabled: config.cod.enabled,
          maxOrderValue: config.cod.maxOrderValue,
          fee: config.cod.fee,
        },
      },
    });
  })
);

export default app;
