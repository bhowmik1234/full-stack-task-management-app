/**
 * One-shot ETL: MongoDB (Ecommerce_24) -> Postgres.
 *
 *   npx tsx scripts/migrate-mongo-to-postgres.ts            # dry run, reports only
 *   npx tsx scripts/migrate-mongo-to-postgres.ts --commit   # actually writes
 *
 * Requires MONGO_URI and DATABASE_URL in backend/.env. Safe to re-run: every
 * write is an upsert keyed on the original Mongo _id.
 *
 * Insert order follows FK dependencies: users -> products -> coupons ->
 * orders(+items) -> wishlist.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { prisma } from "../src/utils/db.js";

const COMMIT = process.argv.includes("--commit");
const log = (...a: unknown[]) => console.log(...a);
const warn: string[] = [];

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing from .env");

  await mongoose.connect(process.env.MONGO_URI, { dbName: "Ecommerce_24" });
  const db = mongoose.connection.db!;
  log(COMMIT ? "=== COMMIT MODE ===" : "=== DRY RUN (no writes) ===\n");

  const [users, products, coupons, orders, wishlists] = await Promise.all([
    db.collection("users").find({}).toArray(),
    db.collection("products").find({}).toArray(),
    db.collection("coupons").find({}).toArray(),
    db.collection("orders").find({}).toArray(),
    db.collection("wishlists").find({}).toArray(),
  ]);

  const productIds = new Set(products.map((p) => String(p._id)));
  const userIds = new Set(users.map((u) => String(u._id)));

  // ---- users ----
  let userCount = 0;
  for (const u of users) {
    const data = {
      id: String(u._id),
      name: String(u.name),
      email: String(u.email),
      role: u.role === "admin" ? ("admin" as const) : ("user" as const),
      gender: u.gender === "Female" ? ("Female" as const) : ("Male" as const),
      photo: String(u.photo ?? ""),
      dob: new Date(u.dob),
      createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
      updatedAt: u.updatedAt ? new Date(u.updatedAt) : new Date(),
    };
    if (COMMIT)
      await prisma.user.upsert({ where: { id: data.id }, create: data, update: data });
    userCount++;
  }
  log(`users:     ${userCount}/${users.length}`);

  // ---- products ----
  let productCount = 0;
  for (const p of products) {
    let stock = Number(p.stock);
    // CHECK (stock >= 0) rejects negatives. The live data already contains one,
    // left behind by the pre-fix oversell race; clamp it and report loudly.
    if (stock < 0) {
      warn.push(`product ${p._id} (${p.name}) had stock ${stock} -> clamped to 0`);
      stock = 0;
    }
    let price = Number(p.price);
    if (price < 0) {
      warn.push(`product ${p._id} (${p.name}) had price ${price} -> clamped to 0`);
      price = 0;
    }
    const data = {
      id: String(p._id),
      name: String(p.name),
      photo: String(p.photo),
      price,
      stock,
      category: String(p.category).toLocaleLowerCase(),
      createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
      updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
    };
    if (COMMIT)
      await prisma.product.upsert({ where: { id: data.id }, create: data, update: data });
    productCount++;
  }
  log(`products:  ${productCount}/${products.length}`);

  // ---- coupons ----
  let couponCount = 0;
  for (const c of coupons) {
    const data = { id: String(c._id), code: String(c.code), amount: Number(c.amount) };
    if (COMMIT)
      await prisma.coupon.upsert({ where: { code: data.code }, create: data, update: data });
    couponCount++;
  }
  log(`coupons:   ${couponCount}/${coupons.length}`);

  // ---- orders + items ----
  let orderCount = 0;
  let itemCount = 0;
  let skippedOrders = 0;
  for (const o of orders) {
    const uid = String(o.user);
    if (!userIds.has(uid)) {
      warn.push(`order ${o._id} references missing user ${uid} -> SKIPPED`);
      skippedOrders++;
      continue;
    }
    const items = (o.orderItems ?? []).filter((it: any) => {
      const ok = productIds.has(String(it.productId));
      if (!ok)
        warn.push(`order ${o._id} item references missing product ${it.productId} -> item SKIPPED`);
      return ok;
    });

    const si = o.shippingInfo ?? {};
    const data = {
      id: String(o._id),
      userId: uid,
      address: String(si.address ?? ""),
      city: String(si.city ?? ""),
      state: String(si.state ?? ""),
      country: String(si.country ?? ""),
      // was Number in Mongo, which destroys leading zeros; store as text now
      pinCode: String(si.pinCode ?? ""),
      subtotal: Number(o.subtotal ?? 0),
      tax: Number(o.tax ?? 0),
      shippingCharges: Number(o.shippingCharges ?? 0),
      discount: Number(o.discount ?? 0),
      total: Number(o.total ?? 0),
      status: (["Processing", "Shipped", "Delivered"].includes(o.status)
        ? o.status
        : "Processing") as "Processing" | "Shipped" | "Delivered",
      createdAt: o.createdAt ? new Date(o.createdAt) : new Date(),
      updatedAt: o.updatedAt ? new Date(o.updatedAt) : new Date(),
    };

    if (COMMIT) {
      await prisma.$transaction(async (tx) => {
        await tx.order.upsert({ where: { id: data.id }, create: data, update: data });
        await tx.orderItem.deleteMany({ where: { orderId: data.id } });
        for (const it of items) {
          await tx.orderItem.create({
            data: {
              orderId: data.id,
              productId: String(it.productId),
              name: String(it.name),
              photo: String(it.photo),
              price: Number(it.price),
              quantity: Math.max(1, Number(it.quantity) || 1),
            },
          });
        }
      });
    }
    orderCount++;
    itemCount += items.length;
  }
  log(`orders:    ${orderCount}/${orders.length}${skippedOrders ? ` (${skippedOrders} skipped)` : ""}`);
  log(`items:     ${itemCount}`);

  // ---- wishlist: array-per-doc -> row-per-pair ----
  let pairCount = 0;
  let skippedPairs = 0;
  for (const w of wishlists) {
    const uid = String(w.userId);
    if (!userIds.has(uid)) {
      warn.push(`wishlist doc ${w._id} references missing user ${uid} -> SKIPPED`);
      skippedPairs += (w.productId ?? []).length;
      continue;
    }
    // dedupe: the array model allowed the same product twice
    for (const pid of new Set((w.productId ?? []).map(String))) {
      if (!productIds.has(pid as string)) {
        warn.push(`wishlist of ${uid} references missing product ${pid} -> SKIPPED`);
        skippedPairs++;
        continue;
      }
      if (COMMIT)
        await prisma.wishlistItem.upsert({
          where: { userId_productId: { userId: uid, productId: pid as string } },
          create: { userId: uid, productId: pid as string },
          update: {},
        });
      pairCount++;
    }
  }
  log(`wishlist:  ${pairCount} pairs${skippedPairs ? ` (${skippedPairs} skipped)` : ""}`);

  // ---- reconciliation ----
  const mongoTotal = orders.reduce((a, o) => a + (o.total ?? 0), 0);
  log(`\nSUM(total) in mongo:    ${mongoTotal}`);
  if (COMMIT) {
    const agg = await prisma.order.aggregate({ _sum: { total: true } });
    const pgTotal = Number(agg._sum.total ?? 0);
    log(`SUM(total) in postgres: ${pgTotal}`);
    log(pgTotal === mongoTotal ? "MATCH ✓" : "MISMATCH ✗ — investigate before cutover");
  }

  if (warn.length) {
    log(`\n--- ${warn.length} warning(s) ---`);
    warn.forEach((w) => log("  " + w));
  }
  if (!COMMIT) log("\nDry run only. Re-run with --commit to write.");

  await mongoose.disconnect();
  await prisma.$disconnect();
};

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
