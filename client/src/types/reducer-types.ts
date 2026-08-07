import { CartItem, ShippingInfo, User } from "./types";

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
}