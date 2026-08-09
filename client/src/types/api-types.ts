import { Address, MyReview, Order, PaymentMethod, Product, RatingBucket, Review, ShippingInfo, User } from "./types";

export type CustomError = {
  status: number,
  data: {
    success: boolean,
    message: string,
  }
}

export type MessageResponse = {
    success: boolean;
    message: string;
  };

  export type UserResponse = {
    success: boolean;
    user: User
  };

  export type AllProductResponse = {
    success: boolean;
    products: Product[];
  }

  export type CategoriesResponse = {
    success: boolean;
    categories: string[];
  }

  export type SearchProductsResponse = AllProductResponse & {
    totalPage: number;
  };
  export type SearchProductsRequest = {
    price: number;
    page: number;
    category: string;
    search: string;
    sort: string;
  };

  export type ProductResponse = {
    success: boolean;
    product: Product;
  }

  export type ReviewsResponse = {
    success: boolean;
    reviews: Review[];
    distribution: RatingBucket[];
    numOfReviews: number;
    average: number;
  };

  // What the caller may do here: whether they have bought the product (drives
  // the "Verified purchase" badge) and the review they have already left.
  export type MyReviewResponse = {
    success: boolean;
    purchased: boolean;
    review: Review | null;
  };

  // Whether the caller has an *outstanding* back-in-stock request for this
  // product. A request that has already been answered reads as false: it is
  // spent, and the button should offer to ask again.
  export type StockAlertResponse = {
    success: boolean;
    watching: boolean;
  };

  // Every review the caller has written, for the account page. Each row carries
  // the product it belongs to — a list of bare ratings with no indication of
  // what they are about is unreadable.
  export type MyReviewsResponse = {
    success: boolean;
    reviews: MyReview[];
  };

  // Search type-ahead. A much leaner row than Product — no stock, no ratings,
  // no description, and no price — because the dropdown renders a thumbnail and
  // a name, and the endpoint deliberately does not pay for anything else.
  export type Suggestion = {
    _id: string;
    name: string;
    photo: string;
    category: string;
  };

  export type SuggestResponse = {
    success: boolean;
    products: Suggestion[];
    categories: string[];
  };

  export type AddressesResponse = {
    success: boolean;
    addresses: Address[];
  };

  export type AddressResponse = {
    success: boolean;
    address: Address;
    message: string;
  };

  export type NewReviewRequest = {
    productId: string;
    userId: string;
    rating: number;
    title?: string;
    comment: string;
  };

  export type DeleteReviewRequest = {
    productId: string;
    userId: string;
  };

  export type MyOrdersResponse = {
    success: boolean;
    orders: Order[];
  }

  export type orderDetailsResponse = {
    success: boolean;
    order: Order;
  }


  /**
   * Body of POST /order/checkout.
   *
   * The amounts are gone on purpose: the server re-derives every one of them
   * from the database, so sending subtotal/tax/total was at best noise and at
   * worst something a future change might start trusting.
   */
  export type CheckoutRequest = {
    userId: string;
    shippingInfo: ShippingInfo;
    // variantId is required for a product with options and refused for one
    // without. The server decides which, from the product's own rows.
    orderItems: { productId: string; quantity: number; variantId?: string }[];
    couponCode?: string;
    /** Defaults to Razorpay server-side when absent. */
    paymentMethod?: PaymentMethod;
  };

  /**
   * What checkout returns.
   *
   * The Razorpay fields are optional because a COD order has none — there is
   * nothing to charge, so no order is opened at the provider and there is no
   * modal to fill in. Branch on `paymentMethod`, not on the presence of
   * `razorpayOrderId`.
   */
  export type CheckoutResponse = {
    success: boolean;
    orderId: string;
    paymentMethod: PaymentMethod;
    razorpayOrderId?: string;
    keyId?: string;
    /** paise for a Razorpay order, rupees for COD — see paymentMethod */
    amount: number;
    currency: string;
    expiresAt?: string | null;
    prefill?: { name: string; email: string; contact: string };
  };

  /**
   * What GET /order/:id/payment returns — everything needed to open the modal.
   *
   * Separate from `CheckoutResponse` because the Razorpay fields are *not*
   * optional here: the endpoint exists only to re-open a prepaid order's payment
   * and refuses a COD order outright, so a caller that reaches this has a
   * Razorpay handle by construction. Sharing one type with checkout would force
   * the pay page to null-check fields it can never be missing.
   */
  export type OrderPaymentResponse = {
    success: boolean;
    orderId: string;
    razorpayOrderId: string;
    keyId: string;
    /** paise — Razorpay works in the minor unit */
    amount: number;
    currency: string;
    expiresAt: string | null;
    prefill?: { name: string; email: string; contact: string };
  };

  export type VerifyPaymentRequest = {
    userId: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };

  export type UpdateOrderRequest = {
    userId: string,
    orderId: string
  };


  export type NewWishListResponse = {
    userId: string,
    productId: string
  }

  export type DeleteWishListResponse = {
    userId: string,
    productId: string
  }



  // The dashboard response shapes lived here. The console owns its own types
  // now (src/admin/types.ts) — it is a separate app on a separate host.

  export type WishListResponse = {
    success: boolean,
    message: string,
    WishList: Product[];
  }