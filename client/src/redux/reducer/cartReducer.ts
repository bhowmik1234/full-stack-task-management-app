import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { CartReducerInitialState } from "../../types/reducer-types";
import {
  CartItem,
  PaymentMethod,
  ShippingInfo,
  StorefrontConfig,
} from "../../types/types";

/**
 * The defaults the cart prices with until `GET /config/storefront` answers.
 *
 * They reproduce the numbers that used to be hardcoded here (18% tax, ₹200
 * shipping, free over ₹1,000), so the first paint of a cart is never blank or
 * wrong-by-default — it is right for an unconfigured store and replaced within
 * a round trip for a configured one.
 *
 * Every figure here is advisory regardless. `calculateOrderAmounts` on the
 * server re-derives the whole total inside the checkout transaction, and its
 * answer is what gets charged.
 */
const DEFAULT_CONFIG: StorefrontConfig = {
  currency: "INR",
  taxRate: 0.18,
  shippingFee: 200,
  freeShippingThreshold: 1000,
  shippingZones: {},
  returnWindowDays: 7,
  cod: { enabled: false, maxOrderValue: 20000, fee: 0 },
};

const initialState: CartReducerInitialState = {
  loading: false,
  cartItems: [],
  subtotal: 0,
  tax: 0,
  shippingCharges: 0,
  discount: 0,
  couponCode: "",
  total: 0,
  config: DEFAULT_CONFIG,
  paymentMethod: "Razorpay",
  shippingInfo: {
    address: "",
    city: "",
    state: "",
    country: "",
    pinCode: "",
  },
};

/**
 * A cart line's identity.
 *
 * Two sizes of the same shirt are two lines, so the key has to include the
 * variant. Keying on productId alone — which is what this did before variants
 * existed — meant adding the medium after the small silently *replaced* it, and
 * the customer received one shirt having chosen two.
 */
const lineKey = (item: { productId: string; variantId?: string | null }) =>
  `${item.productId}::${item.variantId ?? ""}`;

export const cartReducer = createSlice({
  name: "cartReducer",
  initialState,
  reducers: {
    addToCart: (state, action: PayloadAction<CartItem>) => {
      state.loading = true;

      const key = lineKey(action.payload);
      const index = state.cartItems.findIndex((i) => lineKey(i) === key);

      if (index !== -1) state.cartItems[index] = action.payload;
      else state.cartItems.push(action.payload);
      state.loading = false;
    },

    /**
     * Takes the full line identity rather than a product id, for the reason
     * above: a bare productId would remove whichever size happened to be first.
     */
    removeCartItem: (
      state,
      action: PayloadAction<{ productId: string; variantId?: string | null }>
    ) => {
      state.loading = true;
      const key = lineKey(action.payload);
      state.cartItems = state.cartItems.filter((i) => lineKey(i) !== key);
      state.loading = false;
    },

    /**
     * Stores the rules the server serves.
     *
     * Dispatched once from `useStorefrontConfig`. Kept in the cart slice rather
     * than in its own because every consumer of it is pricing something, and a
     * separate slice would mean two places to look for why a total is what it
     * is.
     */
    storeConfig: (state, action: PayloadAction<StorefrontConfig>) => {
      state.config = action.payload;
    },

    selectPaymentMethod: (state, action: PayloadAction<PaymentMethod>) => {
      state.paymentMethod = action.payload;
    },

    calculatePrice: (state) => {
      const config = state.config ?? DEFAULT_CONFIG;

      const subtotal = state.cartItems.reduce(
        (prevVal, currVal) => prevVal + currVal.price * currVal.quantity,
        0
      );

      state.subtotal = subtotal;

      // A destination-specific rate when the customer has entered an address,
      // falling back to the flat fee. Matches `shippingFeeFor` on the server,
      // including that the free-shipping threshold beats a zone override —
      // being told "free over ₹1,000" and then charged for a zone is a surprise
      // in the worst possible place.
      const zone = config.shippingZones[state.shippingInfo.state?.trim().toLowerCase() ?? ""];
      const baseShipping = zone ?? config.shippingFee;

      // an empty cart is not a shipping bill
      state.shippingCharges =
        state.cartItems.length === 0 || subtotal > config.freeShippingThreshold
          ? 0
          : baseShipping;

      // Cash on delivery can carry a handling charge. It is added to shipping
      // rather than shown separately because that is where the server puts it
      // too — one number in the cart has to be the same number on the order.
      if (state.paymentMethod === "COD" && state.cartItems.length > 0)
        state.shippingCharges += config.cod.fee;

      state.tax = Math.round(subtotal * config.taxRate);

      // An empty cart, or a coupon worth more than the order, would otherwise
      // show a negative total. The backend clamps the same way in
      // calculateOrderAmounts, so this keeps the two in agreement.
      const gross = state.subtotal + state.tax + state.shippingCharges;
      state.total = Math.max(gross - state.discount, 0);
    },

    discountApplied: (state, action: PayloadAction<number>) => {
      state.discount = action.payload;
    },
    saveCouponCode: (state, action: PayloadAction<string>) => {
      state.couponCode = action.payload;
    },
    saveShippingInfo: (state, action: PayloadAction<ShippingInfo>) => {
      state.shippingInfo = action.payload;
    },
    // Deliberately keeps the fetched config: it describes the store, not the
    // cart, and dropping it would price the next cart from the defaults until
    // another round trip finished.
    resetCart: (state) => ({ ...initialState, config: state.config }),
  },
});

export const {
  addToCart,
  removeCartItem,
  calculatePrice,
  discountApplied,
  saveCouponCode,
  saveShippingInfo,
  storeConfig,
  selectPaymentMethod,
  resetCart,
} = cartReducer.actions;
