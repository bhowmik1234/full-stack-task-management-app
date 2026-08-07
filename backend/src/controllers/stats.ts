import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import { Prisma } from "../generated/prisma/index.js";
import { calculatePercentage, getInventories } from "../utils/features.js";
import { decimalToNumber as num } from "../utils/serialize.js";

/**
 * Buckets rows into the last `length` calendar months, newest last — the shape
 * the admin charts expect.
 *
 * This replaces getChartData(), which fetched whole documents and bucketed them
 * in JS. Two things improve: the work happens in the database over an index on
 * createdAt instead of scaling with row count, and the month arithmetic is
 * correct across year boundaries. The old `(thisMonth - thatMonth + 12) % 12`
 * mapped a row from exactly 12 months ago onto the current month's bucket.
 */
const monthlyBuckets = async (
  table: "Product" | "User" | "Order",
  length: number,
  sumColumn?: "total" | "discount"
): Promise<number[]> => {
  const t = Prisma.raw(`"${table}"`);
  const value = sumColumn
    ? Prisma.raw(`COALESCE(SUM("${sumColumn}"), 0)`)
    : Prisma.raw("COUNT(*)");

  const rows = await prisma.$queryRaw<{ month_diff: number; value: number }[]>`
    SELECT
      (
        EXTRACT(YEAR  FROM age(date_trunc('month', now()), date_trunc('month', "createdAt"))) * 12 +
        EXTRACT(MONTH FROM age(date_trunc('month', now()), date_trunc('month', "createdAt")))
      )::int AS month_diff,
      ${value}::float8 AS value
    FROM ${t}
    WHERE "createdAt" >= date_trunc('month', now()) - make_interval(months => ${length - 1})
    GROUP BY 1
  `;

  const data = new Array(length).fill(0);
  for (const r of rows) {
    const idx = length - Number(r.month_diff) - 1;
    if (idx >= 0 && idx < length) data[idx] = Number(r.value);
  }
  return data;
};

export const getDashboardStats = TryCatch(async (req, res, next) => {
  const today = new Date();

  const thisMonth = {
    start: new Date(today.getFullYear(), today.getMonth(), 1),
    end: today,
  };

  const lastMonth = {
    start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
    end: new Date(today.getFullYear(), today.getMonth(), 0),
  };

  const inThisMonth = { createdAt: { gte: thisMonth.start, lte: thisMonth.end } };
  const inLastMonth = { createdAt: { gte: lastMonth.start, lte: lastMonth.end } };

  const [
    thisMonthProducts,
    lastMonthProducts,
    thisMonthUsers,
    lastMonthUsers,
    thisMonthOrders,
    lastMonthOrders,
    thisMonthRevenueAgg,
    lastMonthRevenueAgg,
    productsCount,
    usersCount,
    ordersAgg,
    categoryRows,
    femaleUsersCount,
    latestTransaction,
  ] = await Promise.all([
    prisma.product.count({ where: inThisMonth }),
    prisma.product.count({ where: inLastMonth }),
    prisma.user.count({ where: inThisMonth }),
    prisma.user.count({ where: inLastMonth }),
    prisma.order.count({ where: inThisMonth }),
    prisma.order.count({ where: inLastMonth }),
    prisma.order.aggregate({ _sum: { total: true }, where: inThisMonth }),
    prisma.order.aggregate({ _sum: { total: true }, where: inLastMonth }),
    prisma.product.count(),
    prisma.user.count(),
    // revenue and order count in one pass instead of loading every order
    prisma.order.aggregate({ _sum: { total: true }, _count: { _all: true } }),
    prisma.product.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    // was { gender: "female" } — lowercase never matched the "Female" enum, so
    // this counted 0 and the male/female split was always 100/0
    prisma.user.count({ where: { gender: "Female" } }),
    prisma.order.findMany({
      select: {
        id: true,
        discount: true,
        total: true,
        status: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ]);

  const changePercent = {
    revenue: calculatePercentage(
      num(thisMonthRevenueAgg._sum.total),
      num(lastMonthRevenueAgg._sum.total)
    ),
    product: calculatePercentage(thisMonthProducts, lastMonthProducts),
    user: calculatePercentage(thisMonthUsers, lastMonthUsers),
    order: calculatePercentage(thisMonthOrders, lastMonthOrders),
  };

  const count = {
    revenue: num(ordersAgg._sum.total),
    product: productsCount,
    user: usersCount,
    order: ordersAgg._count._all,
  };

  const [orderMonthCounts, orderMonthyRevenue, categoryCount] = await Promise.all([
    monthlyBuckets("Order", 6),
    monthlyBuckets("Order", 6, "total"),
    getInventories({
      categories: categoryRows.map((c) => c.category),
      productsCount,
    }),
  ]);

  const userRatio = {
    male: usersCount - femaleUsersCount,
    female: femaleUsersCount,
  };

  const modifiedLatestTransaction = latestTransaction.map((i) => ({
    _id: i.id,
    discount: num(i.discount),
    amount: num(i.total),
    quantity: i._count.items,
    status: i.status,
  }));

  const stats = {
    categoryCount,
    changePercent,
    count,
    chart: {
      order: orderMonthCounts,
      revenue: orderMonthyRevenue,
    },
    userRatio,
    latestTransaction: modifiedLatestTransaction,
  };

  return res.status(200).json({
    success: true,
    stats,
  });
});

export const getPieCharts = TryCatch(async (req, res, next) => {
  const [
    statusCounts,
    categoryRows,
    productsCount,
    outOfStock,
    orderTotals,
    adminUsers,
    customerUsers,
    ageGroups,
  ] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.product.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    prisma.product.count(),
    prisma.product.count({ where: { stock: 0 } }),
    // four SUMs in one query, replacing four reduce() passes over every order
    prisma.order.aggregate({
      _sum: {
        total: true,
        discount: true,
        shippingCharges: true,
        tax: true,
      },
    }),
    prisma.user.count({ where: { role: "admin" } }),
    prisma.user.count({ where: { role: "user" } }),
    // `age` was a Mongoose virtual computed per document in JS; Postgres has no
    // virtuals, so the bucketing happens in SQL against dob
    prisma.$queryRaw<{ teen: number; adult: number; old: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE age < 20)::int              AS teen,
        COUNT(*) FILTER (WHERE age >= 20 AND age < 40)::int AS adult,
        COUNT(*) FILTER (WHERE age >= 40)::int              AS old
      FROM (
        SELECT date_part('year', age(dob))::int AS age FROM "User"
      ) s
    `,
  ]);

  const byStatus = (s: string) =>
    statusCounts.find((r) => r.status === s)?._count._all ?? 0;

  const orderFullfillment = {
    processing: byStatus("Processing"),
    shipped: byStatus("Shipped"),
    delivered: byStatus("Delivered"),
  };

  const productCategories = await getInventories({
    categories: categoryRows.map((c) => c.category),
    productsCount,
  });

  const stockAvailablity = {
    inStock: productsCount - outOfStock,
    outOfStock,
  };

  const grossIncome = num(orderTotals._sum.total);
  const discount = num(orderTotals._sum.discount);
  const productionCost = num(orderTotals._sum.shippingCharges);
  const burnt = num(orderTotals._sum.tax);
  const marketingCost = Math.round(grossIncome * (30 / 100));

  const netMargin =
    grossIncome - discount - productionCost - burnt - marketingCost;

  const revenueDistribution = {
    netMargin,
    discount,
    productionCost,
    burnt,
    marketingCost,
  };

  const usersAgeGroup = ageGroups[0] ?? { teen: 0, adult: 0, old: 0 };

  const adminCustomer = {
    admin: adminUsers,
    customer: customerUsers,
  };

  const charts = {
    orderFullfillment,
    productCategories,
    stockAvailablity,
    revenueDistribution,
    usersAgeGroup,
    adminCustomer,
  };

  return res.status(200).json({
    success: true,
    charts,
  });
});

export const getBarCharts = TryCatch(async (req, res, next) => {
  const [productCounts, usersCounts, ordersCounts] = await Promise.all([
    monthlyBuckets("Product", 6),
    monthlyBuckets("User", 6),
    monthlyBuckets("Order", 12),
  ]);

  const charts = {
    users: usersCounts,
    products: productCounts,
    orders: ordersCounts,
  };

  return res.status(200).json({
    success: true,
    charts,
  });
});

export const getLineCharts = TryCatch(async (req, res, next) => {
  const [productCounts, usersCounts, discount, revenue] = await Promise.all([
    monthlyBuckets("Product", 12),
    monthlyBuckets("User", 12),
    monthlyBuckets("Order", 12, "discount"),
    monthlyBuckets("Order", 12, "total"),
  ]);

  const charts = {
    users: usersCounts,
    products: productCounts,
    discount,
    revenue,
  };

  return res.status(200).json({
    success: true,
    charts,
  });
});
