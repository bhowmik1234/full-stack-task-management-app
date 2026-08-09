import type { Prisma } from "../generated/prisma/index.js";

/**
 * Response shaping for the Postgres migration.
 *
 * Two things have to happen at the JSON boundary:
 *
 *  1. Prisma returns `Decimal` objects for money columns. Handed straight to
 *     res.json() they serialize as {"s":1,"e":3,"d":[...]}, so every price has
 *     to be converted to a number here.
 *  2. The client reads `_id` (and a nested `shippingInfo` / `orderItems` shape)
 *     because that is what Mongo returned. Rather than touch every component,
 *     the API keeps emitting that shape. If the client is ever migrated to
 *     plain `id`, this file is the single place to change.
 */

const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d == null ? 0 : typeof d === "number" ? d : Number(d);

type WithId = { id: string };

/** Adds `_id` alongside `id` so existing client code keeps working. */
const withMongoId = <T extends WithId>(row: T) => ({ ...row, _id: row.id });

export const serializeUser = (u: any) => (u ? withMongoId(u) : u);

export const serializeUsers = (rows: any[]) => rows.map(serializeUser);

/**
 * Address rows carry a nested `shippingInfo` as well as the flat columns, so
 * the checkout form can spread one object straight into its state and the
 * address book can render the fields individually — same shape `serializeOrder`
 * emits, which is what lets "ship to this again" be a plain assignment.
 */
export const serializeAddress = (a: any) =>
  a
    ? {
        ...withMongoId(a),
        shippingInfo: {
          address: a.address,
          city: a.city,
          state: a.state,
          country: a.country,
          pinCode: a.pinCode,
        },
      }
    : a;

export const serializeAddresses = (rows: any[]) => rows.map(serializeAddress);

type ProductStats = { ratings: number; numOfReviews: number };

/**
 * `images` is emitted as a flat array of paths with the hero photo first, so
 * the client's gallery can iterate one list. `ratings`/`numOfReviews` are
 * derived from the Review table (see utils/reviewStats.ts) — they are not
 * columns, and default to 0 for a product nobody has reviewed.
 */
/** "a\nb\n\nc" -> ["a", "b", "c"] — blank lines and padding dropped. */
const lines = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

export const serializeProduct = (
  p: any,
  stats?: ProductStats,
  /**
   * Whether this product has variants, when the caller knows but did not join
   * them — which is every list endpoint (see `productsWithVariants`). Omitted,
   * it is inferred from the joined rows.
   *
   * A card needs the boolean and nothing else: a product with options cannot be
   * added to a cart without one, so its "Add to cart" has to become a link to
   * the product page rather than a button that creates a line checkout will
   * refuse.
   */
  hasVariants?: boolean
) => {
  if (!p) return p;

  const { images, reviews, specs, options, variants, _count, ...rest } = p;
  const gallery: string[] = Array.isArray(images)
    ? images.map((i: any) => i.url)
    : [];

  return {
    ...withMongoId(rest),
    price: num(p.price),
    // Both are always arrays, empty for a product without variants, so no
    // component has to null-check before mapping. `price` above stays the
    // rollup (the cheapest variant), which is what a card renders as "from".
    hasVariants: hasVariants ?? (Array.isArray(variants) && variants.length > 0),
    options: Array.isArray(options)
      ? options.map((o: any) => ({ name: o.name, values: o.values }))
      : [],
    variants: Array.isArray(variants)
      ? variants.map((v: any) => ({
          _id: v.id,
          id: v.id,
          sku: v.sku ?? "",
          optionValues: v.optionValues,
          label: (v.optionValues ?? []).filter(Boolean).join(" / "),
          price: num(v.price),
          stock: v.stock,
        }))
      : [],
    images: [p.photo, ...gallery].filter(Boolean),
    // The columns stay newline-separated text; the client always receives
    // arrays, so no component has to know how they are stored.
    highlights: lines(p.highlights),
    inTheBox: lines(p.inTheBox),
    specs: Array.isArray(specs)
      ? specs.map((s: any) => ({
          group: s.group,
          label: s.label,
          value: s.value,
        }))
      : [],
    ratings: stats?.ratings ?? 0,
    numOfReviews: stats?.numOfReviews ?? 0,
  };
};

export const serializeProducts = (
  rows: any[],
  stats?: Map<string, ProductStats>,
  /** Ids that have variants — from one grouped query, not a join per row. */
  withVariants?: Set<string>
) =>
  rows.map((row) =>
    serializeProduct(row, stats?.get(row.id), withVariants?.has(row.id))
  );

export const serializeReview = (r: any) =>
  r
    ? {
        ...withMongoId(r),
        // the join is only ever used for the reviewer's display identity
        user: r.user
          ? { _id: r.user.id, name: r.user.name, photo: r.user.photo }
          : undefined,
      }
    : r;

export const serializeReviews = (rows: any[]) => rows.map(serializeReview);

/**
 * Rebuilds the document shape the client expects: flattened address columns
 * back into `shippingInfo`, and the OrderItem rows back into `orderItems`.
 */
export const serializeOrder = (o: any) => {
  if (!o) return o;
  const {
    address,
    city,
    state,
    country,
    pinCode,
    items,
    user,
    returns,
    // Internal payment plumbing. razorpayOrderId is handed out only by
    // GET /order/:id/payment, to the owner, and the capture id is never
    // needed by the client at all.
    razorpayOrderId,
    razorpayPaymentId,
    stockReserved,
    paymentExpiresAt,
    ...rest
  } = o;

  return {
    ...rest,
    _id: o.id,
    // paymentStatus is separate from status: "has the money moved" vs "where
    // is the parcel". The client needs both to decide whether to offer Pay
    // again or Cancel.
    paymentStatus: o.paymentStatus,
    amountCharged: o.amountCharged == null ? null : num(o.amountCharged),
    shippingInfo: { address, city, state, country, pinCode },
    subtotal: num(o.subtotal),
    tax: num(o.tax),
    shippingCharges: num(o.shippingCharges),
    discount: num(o.discount),
    total: num(o.total),
    // The parcel, as far as the customer can see it. `status` says a parcel
    // left; these say where it is, which is the question the shipping notice
    // used to be unable to answer.
    shipment:
      o.carrier || o.trackingNumber || o.trackingUrl
        ? {
            carrier: o.carrier ?? "",
            trackingNumber: o.trackingNumber ?? "",
            trackingUrl: o.trackingUrl ?? "",
            shippedAt: o.shippedAt ?? null,
          }
        : null,
    // populate("user", "name") used to return { _id, name }
    user: user ? { _id: user.id, name: user.name } : o.userId,
    orderItems: (items ?? []).map((i: any) => ({
      _id: i.id,
      productId: i.productId,
      variantId: i.variantId ?? null,
      name: i.name,
      // "" for an item with no variant, so the client can render it
      // unconditionally rather than branching on presence.
      variantLabel: i.variantLabel ?? "",
      photo: i.photo,
      price: num(i.price),
      quantity: i.quantity,
    })),
    // Only present when the caller asked for them; omitted rather than empty so
    // a screen that did not join returns cannot render "no returns" as a fact.
    ...(returns === undefined ? {} : { returns: serializeReturns(returns) }),
  };
};

/**
 * A return request as the customer's order page and the console's queue read
 * it. `items` carries the OrderItem id so both can line a return up against the
 * order it came from without a second fetch.
 */
export const serializeReturn = (r: any) =>
  r
    ? {
        ...withMongoId(r),
        refundAmount: r.refundAmount == null ? null : num(r.refundAmount),
        items: (r.items ?? []).map((i: any) => ({
          _id: i.id,
          orderItemId: i.orderItemId,
          quantity: i.quantity,
          // Present when the caller joined the order item, which the console's
          // queue does so an operator can see what is coming back.
          ...(i.orderItem
            ? {
                name: i.orderItem.name,
                photo: i.orderItem.photo,
                variantLabel: i.orderItem.variantLabel ?? "",
                price: num(i.orderItem.price),
              }
            : {}),
        })),
        ...(r.order
          ? { order: { _id: r.order.id, total: num(r.order.total), createdAt: r.order.createdAt } }
          : {}),
        ...(r.user ? { user: { _id: r.user.id, name: r.user.name } } : {}),
      }
    : r;

export const serializeReturns = (rows: any[]) => (rows ?? []).map(serializeReturn);

export const serializeOrders = (rows: any[]) => rows.map(serializeOrder);

/**
 * `redeemed` is not a column — it is counted from paid orders and passed in by
 * the caller that did the counting (see utils/coupons.ts for why there is no
 * counter to read). It is omitted rather than zeroed when unknown, so a screen
 * that never asked for it cannot render "0 uses" as though that were a fact.
 */
export const serializeCoupon = (c: any, redeemed?: number) =>
  c
    ? {
        ...withMongoId(c),
        amount: num(c.amount),
        minOrderValue: c.minOrderValue == null ? null : num(c.minOrderValue),
        ...(redeemed === undefined ? {} : { redeemed }),
      }
    : c;

export const serializeCoupons = (rows: any[], redeemed?: Map<string, number>) =>
  rows.map((row) => serializeCoupon(row, redeemed?.get(row.code) ?? (redeemed ? 0 : undefined)));

export { num as decimalToNumber };
