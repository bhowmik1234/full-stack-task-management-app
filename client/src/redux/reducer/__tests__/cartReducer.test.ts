import { describe, expect, it } from "vitest";
import {
  addToCart,
  calculatePrice,
  cartReducer,
  discountApplied,
  removeCartItem,
  saveShippingInfo,
  selectPaymentMethod,
  storeConfig,
} from "../cartReducer";
import { CartItem, StorefrontConfig } from "../../../types/types";

/**
 * The cart's arithmetic and its line identity.
 *
 * Two things are worth pinning here. The totals are what a customer reads
 * before agreeing to pay, and they are computed a second time server-side —
 * a divergence is the bug that shows one number and charges another. And the
 * line key now includes the variant: keying on productId alone meant adding
 * the medium after the small silently *replaced* it, and the customer received
 * one shirt having chosen two.
 */

const reduce = (state: any, action: any) => cartReducer.reducer(state, action);
const initial = () => cartReducer.reducer(undefined, { type: "@@INIT" });

const item = (patch: Partial<CartItem> = {}): CartItem => ({
  productId: "p1",
  photo: "p.jpg",
  name: "Shirt",
  price: 500,
  quantity: 1,
  stock: 10,
  variantId: null,
  variantLabel: "",
  ...patch,
});

const config = (patch: Partial<StorefrontConfig> = {}): StorefrontConfig => ({
  currency: "INR",
  taxRate: 0.18,
  shippingFee: 200,
  freeShippingThreshold: 1000,
  shippingZones: {},
  returnWindowDays: 7,
  cod: { enabled: false, maxOrderValue: 20000, fee: 0 },
  ...patch,
});

describe("line identity", () => {
  it("treats two variants of one product as two lines", () => {
    let state = initial();
    state = reduce(state, addToCart(item({ variantId: "v1", variantLabel: "S" })));
    state = reduce(state, addToCart(item({ variantId: "v2", variantLabel: "M" })));

    expect(state.cartItems).toHaveLength(2);
  });

  it("replaces the same variant rather than duplicating it", () => {
    let state = initial();
    state = reduce(state, addToCart(item({ variantId: "v1", quantity: 1 })));
    state = reduce(state, addToCart(item({ variantId: "v1", quantity: 3 })));

    expect(state.cartItems).toHaveLength(1);
    expect(state.cartItems[0].quantity).toBe(3);
  });

  it("removes only the named variant", () => {
    let state = initial();
    state = reduce(state, addToCart(item({ variantId: "v1", variantLabel: "S" })));
    state = reduce(state, addToCart(item({ variantId: "v2", variantLabel: "M" })));
    state = reduce(state, removeCartItem({ productId: "p1", variantId: "v1" }));

    expect(state.cartItems).toHaveLength(1);
    expect(state.cartItems[0].variantId).toBe("v2");
  });

  it("still handles products without variants", () => {
    let state = initial();
    state = reduce(state, addToCart(item()));
    state = reduce(state, removeCartItem({ productId: "p1", variantId: null }));

    expect(state.cartItems).toHaveLength(0);
  });
});

describe("calculatePrice", () => {
  it("matches the old hardcoded behaviour by default", () => {
    let state = initial();
    state = reduce(state, addToCart(item({ price: 500, quantity: 1 })));
    state = reduce(state, calculatePrice());

    expect(state.subtotal).toBe(500);
    expect(state.tax).toBe(90); // 18%
    expect(state.shippingCharges).toBe(200);
    expect(state.total).toBe(790);
  });

  it("waives shipping strictly above the threshold", () => {
    let state = initial();
    state = reduce(state, addToCart(item({ price: 1000, quantity: 1 })));
    state = reduce(state, calculatePrice());
    expect(state.shippingCharges).toBe(200);

    state = reduce(state, addToCart(item({ price: 1001, quantity: 1 })));
    state = reduce(state, calculatePrice());
    expect(state.shippingCharges).toBe(0);
  });

  it("charges nothing for shipping on an empty cart", () => {
    const state = reduce(initial(), calculatePrice());
    expect(state.shippingCharges).toBe(0);
    expect(state.total).toBe(0);
  });

  it("uses the server's rates once they arrive", () => {
    let state = initial();
    state = reduce(state, storeConfig(config({ taxRate: 0.05, shippingFee: 50 })));
    state = reduce(state, addToCart(item({ price: 100, quantity: 1 })));
    state = reduce(state, calculatePrice());

    expect(state.tax).toBe(5);
    expect(state.shippingCharges).toBe(50);
  });

  it("applies a per-state shipping override", () => {
    let state = initial();
    state = reduce(state, storeConfig(config({ shippingZones: { kerala: 150 } })));
    state = reduce(
      state,
      saveShippingInfo({ address: "", city: "", state: "Kerala", country: "", pinCode: "" })
    );
    state = reduce(state, addToCart(item({ price: 500 })));
    state = reduce(state, calculatePrice());

    expect(state.shippingCharges).toBe(150);
  });

  it("lets free shipping beat a zone override", () => {
    let state = initial();
    state = reduce(state, storeConfig(config({ shippingZones: { kerala: 150 } })));
    state = reduce(
      state,
      saveShippingInfo({ address: "", city: "", state: "Kerala", country: "", pinCode: "" })
    );
    state = reduce(state, addToCart(item({ price: 5000 })));
    state = reduce(state, calculatePrice());

    expect(state.shippingCharges).toBe(0);
  });

  it("adds the COD handling charge to shipping", () => {
    let state = initial();
    state = reduce(state, storeConfig(config({ cod: { enabled: true, maxOrderValue: 0, fee: 40 } })));
    state = reduce(state, addToCart(item({ price: 500 })));
    state = reduce(state, selectPaymentMethod("COD"));
    state = reduce(state, calculatePrice());

    expect(state.shippingCharges).toBe(240);
  });

  it("never shows a negative total", () => {
    // A coupon worth more than the order clamps at zero, the same way
    // calculateOrderAmounts does server-side.
    let state = initial();
    state = reduce(state, addToCart(item({ price: 100 })));
    state = reduce(state, discountApplied(100_000));
    state = reduce(state, calculatePrice());

    expect(state.total).toBe(0);
  });
});
