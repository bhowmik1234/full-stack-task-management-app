import { myCache } from "../app.js";
import { prisma } from "./db.js";
import { Prisma } from "../generated/prisma/index.js";
import { InvalidateCacheProps, OrderItemType } from "../types/types.js";
import { UploadApiResponse, v2 as cloudinary } from "cloudinary";
import ErrorHandler from "./utiliy-class.js";
import { LIMITS, requireString } from "./validate.js";
import { suggestCache } from "./suggestCache.js";
import { discountFor } from "./coupons.js";
import { pricingConfig, shippingFeeFor, taxFor } from "./pricing.js";
import { resolveVariant } from "./variants.js";

// Cap the cart so one request can't fan out into thousands of product lookups
// inside a transaction.
const MAX_CART_ITEMS = 50;
const MAX_QUANTITY_PER_ITEM = 100;

export const invalidateCache = ({
    product,
    order,
    wishlist,
    admin,
    userId,
    orderId,
    productId,
    review,
  }: InvalidateCacheProps) => {
    if (product) {
      const productKeys: string[] = [
        "latest-products",
        "categories",
        "all-products",
      ];
      if (typeof productId === "string") productKeys.push(`product-${productId}`);

      if (typeof productId === "object")
        productId.forEach((i) => productKeys.push(`product-${i}`));

      // "You may also like" is the same problem in a different shape: adding,
      // editing or deleting one product changes the rail of every *other*
      // product in its category or brand, so the key that has to go is never
      // `related-${productId}`. Dropping them all is one pass over a
      // catalogue-sized key list and cannot miss one.
      productKeys.push(
        ...myCache.keys().filter((k) => k.startsWith("related-"))
      );

      myCache.del(productKeys);

      // Suggestions are keyed by search term, so there is no set of keys to
      // name here the way there is above — any term at all might have matched
      // the product that just changed. Flushing the whole (small, 60s-TTL)
      // cache is both correct and cheaper than working out which terms hit it.
      suggestCache.flushAll();
    }
    if (order) {
      const ordersKeys: string[] = [
        "all-orders",
        `my-orders-${userId}`,
        `order-${orderId}`,
      ];

      myCache.del(ordersKeys);
    }

    if(wishlist){
      myCache.del(`wishlist-${userId}`);
    }

    // A new review changes the product's average rating, which is embedded in
    // every cached product payload — so callers pass { review: true, product:
    // true, productId } and both the review list and the product drop out.
    if (review) {
      const reviewKeys: string[] = [];
      if (typeof productId === "string") reviewKeys.push(`reviews-${productId}`);
      if (typeof productId === "object")
        productId.forEach((i) => reviewKeys.push(`reviews-${i}`));

      myCache.del(reviewKeys);
    }
    if (admin) {
      myCache.del([
        "admin-stats",
        "admin-pie-charts",
        "admin-bar-charts",
        "admin-line-charts",
      ]);
    }
  };

  /**
   * Any client that can run queries — the global `prisma` or a transaction
   * handle. Order placement passes the transaction handle so pricing and the
   * stock reservation observe the same snapshot.
   */
  type Db = Prisma.TransactionClient | typeof prisma;

  /**
   * Reserves stock for each item.
   *
   * `updateMany` with `stock: { gte: quantity }` in the WHERE clause makes the
   * check and the decrement a single atomic statement, so two concurrent
   * checkouts cannot both pass for the last unit — the loser matches zero rows.
   * Called inside a transaction, so a throw rolls back every prior decrement
   * automatically; no compensating logic is needed.
   */
  export const reduceStock = async (tx: Db, orderItems: OrderItemType[]) => {
    for (const item of orderItems) {
      if (item.variantId) {
        // The variant owns the real inventory; the product's column is a
        // rollup. Both move by the same amount in the same transaction, which
        // keeps the rollup exact without a recount — and matters because every
        // list endpoint and the "out of stock" badge read the rollup, not this
        // row.
        const { count } = await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });

        if (count === 0)
          throw new ErrorHandler(
            `Insufficient stock for ${item.name} (${item.variantLabel})`,
            409
          );

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
        continue;
      }

      const { count } = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });

      if (count === 0)
        throw new ErrorHandler(`Insufficient stock for ${item.name}`, 409);
    }
  };

  /**
   * Puts reserved units back — the inverse of reduceStock.
   *
   * Used when a PendingPayment order expires unpaid, when an order is
   * cancelled or refunded, and when an admin deletes one. Deleting an order
   * used to drop the row without ever restoring stock, so the units simply
   * vanished from inventory.
   *
   * Callers must only reach here for an order with `stockReserved = true`, and
   * must clear that flag in the same transaction; that flag, not this function,
   * is what makes a double restore impossible.
   */
  export const restoreStock = async (
    tx: Db,
    orderItems: { productId: string; quantity: number; variantId?: string | null }[]
  ) => {
    for (const item of orderItems) {
      // Mirror of reduceStock: put the units back where they came from, and
      // move the rollup with them. A variant deleted since the order was placed
      // cannot happen — OrderItem.variantId is onDelete: Restrict — so this
      // does not have to cope with a dangling id.
      if (item.variantId) {
        await tx.productVariant.updateMany({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.product.updateMany({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
  };

  // Re-derives prices/totals from the DB rather than trusting client-supplied
  // numbers, so a tampered request can't pay/order below the real price.
  export const calculateOrderAmounts = async (
    cartItems: { productId: string; quantity: number; variantId?: string }[],
    couponCode: string | undefined,
    // Needed for the coupon's per-customer limit. It is the uid the guard
    // resolved, never anything from the body — a caller who could name the
    // customer could spend everyone else's allowance of a one-per-person code.
    userId: string,
    db: Db = prisma,
    // Shipping can depend on the destination and COD can carry a fee, so both
    // are inputs to the total. Defaulted so the cart's preview — which knows
    // neither yet — gets the same answer it always did.
    options: { state?: string; paymentMethod?: "Razorpay" | "COD" } = {}
  ) => {
    if (!Array.isArray(cartItems) || cartItems.length === 0)
      throw new ErrorHandler("Cart is empty", 400);

    if (cartItems.length > MAX_CART_ITEMS)
      throw new ErrorHandler(`A cart may hold at most ${MAX_CART_ITEMS} items`, 400);

    let subtotal = new Prisma.Decimal(0);
    const orderItems: OrderItemType[] = [];
    const seen = new Set<string>();

    for (const item of cartItems) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY_PER_ITEM)
        throw new ErrorHandler("Invalid item quantity", 400);

      const productId = requireString(item.productId, "productId", LIMITS.userId);
      const variantId =
        item.variantId === undefined || item.variantId === null || item.variantId === ""
          ? undefined
          : requireString(item.variantId, "variantId", LIMITS.userId);

      // Duplicated lines would each pass the stock pre-check independently and
      // only be caught later by reduceStock; reject them up front. Keyed on the
      // *variant* where there is one — two sizes of the same shirt are two
      // legitimate lines, and deduplicating on productId alone would refuse the
      // most ordinary multi-variant cart there is.
      const key = variantId ?? productId;
      if (seen.has(key)) throw new ErrorHandler("Duplicate item in cart", 400);
      seen.add(key);

      const product = await db.product.findUnique({
        where: { id: productId },
        include: { variants: true },
      });
      if (!product) throw new ErrorHandler("Product Not Found", 404);

      // Decides what is actually being bought: the product itself, or one of
      // its combinations. Refuses a missing choice and a variant belonging to
      // another product, so price and stock below are always the right row's.
      const line = resolveVariant(product, variantId);

      // fail before the customer is charged rather than at order creation;
      // reduceStock re-checks this atomically when the order is placed
      if (line.stock < quantity)
        throw new ErrorHandler(
          `Insufficient stock for ${product.name}${line.label ? ` (${line.label})` : ""}`,
          409
        );

      subtotal = subtotal.add(line.price.mul(quantity));
      orderItems.push({
        name: product.name,
        photo: product.photo,
        price: Number(line.price),
        quantity,
        productId: product.id,
        variantId: line.variantId,
        variantLabel: line.label,
      });
    }

    // Tax and shipping now come from utils/pricing.ts rather than from literals
    // here that had to be kept in step with the client's cartReducer by hand.
    // The defaults reproduce the old numbers exactly (18% / ₹200 / free over
    // ₹1000), so nothing about an unconfigured deploy changes.
    const config = pricingConfig();
    const tax = taxFor(subtotal, config);
    const shippingCharges = shippingFeeFor(subtotal, options.state, config);

    // Authoritative coupon check: same rules as the cart's preview, but against
    // a subtotal this function derived from the product rows rather than one
    // the browser reported. A code that expired, hit its cap, or does not reach
    // its minimum between the cart page and this call is refused here.
    let discount = await discountFor(db, couponCode, userId, subtotal);

    // Handling charge for cash on delivery. Folded into shipping rather than
    // given a column of its own: it is a delivery cost, the customer reads it
    // on the same line, and an extra money column would have to be added to
    // every total, every email and every export that already agree.
    const codFee =
      options.paymentMethod === "COD"
        ? new Prisma.Decimal(config.cod.fee)
        : new Prisma.Decimal(0);
    const shippingTotal = shippingCharges.add(codFee);

    // a coupon larger than the order must not produce a negative total
    const maxDiscount = subtotal.add(tax).add(shippingTotal);
    if (discount.gt(maxDiscount)) discount = maxDiscount;

    const total = subtotal.add(tax).add(shippingTotal).sub(discount);

    return {
      orderItems,
      subtotal: Number(subtotal),
      tax: Number(tax),
      shippingCharges: Number(shippingTotal),
      discount: Number(discount),
      total: Number(total),
    };
  };

  // calculatePercentage / getInventories / getChartData lived here to serve the
  // old /dashboard/{stats,pie,bar,line} endpoints. controllers/stats.ts now does
  // its bucketing and its period-over-period maths in SQL, so nothing called
  // them any more.

  const getBase64 = (file: Express.Multer.File) =>
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

  export const uploadToCloudinary = async (files: Express.Multer.File[]) => {
    const promises = files.map(async (file) => {
      return new Promise<UploadApiResponse>((resolve, reject) => {
        cloudinary.uploader.upload(getBase64(file), (error, result) => {
          if (error) return reject(error);
          resolve(result!);
        });
      });
    });

    const result = await Promise.all(promises);

    return result.map((i) => ({
      public_id: i.public_id,
      url: i.secure_url,
    }));
  };


export const deleteFromCloudinary = async (publicIds: string[]) => {
  const promises = publicIds.map((id) => {
    return new Promise<void>((resolve, reject) => {
      cloudinary.uploader.destroy(id, (error, result) => {
        if (error) return reject(error);
        resolve();
      });
    });
  });

  await Promise.all(promises);
};
