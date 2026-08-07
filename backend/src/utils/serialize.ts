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

export const serializeProduct = (p: any) =>
  p ? { ...withMongoId(p), price: num(p.price) } : p;

export const serializeProducts = (rows: any[]) => rows.map(serializeProduct);

/**
 * Rebuilds the document shape the client expects: flattened address columns
 * back into `shippingInfo`, and the OrderItem rows back into `orderItems`.
 */
export const serializeOrder = (o: any) => {
  if (!o) return o;
  const { address, city, state, country, pinCode, items, user, ...rest } = o;

  return {
    ...rest,
    _id: o.id,
    shippingInfo: { address, city, state, country, pinCode },
    subtotal: num(o.subtotal),
    tax: num(o.tax),
    shippingCharges: num(o.shippingCharges),
    discount: num(o.discount),
    total: num(o.total),
    // populate("user", "name") used to return { _id, name }
    user: user ? { _id: user.id, name: user.name } : o.userId,
    orderItems: (items ?? []).map((i: any) => ({
      _id: i.id,
      productId: i.productId,
      name: i.name,
      photo: i.photo,
      price: num(i.price),
      quantity: i.quantity,
    })),
  };
};

export const serializeOrders = (rows: any[]) => rows.map(serializeOrder);

export const serializeCoupon = (c: any) =>
  c ? { ...withMongoId(c), amount: num(c.amount) } : c;

export const serializeCoupons = (rows: any[]) => rows.map(serializeCoupon);

export { num as decimalToNumber };
