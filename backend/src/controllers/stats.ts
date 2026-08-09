import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import { Prisma } from "../generated/prisma/index.js";
import ErrorHandler from "../utils/utiliy-class.js";

/**
 * What counts as "running low", in units.
 *
 * Read lazily rather than at module scope for the reason `ADMIN_URL` and the
 * mail senders document: ESM evaluates imports before `app.ts` calls `config()`,
 * so a module-level read sees `undefined` on any `.env`-based deploy and the
 * setting silently reverts to the default on exactly the deploys that changed
 * it. Five is right for a shop selling furniture and useless for one selling
 * pens, so it is configurable.
 */
export const LOW_STOCK_THRESHOLD = (): number => {
  const raw = Number(process.env.LOW_STOCK_THRESHOLD);
  return Number.isInteger(raw) && raw >= 0 ? raw : 5;
};

/**
 * The admin console's analytics.
 *
 * One endpoint, one round of queries, one time window — replacing the four
 * separate stats/pie/bar/line endpoints, which each re-answered "how did the
 * last six months go" in a slightly different way and could disagree with each
 * other on screen. Everything below is a SQL aggregation: nothing loads rows
 * to count them in JS, and nothing is cached, because a dashboard that is five
 * minutes stale is worse than one that costs a few indexed aggregates.
 *
 * Two filters run through the whole file and they are not interchangeable:
 *
 *   PLACED — status <> 'PendingPayment'. A real order. Checkout writes the row
 *            before the customer pays, so an unfiltered count is inflated by
 *            every abandoned cart. A cancelled order was still placed.
 *   PAID   — paymentStatus = 'Paid'. Money received and not returned. This, and
 *            only this, is revenue.
 *
 * Both are attributed by `createdAt` (when checkout opened) rather than
 * `placedAt` (when the money landed). They differ by the minutes a customer
 * spends in the Razorpay modal, which only matters for orders that straddle
 * midnight; using one column throughout means the series, the KPIs and the
 * breakdowns can never disagree about which bucket an order belongs to.
 */

const PLACED = Prisma.sql`"status" <> 'PendingPayment'`;
const PAID = Prisma.sql`"paymentStatus" = 'Paid'`;

/** Windows the console offers. Anything else is rejected rather than defaulted. */
const RANGES = {
  "7d": { unit: "day" as const, points: 7 },
  "30d": { unit: "day" as const, points: 30 },
  "90d": { unit: "day" as const, points: 90 },
  "12m": { unit: "month" as const, points: 12 },
};

type RangeKey = keyof typeof RANGES;

const isRangeKey = (v: unknown): v is RangeKey =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(RANGES, v);

/**
 * Resolves a range key to the two windows every KPI is measured over: the
 * current one and the one immediately before it, of identical length, so
 * "+12% vs previous period" compares like with like.
 */
const resolveWindow = (key: RangeKey) => {
  const { unit, points } = RANGES[key];
  const now = new Date();
  const start = new Date(now);

  if (unit === "day") {
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (points - 1));
  } else {
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    start.setMonth(start.getMonth() - (points - 1));
  }

  // Same length again, ending where the current window begins.
  const span = now.getTime() - start.getTime();
  const previousStart = new Date(start.getTime() - span);

  return { unit, points, start, end: now, previousStart, previousEnd: start };
};

/** `Infinity`-free growth: no prior activity is "new", not a division by zero. */
const changePercent = (current: number, previous: number) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

type WindowTotals = {
  revenue: number;
  orders: number;
  paid_orders: number;
  checkouts: number;
  units: number;
};

/** Every headline number for one window, in a single pass over the index. */
const windowTotals = async (from: Date, to: Date): Promise<WindowTotals> => {
  const [row] = await prisma.$queryRaw<WindowTotals[]>`
    SELECT
      COALESCE(SUM(o."total") FILTER (WHERE ${PAID}), 0)::float8 AS revenue,
      COUNT(*) FILTER (WHERE ${PLACED})::int                     AS orders,
      COUNT(*) FILTER (WHERE ${PAID})::int                       AS paid_orders,
      COUNT(*)::int                                              AS checkouts,
      COALESCE((
        SELECT SUM(oi."quantity")
        FROM "OrderItem" oi
        JOIN "Order" po ON po.id = oi."orderId"
        WHERE po."paymentStatus" = 'Paid'
          AND po."createdAt" >= ${from} AND po."createdAt" < ${to}
      ), 0)::int                                                 AS units
    FROM "Order" o
    WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
  `;

  return row ?? { revenue: 0, orders: 0, paid_orders: 0, checkouts: 0, units: 0 };
};

/**
 * The trend line, one row per bucket including the empty ones.
 *
 * `generate_series` is what puts the zeros in: grouping orders alone would drop
 * quiet days entirely and the chart would draw a straight line between the two
 * days either side of a gap, which reads as steady trade rather than none.
 */
const bucketSeries = async (
  unit: "day" | "month",
  points: number,
  start: Date
) => {
  const trunc = Prisma.raw(`'${unit}'`);
  const step = Prisma.raw(`'1 ${unit}'::interval`);
  const offset = Prisma.raw(
    unit === "day" ? `make_interval(days => ${points - 1})` : `make_interval(months => ${points - 1})`
  );

  return prisma.$queryRaw<
    { bucket: Date; revenue: number; orders: number }[]
  >`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${trunc}, now()) - ${offset},
        date_trunc(${trunc}, now()),
        ${step}
      ) AS bucket
    )
    SELECT
      b.bucket                                                        AS bucket,
      COALESCE(SUM(o."total") FILTER (WHERE o."paymentStatus" = 'Paid'), 0)::float8 AS revenue,
      COUNT(o.id) FILTER (WHERE o."status" <> 'PendingPayment')::int  AS orders
    FROM buckets b
    LEFT JOIN "Order" o
      ON date_trunc(${trunc}, o."createdAt") = b.bucket
     AND o."createdAt" >= ${start}
    GROUP BY b.bucket
    ORDER BY b.bucket
  `;
};

export const getAnalytics = TryCatch(async (req, res, next) => {
  const key = req.query.range ?? "30d";
  if (!isRangeKey(key))
    return next(new ErrorHandler("Unknown range", 400));

  const { unit, points, start, end, previousStart, previousEnd } =
    resolveWindow(key);

  const [
    current,
    previous,
    series,
    newCustomers,
    previousNewCustomers,
    topProducts,
    topCategories,
    fulfilment,
    buyers,
    lowStock,
    recentOrders,
    catalogue,
    lowStockCount,
    outOfStockCount,
  ] = await Promise.all([
    windowTotals(start, end),
    windowTotals(previousStart, previousEnd),
    bucketSeries(unit, points, start),
    prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.user.count({
      where: { createdAt: { gte: previousStart, lt: previousEnd } },
    }),

    // Revenue per product, from the OrderItem snapshot rather than the current
    // Product row: `price` there is what was actually paid, and re-reading it
    // from Product would restate history every time someone edits a price.
    prisma.$queryRaw<
      { productId: string; name: string; photo: string; units: number; revenue: number }[]
    >`
      SELECT oi."productId"                              AS "productId",
             MAX(oi."name")                              AS name,
             MAX(oi."photo")                             AS photo,
             SUM(oi."quantity")::int                     AS units,
             SUM(oi."price" * oi."quantity")::float8     AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."paymentStatus" = 'Paid'
        AND o."createdAt" >= ${start} AND o."createdAt" < ${end}
      GROUP BY oi."productId"
      ORDER BY revenue DESC
      LIMIT 8
    `,

    prisma.$queryRaw<{ category: string; units: number; revenue: number }[]>`
      SELECT p."category"                                AS category,
             SUM(oi."quantity")::int                     AS units,
             SUM(oi."price" * oi."quantity")::float8     AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o   ON o.id = oi."orderId"
      JOIN "Product" p ON p.id = oi."productId"
      WHERE o."paymentStatus" = 'Paid'
        AND o."createdAt" >= ${start} AND o."createdAt" < ${end}
      GROUP BY p."category"
      ORDER BY revenue DESC
      LIMIT 8
    `,

    prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { createdAt: { gte: start, lt: end }, status: { not: "PendingPayment" } },
    }),

    // Repeat rate, scoped to the window: of the people who bought in this
    // period, how many bought more than once in it.
    prisma.$queryRaw<{ buyers: number; repeat_buyers: number }[]>`
      SELECT COUNT(*)::int                          AS buyers,
             COUNT(*) FILTER (WHERE n > 1)::int     AS repeat_buyers
      FROM (
        SELECT "userId", COUNT(*) AS n
        FROM "Order"
        WHERE "paymentStatus" = 'Paid'
          AND "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY "userId"
      ) s
    `,

    prisma.product.findMany({
      where: { stock: { lte: LOW_STOCK_THRESHOLD() } },
      select: { id: true, name: true, photo: true, stock: true, price: true },
      orderBy: [{ stock: "asc" }, { name: "asc" }],
      take: 8,
    }),

    prisma.order.findMany({
      where: { status: { not: "PendingPayment" } },
      select: {
        id: true,
        total: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        user: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),

    prisma.product.aggregate({
      _count: { _all: true },
      _sum: { stock: true },
    }),

    // The list above is capped at 8 so the panel stays a panel. These are the
    // real totals behind it — without them "8 products are low" is all the
    // dashboard can say, whether the true number is 8 or 800, and the operator
    // has no way to tell which. Out-of-stock is counted separately because it
    // is a different job: low stock is something to reorder, zero stock is a
    // product the shop is currently advertising and cannot sell.
    prisma.product.count({ where: { stock: { lte: LOW_STOCK_THRESHOLD(), gt: 0 } } }),
    prisma.product.count({ where: { stock: 0 } }),
  ]);

  const aov = (w: WindowTotals) =>
    w.paid_orders === 0 ? 0 : Number((w.revenue / w.paid_orders).toFixed(2));

  // Of the checkouts opened in this window, how many were paid for. This is a
  // checkout-completion rate, not a visit-to-order rate — the app has no
  // sessions table, so the funnel starts where an order row does.
  const conversion = (w: WindowTotals) =>
    w.checkouts === 0 ? 0 : Number(((w.paid_orders / w.checkouts) * 100).toFixed(1));

  const kpi = (value: number, prior: number) => ({
    value,
    previous: prior,
    change: changePercent(value, prior),
  });

  const byStatus = (s: string) =>
    fulfilment.find((f) => f.status === s)?._count._all ?? 0;

  const { buyers: buyerCount = 0, repeat_buyers: repeatBuyers = 0 } = buyers[0] ?? {};
  const abandoned = current.checkouts - current.paid_orders;

  return res.status(200).json({
    success: true,
    range: key,
    granularity: unit,
    window: { start, end },
    kpis: {
      revenue: kpi(current.revenue, previous.revenue),
      orders: kpi(current.orders, previous.orders),
      aov: kpi(aov(current), aov(previous)),
      conversion: kpi(conversion(current), conversion(previous)),
      customers: kpi(newCustomers, previousNewCustomers),
      units: kpi(current.units, previous.units),
    },
    series: series.map((row) => ({
      bucket: row.bucket,
      revenue: Number(row.revenue),
      orders: Number(row.orders),
    })),
    topProducts: topProducts.map((p) => ({
      _id: p.productId,
      name: p.name,
      photo: p.photo,
      units: Number(p.units),
      revenue: Number(p.revenue),
    })),
    topCategories: topCategories.map((c) => ({
      category: c.category,
      units: Number(c.units),
      revenue: Number(c.revenue),
    })),
    fulfilment: {
      processing: byStatus("Processing"),
      shipped: byStatus("Shipped"),
      delivered: byStatus("Delivered"),
      cancelled: byStatus("Cancelled"),
    },
    checkouts: {
      started: current.checkouts,
      paid: current.paid_orders,
      abandoned,
      abandonRate:
        current.checkouts === 0
          ? 0
          : Number(((abandoned / current.checkouts) * 100).toFixed(1)),
    },
    customers: {
      buyers: buyerCount,
      repeatBuyers,
      repeatRate:
        buyerCount === 0
          ? 0
          : Number(((repeatBuyers / buyerCount) * 100).toFixed(1)),
      newInRange: newCustomers,
    },
    inventory: {
      products: catalogue._count._all,
      units: catalogue._sum.stock ?? 0,
      // The threshold is reported alongside the counts so the console can label
      // the panel with the number it actually used, rather than hardcoding "5"
      // and being wrong on any deploy that configured something else.
      lowStockThreshold: LOW_STOCK_THRESHOLD(),
      lowStockCount,
      outOfStockCount,
      lowStock: lowStock.map((p) => ({
        _id: p.id,
        name: p.name,
        photo: p.photo,
        stock: p.stock,
        price: Number(p.price),
      })),
    },
    recentOrders: recentOrders.map((o) => ({
      _id: o.id,
      customer: o.user.name,
      items: o._count.items,
      total: Number(o.total),
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    })),
  });
});

/**
 * The admin action trail (see utils/audit.ts). Paged by offset rather than by
 * cursor: the console shows the most recent few hundred entries and nothing
 * walks the whole table.
 */
export const getActivity = TryCatch(async (req, res, next) => {
  const limitParam = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(limitParam)
    ? Math.min(Math.max(limitParam, 1), 100)
    : 50;

  const offsetParam = Number(req.query.offset ?? 0);
  const offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  const [entries, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.adminAuditLog.count(),
  ]);

  return res.status(200).json({
    success: true,
    total,
    entries: entries.map((e) => ({ ...e, _id: e.id })),
  });
});
