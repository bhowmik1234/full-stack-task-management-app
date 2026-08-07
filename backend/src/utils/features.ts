import { myCache } from "../app.js";
import { prisma } from "./db.js";
import { Prisma } from "../generated/prisma/index.js";
import { InvalidateCacheProps, OrderItemType } from "../types/types.js";
import { UploadApiResponse, v2 as cloudinary } from "cloudinary";

export const invalidateCache = ({
    product,
    order,
    wishlist,
    admin,
    userId,
    orderId,
    productId,
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

      myCache.del(productKeys);
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
      const { count } = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });

      if (count === 0) throw new Error(`Insufficient stock for ${item.name}`);
    }
  };

  // Re-derives prices/totals from the DB rather than trusting client-supplied
  // numbers, so a tampered request can't pay/order below the real price.
  export const calculateOrderAmounts = async (
    cartItems: { productId: string; quantity: number }[],
    couponCode?: string,
    db: Db = prisma
  ) => {
    if (!Array.isArray(cartItems) || cartItems.length === 0)
      throw new Error("Cart is empty");

    let subtotal = new Prisma.Decimal(0);
    const orderItems: OrderItemType[] = [];

    for (const item of cartItems) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0)
        throw new Error("Invalid item quantity");

      const product = await db.product.findUnique({
        where: { id: String(item.productId) },
      });
      if (!product) throw new Error("Product Not Found");

      // fail before the customer is charged rather than at order creation;
      // reduceStock re-checks this atomically when the order is placed
      if (product.stock < quantity)
        throw new Error(`Insufficient stock for ${product.name}`);

      subtotal = subtotal.add(product.price.mul(quantity));
      orderItems.push({
        name: product.name,
        photo: product.photo,
        price: Number(product.price),
        quantity,
        productId: product.id,
      });
    }

    // matches the client's cartReducer.calculatePrice exactly: 18% tax,
    // ₹200 shipping waived above ₹1000 subtotal
    const tax = new Prisma.Decimal(Math.round(subtotal.mul(0.18).toNumber()));
    const shippingCharges = new Prisma.Decimal(subtotal.gt(1000) ? 0 : 200);

    let discount = new Prisma.Decimal(0);
    if (couponCode) {
      const coupon = await db.coupon.findUnique({ where: { code: couponCode } });
      if (!coupon) throw new Error("Invalid Coupon Code");
      discount = coupon.amount;
    }

    // a coupon larger than the order must not produce a negative total
    const maxDiscount = subtotal.add(tax).add(shippingCharges);
    if (discount.gt(maxDiscount)) discount = maxDiscount;

    const total = subtotal.add(tax).add(shippingCharges).sub(discount);

    return {
      orderItems,
      subtotal: Number(subtotal),
      tax: Number(tax),
      shippingCharges: Number(shippingCharges),
      discount: Number(discount),
      total: Number(total),
    };
  };

  export const calculatePercentage = (thisMonth: number, lastMonth: number) => {
    if (lastMonth === 0) return thisMonth * 100;
    const percent = (thisMonth / lastMonth) * 100;
    return Number(percent.toFixed(0));
  };

  export const getInventories = async ({
    categories,
    productsCount,
  }: {
    categories: string[];
    productsCount: number;
  }) => {
    const grouped = await prisma.product.groupBy({
      by: ["category"],
      _count: { _all: true },
    });

    const countByCategory = new Map(
      grouped.map((g) => [g.category, g._count._all])
    );

    return categories.map((category) => ({
      [category]: productsCount
        ? Math.round(((countByCategory.get(category) ?? 0) / productsCount) * 100)
        : 0,
    }));
  };

  type FuncProps = {
    length: number;
    docArr: any;
    today: Date;
    property?: string;
  };

  export const getChartData = ({
    length,
    docArr,
    today,
    property,
  }: FuncProps) => {
    const data: number[] = new Array(length).fill(0);

    docArr.forEach((i:any) => {
      const creationDate = i.createdAt;
      const monthDiff = (today.getMonth() - creationDate.getMonth() + 12) % 12;

      if (monthDiff < length) {
        if (property) {
          data[length - monthDiff - 1] += Number(i[property] ?? 0);
        } else {
          data[length - monthDiff - 1] += 1;
        }
      }
    });

    return data;
  };


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
