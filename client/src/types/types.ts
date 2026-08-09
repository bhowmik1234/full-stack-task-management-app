export type User = {
    name: string;
    // Google sign-in fills email/photo, phone sign-in fills phone — an account
    // always has one identifier, never necessarily both.
    email?: string | null;
    phone?: string | null;
    photo?: string | null;
    gender: string;
    role: string;
    dob: string;
    _id: string;
    // Suppresses back-in-stock alerts, review requests and abandoned-checkout
    // reminders. Never receipts or delivery updates — those are not marketing
    // and are deliberately outside this switch.
    emailOptOut?: boolean;
  };

  export type Product = {
    name: string;
    price: number;
    stock: number;
    category: string;
    // hero image; `images` repeats it at index 0 followed by the gallery
    photo: string;
    images?: string[];
    description?: string;
    brand?: string;
    // stored as newline-separated text, always sent as arrays
    highlights?: string[];
    inTheBox?: string[];
    warranty?: string;
    specs?: ProductSpec[];
    createdAt?: string;
    // derived from the Review table by the API, not columns — 0 when nobody
    // has reviewed the product yet
    ratings?: number;
    numOfReviews?: number;
    // The axes this product varies along, and the buyable combinations. Both
    // are always arrays and both are empty for a product without variants —
    // which is most of them — so a component maps rather than null-checks.
    //
    // Only GET /product/:id populates these; list endpoints send them empty,
    // the same way they send `images: [photo]`. A card renders a hero and a
    // price and has no use for every combination.
    //
    // When `variants` is non-empty, `price` above is the *cheapest* variant and
    // `stock` is the sum across them, so a card can say "from ₹X" and an
    // out-of-stock badge stays truthful.
    options?: ProductOption[];
    variants?: ProductVariant[];
    // Sent by *every* endpoint, including the list ones that omit the arrays
    // above. It is what lets a card know its "Add to cart" has to become a link
    // to the picker.
    hasVariants?: boolean;
    _id: string;
  };

  export type ProductOption = {
    /** "Size" */
    name: string;
    /** ["S", "M", "L"] */
    values: string[];
  };

  export type ProductVariant = {
    _id: string;
    id: string;
    sku: string;
    /** Aligned by index to the product's `options` array. */
    optionValues: string[];
    /** "Blue / M" — what the buy box and the order item show. */
    label: string;
    price: number;
    stock: number;
  };

  // One row of the specification table. `group` is the section heading it
  // appears under, e.g. "Display".
  export type ProductSpec = {
    group: string;
    label: string;
    value: string;
  };

  export type Review = {
    _id: string;
    productId: string;
    userId: string;
    rating: number;
    title: string;
    comment: string;
    createdAt: string;
    // true when the reviewer has actually ordered this product
    verified: boolean;
    user?: {
      _id: string;
      name: string;
      photo: string;
    };
  };

  export type RatingBucket = {
    stars: number;
    count: number;
  };
  

  export type ShippingInfo = {
    address: string;
    city: string;
    state: string;
    country: string;
    pinCode: string;
  };

  // One row of a review the caller wrote, with enough of the product attached
  // to render it without a second fetch.
  export type MyReview = {
    _id: string;
    productId: string;
    rating: number;
    title: string;
    comment: string;
    createdAt: string;
    updatedAt: string;
    verified: boolean;
    product: {
      _id: string;
      name: string;
      photo: string;
    };
  };

  // A saved shipping address. The flat columns and the nested `shippingInfo`
  // are the same five values: the address book renders the fields, and checkout
  // spreads the nested object straight into its form state.
  export type Address = {
    _id: string;
    label: string;
    fullName: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    country: string;
    pinCode: string;
    isDefault: boolean;
    createdAt: string;
    shippingInfo: ShippingInfo;
  };

  // What the address form submits. `isDefault` is optional because the server
  // makes a customer's first address their default regardless.
  export type AddressInput = {
    label: string;
    fullName: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    country: string;
    pinCode: string;
    isDefault?: boolean;
  };

  // The three profile fields a customer owns. Email and phone are deliberately
  // absent — they belong to the sign-in provider.
  export type ProfileInput = {
    name?: string;
    gender?: string;
    dob?: string;
  };

  export type CartItem = {
    productId: string;
    photo: string;
    name: string;
    price: number;
    quantity: number;
    stock: number;
    // Which combination, for a product that has options. null for one that does
    // not — which is every item added before variants existed, so anything
    // reading this must treat null as "the product itself".
    //
    // The cart is keyed on productId *and* variantId together: two sizes of the
    // same shirt are two lines, not one line whose quantity keeps overwriting
    // itself.
    variantId?: string | null;
    /** "Blue / M". Empty string when there is no variant. */
    variantLabel?: string;
  };

  export type OrderItem = Omit<CartItem, "stock"> & { _id: string };

  /** Carrier details, present once an order has actually been dispatched. */
  export type Shipment = {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    shippedAt: string | null;
  };

  /** "Requested" | "Approved" | "Rejected" | "Received" | "Refunded" | "Cancelled" */
  export type ReturnStatus =
    | "Requested"
    | "Approved"
    | "Rejected"
    | "Received"
    | "Refunded"
    | "Cancelled";

  export type ReturnRequestItem = {
    _id: string;
    orderItemId: string;
    quantity: number;
    // Present when the endpoint joined the order item, which both the account
    // page and the console's queue do.
    name?: string;
    photo?: string;
    variantLabel?: string;
    price?: number;
  };

  export type ReturnRequest = {
    _id: string;
    orderId: string;
    userId: string;
    status: ReturnStatus;
    reason: string;
    note: string;
    decisionNote: string;
    /** null until the refund actually succeeds — it is the record that it did. */
    refundAmount: number | null;
    decidedAt: string | null;
    restocked: boolean;
    createdAt: string;
    items: ReturnRequestItem[];
    order?: { _id: string; total: number; createdAt: string };
    user?: { _id: string; name: string };
  };

  /**
   * The tax and shipping rules, served by GET /config/storefront.
   *
   * The cart computes its preview from these rather than from literals, so the
   * total shown and the total charged come from the same source. Checkout still
   * re-derives everything server-side; this is advisory.
   */
  export type StorefrontConfig = {
    currency: string;
    /** Fraction, not a percentage: 0.18 is 18%. */
    taxRate: number;
    shippingFee: number;
    freeShippingThreshold: number;
    /** Per-state overrides, keyed by lowercased state name. */
    shippingZones: Record<string, number>;
    returnWindowDays: number;
    cod: {
      enabled: boolean;
      /** 0 means no ceiling. */
      maxOrderValue: number;
      fee: number;
    };
  };

  export type PaymentMethod = "Razorpay" | "COD";

  export type Order = {
    orderItems: OrderItem[];
    shippingInfo: ShippingInfo;
    subtotal: number;
    tax: number;
    shippingCharges: number;
    discount: number;
    total: number;
    // "PendingPayment" | "Processing" | "Shipped" | "Delivered" | "Cancelled"
    status: string;
    // Tracked separately from `status`: "has the money moved" vs "where is the
    // parcel". "Pending" | "Paid" | "Failed" | "Refunded".
    paymentStatus?: string;
    amountCharged?: number | null;
    /** "Razorpay" | "COD". Absent on orders placed before COD existed. */
    paymentMethod?: PaymentMethod;
    /** Carrier and tracking, null until the order is dispatched. */
    shipment?: Shipment | null;
    /** When fulfilment reached Delivered — the clock the return window runs on. */
    deliveredAt?: string | null;
    /** Only present on endpoints that joined them. */
    returns?: ReturnRequest[];
    /** set when payment landed; createdAt is when checkout started */
    placedAt?: string | null;
    cancelReason?: string | null;
    createdAt?: string;
    user: {
      name: string;
      _id: string;
    };
    _id: string;
  };
