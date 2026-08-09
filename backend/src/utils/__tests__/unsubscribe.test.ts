import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  unsubscribeConfigured,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "../unsubscribe.js";

/**
 * The unsubscribe token.
 *
 * This is the authority behind the app's second deliberately-unauthenticated
 * route. What the signature buys is narrow — it stops someone unsubscribing
 * *other people* by walking uids through the endpoint — and that is exactly what
 * these check.
 */

beforeEach(() => {
  process.env.MAIL_UNSUBSCRIBE_SECRET = "test-secret";
});

afterEach(() => {
  delete process.env.MAIL_UNSUBSCRIBE_SECRET;
  delete process.env.RAZORPAY_KEY_SECRET;
});

describe("round trip", () => {
  it("verifies a token it minted", () => {
    expect(verifyUnsubscribeToken(unsubscribeToken("user-1"))).toBe("user-1");
  });

  it("refuses a token signed for a different uid", () => {
    // The whole point: swapping the uid in a link must not let you unsubscribe
    // somebody else.
    const token = unsubscribeToken("user-1");
    const forged = token.replace("user-1", "user-2");
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("refuses a tampered signature", () => {
    const token = unsubscribeToken("user-1");
    expect(verifyUnsubscribeToken(`${token}0`)).toBeNull();
  });

  it("refuses a bare uid with no signature", () => {
    expect(verifyUnsubscribeToken("user-1")).toBeNull();
  });

  it("refuses non-strings", () => {
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
    expect(verifyUnsubscribeToken(42)).toBeNull();
  });
});

describe("configuration", () => {
  it("falls back to the Razorpay secret", () => {
    delete process.env.MAIL_UNSUBSCRIBE_SECRET;
    process.env.RAZORPAY_KEY_SECRET = "rzp-secret";
    expect(unsubscribeConfigured()).toBe(true);
    expect(verifyUnsubscribeToken(unsubscribeToken("user-1"))).toBe("user-1");
  });

  it("is namespaced away from a raw HMAC over the same secret", () => {
    // The unsubscribe secret falls back to RAZORPAY_KEY_SECRET, so without the
    // "unsubscribe:" prefix a token minted here would be byte-identical to a
    // payment signature over the same string — and each would verify as the
    // other. The prefix is the only thing keeping the two apart.
    delete process.env.MAIL_UNSUBSCRIBE_SECRET;
    process.env.RAZORPAY_KEY_SECRET = "shared";

    const signature = unsubscribeToken("user-1").split(".")[1];
    const rawHmac = crypto
      .createHmac("sha256", "shared")
      .update("user-1")
      .digest("hex");

    expect(signature).not.toBe(rawHmac);
  });

  it("mints nothing and verifies nothing when unconfigured", () => {
    delete process.env.MAIL_UNSUBSCRIBE_SECRET;
    expect(unsubscribeConfigured()).toBe(false);
    expect(unsubscribeToken("user-1")).toBe("");
    expect(verifyUnsubscribeToken("anything.at-all")).toBeNull();
  });
});
