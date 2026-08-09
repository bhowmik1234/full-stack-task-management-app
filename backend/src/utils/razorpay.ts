import crypto from "crypto";
import Razorpay from "razorpay";
import ErrorHandler from "./utiliy-class.js";

/**
 * Razorpay client and the two signature checks the integration depends on.
 *
 * Razorpay signs two different things with two different secrets, and mixing
 * them up silently accepts forged payments:
 *
 *  - the *checkout handler* response is signed with the API key secret over
 *    `<razorpay_order_id>|<razorpay_payment_id>`
 *  - the *webhook* is signed with a separate webhook secret over the raw
 *    request body
 *
 * The handler check is a fast path so the customer gets an answer immediately.
 * The webhook is the authority — it arrives even if the customer closes the
 * tab, which is the whole reason the order exists before the payment does.
 */

const keyId = process.env.RAZORPAY_KEY_ID || "";
const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";

if (!keyId || !keySecret) {
  // Not fatal at import time — the rest of the API (browsing, cart, admin) is
  // still useful without payments — but checkout will refuse rather than
  // create orders nobody can pay for.
  console.warn(
    "[razorpay] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set; checkout is disabled"
  );
}

export const razorpayEnabled = Boolean(keyId && keySecret);

/** The publishable key id. Safe to hand to the browser; the secret is not. */
export const razorpayKeyId = keyId;

export const razorpay = new Razorpay({
  key_id: keyId || "unset",
  key_secret: keySecret || "unset",
});

export const assertRazorpayConfigured = () => {
  if (!razorpayEnabled)
    throw new ErrorHandler("Payments are not configured", 503);
};

/** Rupees -> paise. Razorpay works entirely in the minor unit. */
export const toPaise = (rupees: number) => Math.round(Number(rupees) * 100);

/** Paise -> rupees, for writing an amount Razorpay reported back to us. */
export const fromPaise = (paise: number) => Number(paise) / 100;

/**
 * Constant-time compare of two hex digests. `!==` on the strings would leak the
 * expected signature one byte at a time to anyone able to time the endpoint.
 */
const safeEqualHex = (a: string, b: string) => {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const hmacHex = (secret: string, payload: string | Buffer) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

/**
 * Verifies the `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`
 * triple that Razorpay Checkout hands to the browser on success.
 *
 * Returns a boolean rather than throwing so the caller decides the status code.
 */
export const verifyCheckoutSignature = ({
  razorpayOrderId,
  razorpayPaymentId,
  signature,
}: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}) =>
  razorpayEnabled &&
  safeEqualHex(
    hmacHex(keySecret, `${razorpayOrderId}|${razorpayPaymentId}`),
    signature
  );

/**
 * Verifies a webhook delivery against the *raw* body.
 *
 * It has to be the exact bytes Razorpay sent — re-serializing the parsed JSON
 * changes key order and whitespace and the digest no longer matches, which is
 * why app.ts mounts express.raw() on this route ahead of express.json().
 */
export const verifyWebhookSignature = (rawBody: Buffer, signature: string) => {
  if (!webhookSecret || !signature) return false;
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
};

export const webhookConfigured = Boolean(webhookSecret);
