import {
  CartItem,
  PaymentMethod,
  ShippingInfo,
  StorefrontConfig,
  User,
} from "./types";

export interface userReducerIntialState{
    user: User | null,
    loading: boolean
}


export interface CartReducerInitialState {
  loading: boolean;
  cartItems: CartItem[];
  subtotal: number;
  tax: number;
  shippingCharges: number;
  discount: number;
  couponCode: string;
  total: number;
  shippingInfo: ShippingInfo;
  /**
   * Tax and shipping rules from GET /config/storefront, so the preview and the
   * charge come from the same source. Defaulted to the old hardcoded numbers
   * until the request lands, so a cart is never priced from nothing.
   */
  config: StorefrontConfig;
  /** Chosen on the shipping page; changes what the total includes. */
  paymentMethod: PaymentMethod;
}