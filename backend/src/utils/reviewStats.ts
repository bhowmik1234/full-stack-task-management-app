import { prisma } from "./db.js";

export type ReviewStats = { ratings: number; numOfReviews: number };

/**
 * Average rating and review count for a set of products, in one grouped query
 * rather than a per-product count. Products with no reviews are absent from
 * the map; callers fall back to { ratings: 0, numOfReviews: 0 }.
 */
export const reviewStatsFor = async (
  productIds: string[]
): Promise<Map<string, ReviewStats>> => {
  const stats = new Map<string, ReviewStats>();
  if (productIds.length === 0) return stats;

  const rows = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });

  for (const row of rows) {
    stats.set(row.productId, {
      // one decimal is all the UI shows, and it keeps 4.333.. out of the JSON
      ratings: Math.round((row._avg.rating ?? 0) * 10) / 10,
      numOfReviews: row._count._all,
    });
  }

  return stats;
};
