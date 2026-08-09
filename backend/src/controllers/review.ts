import { Request } from "express";
import { TryCatch } from "../middlewares/error.js";
import { newReviewRequestBody } from "../types/types.js";
import { prisma } from "../utils/db.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { myCache } from "../app.js";
import { invalidateCache } from "../utils/features.js";
import { serializeReviews } from "../utils/serialize.js";
import { LIMITS, optionalString, requireInteger, requireString } from "../utils/validate.js";

// Reviews are attributed, so the reviewer's display identity comes along.
const reviewInclude = {
  user: { select: { id: true, name: true, photo: true } },
} as const;

/**
 * Which of these products the caller has actually bought. Used to mark a
 * review "Verified purchase" — anyone signed in may review, but only real
 * buyers get the badge, and it is derived from order history rather than
 * trusted from the request.
 */
const purchasedProductIds = async (userId: string, productIds: string[]) => {
  if (productIds.length === 0) return new Set<string>();

  const rows = await prisma.orderItem.findMany({
    where: { productId: { in: productIds }, order: { userId } },
    select: { productId: true },
    distinct: ["productId"],
  });

  return new Set(rows.map((r) => r.productId));
};

export const getProductReviews = TryCatch(async (req, res, next) => {
  const productId = String(req.params.id);
  const key = `reviews-${productId}`;

  let reviews;
  if (myCache.has(key)) reviews = JSON.parse(myCache.get(key) as string);
  else {
    const rows = await prisma.review.findMany({
      where: { productId },
      include: reviewInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // One query for the whole page rather than a per-review purchase lookup.
    const buyers = await prisma.orderItem.findMany({
      where: { productId, order: { userId: { in: rows.map((r) => r.userId) } } },
      select: { order: { select: { userId: true } } },
    });
    const verified = new Set(buyers.map((b) => b.order.userId));

    reviews = serializeReviews(rows).map((r: any) => ({
      ...r,
      verified: verified.has(r.userId),
    }));
    myCache.set(key, JSON.stringify(reviews));
  }

  // The rating breakdown the summary bar chart is built from.
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((r: any) => r.rating === stars).length,
  }));

  const numOfReviews = reviews.length;
  const average =
    numOfReviews === 0
      ? 0
      : Math.round(
          (reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / numOfReviews) * 10
        ) / 10;

  return res.status(200).json({
    success: true,
    reviews,
    distribution,
    numOfReviews,
    average,
  });
});

/**
 * Create or edit the caller's review. The unique (productId, userId) index
 * makes "one review per person" a database fact, so this upserts instead of
 * checking-then-inserting, which would race between two tabs.
 */
export const newReview = TryCatch(
  // params stays untyped so the handler matches ControllerTypes, the same
  // shape every other controller in this codebase uses.
  async (req: Request<{}, {}, newReviewRequestBody>, res, next) => {
    const productId = String((req.params as { id?: string }).id);
    const userId = String(req.query.id);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return next(new ErrorHandler("Product Not Found", 404));

    const rating = requireInteger(req.body.rating, "rating", 5);
    if (rating < 1) throw new ErrorHandler("rating must be between 1 and 5", 400);

    const comment = requireString(req.body.comment, "comment", LIMITS.reviewComment);
    const title = optionalString(req.body.title, "title", LIMITS.reviewTitle) ?? "";

    await prisma.review.upsert({
      where: { productId_userId: { productId, userId } },
      create: { productId, userId, rating, title, comment },
      update: { rating, title, comment },
    });

    // The product's average rating is baked into its cached payload and into
    // every list that contains it.
    invalidateCache({ product: true, review: true, productId, admin: true });

    return res.status(201).json({
      success: true,
      message: "Thanks for your review.",
    });
  }
);

export const deleteReview = TryCatch(async (req, res, next) => {
  const productId = String(req.params.id);
  const userId = String(req.query.id);

  // Scoped to the caller's own row, so one user can never delete another's
  // review by guessing an id. Admins go through the same route on their own.
  const { count } = await prisma.review.deleteMany({
    where: { productId, userId },
  });

  if (count === 0) return next(new ErrorHandler("Review Not Found", 404));

  invalidateCache({ product: true, review: true, productId, admin: true });

  return res.status(200).json({
    success: true,
    message: "Review removed.",
  });
});

/**
 * Everything the caller has written, newest first, for the account page.
 *
 * Not cached: it is per-user, read rarely, and `reviews-${productId}` — the key
 * that *is* cached — is keyed by product, so there is nothing here to reuse. It
 * carries the product's name and hero photo because a list of ratings with no
 * indication of what they are about is unusable, and the caller would otherwise
 * fetch each product separately to build it.
 */
export const myReviews = TryCatch(async (req, res) => {
  const userId = req.appUser!.id;

  const rows = await prisma.review.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      product: { select: { id: true, name: true, photo: true } },
    },
  });

  const verified = await purchasedProductIds(
    userId,
    rows.map((r) => r.productId)
  );

  return res.status(200).json({
    success: true,
    reviews: rows.map((r) => ({
      _id: r.id,
      productId: r.productId,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      verified: verified.has(r.productId),
      product: {
        _id: r.product.id,
        name: r.product.name,
        photo: r.product.photo,
      },
    })),
  });
});

/** Whether the caller has bought this product — drives the "Verified" badge. */
export const canReview = TryCatch(async (req, res, next) => {
  const productId = String(req.params.id);
  const userId = String(req.query.id);

  const [purchased, existing] = await Promise.all([
    purchasedProductIds(userId, [productId]),
    prisma.review.findUnique({
      where: { productId_userId: { productId, userId } },
      include: reviewInclude,
    }),
  ]);

  return res.status(200).json({
    success: true,
    purchased: purchased.has(productId),
    review: existing ? serializeReviews([existing])[0] : null,
  });
});
