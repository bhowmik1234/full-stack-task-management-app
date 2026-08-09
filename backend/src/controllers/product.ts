import { Request } from "express";
import { TryCatch } from "../middlewares/error.js";
import { newProductRequestBody, searchRequestQuery } from "../types/types.js";
import { prisma } from "../utils/db.js";
import { Prisma } from "../generated/prisma/index.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { rm } from "fs";
import { myCache } from "../app.js";
import { invalidateCache } from "../utils/features.js";
import { recordAudit } from "../utils/audit.js";
import { serializeProduct, serializeProducts } from "../utils/serialize.js";
import { reviewStatsFor } from "../utils/reviewStats.js";
import { rememberSuggestion, suggestCache } from "../utils/suggestCache.js";
import { allUploadedFiles } from "../middlewares/multer.js";
import {
  parseVariantForm,
  productsWithVariants,
  replaceVariants,
} from "../utils/variants.js";
import {
  LIMITS,
  assertRealImage,
  optionalString,
  parseSpecs,
  requireAmount,
  requireInteger,
  requireString,
} from "../utils/validate.js";


/** Files posted as `photo` (hero) and `photos` (gallery), from productUpload. */
const uploadedImages = (req: Request) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    photo: files?.photo?.[0],
    gallery: files?.photos ?? [],
  };
};

const removeFiles = (paths: (string | undefined)[]) => {
  for (const path of paths) if (path) rm(path, () => {});
};

export const newProduct = TryCatch(
  async (req: Request<{}, {}, newProductRequestBody>, res, next) => {
    const { photo, gallery } = uploadedImages(req);
    const everyFile = allUploadedFiles(req.files as any).map((f) => f.path);

    if (!photo) return next(new ErrorHandler("Please add photo", 400));

    // Any rejection past this point must not leave the uploaded files behind.
    let fields;
    try {
      // multer trusts the client's Content-Type; this checks the actual bytes.
      // Every gallery file gets the same treatment as the hero.
      for (const file of [photo, ...gallery]) await assertRealImage(file.path);

      fields = {
        name: requireString(req.body.name, "name", LIMITS.name),
        category: requireString(req.body.category, "category", LIMITS.category),
        price: requireAmount(req.body.price, "price"),
        stock: requireInteger(req.body.stock, "stock"),
        description:
          optionalString(req.body.description, "description", LIMITS.description) ?? "",
        brand: optionalString(req.body.brand, "brand", LIMITS.brand) ?? "",
        highlights:
          optionalString(req.body.highlights, "highlights", LIMITS.bulletList) ?? "",
        inTheBox:
          optionalString(req.body.inTheBox, "inTheBox", LIMITS.bulletList) ?? "",
        warranty:
          optionalString(req.body.warranty, "warranty", LIMITS.bulletList) ?? "",
        specs: parseSpecs(req.body.specs) ?? [],
        variants: parseVariantForm(req.body.options, req.body.variants),
      };
    } catch (error) {
      removeFiles(everyFile);
      return next(error as ErrorHandler);
    }

    const variantForm = fields.variants;
    const hasVariants = Boolean(variantForm && variantForm.options.length > 0);

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
      data: {
        name: fields.name,
        category: fields.category.toLocaleLowerCase(),
        // For a product with variants these two are a rollup that
        // `syncVariantRollup` overwrites a moment later; the submitted values
        // are still written first so the row is never momentarily invalid
        // against the non-negative CHECK constraints.
        price: fields.price,
        stock: fields.stock,
        description: fields.description,
        brand: fields.brand,
        highlights: fields.highlights,
        inTheBox: fields.inTheBox,
        warranty: fields.warranty,
        photo: photo.path,
        images: {
          create: gallery.map((file, index) => ({
            url: file.path,
            position: index,
          })),
        },
        specs: {
          create: fields.specs.map((spec, index) => ({ ...spec, position: index })),
        },
      },
      });

      // Same transaction as the product row: a product whose options were
      // rejected halfway through would be listed at a price and stock level
      // that belong to no variant anyone can buy.
      if (variantForm && variantForm.options.length > 0)
        await replaceVariants(tx, created.id, variantForm);

      return created;
    });

    invalidateCache({ product: true, admin: true });

    recordAudit(req, {
      action: "product.create",
      targetId: product.id,
      summary: `Created "${product.name}" — ₹${product.price} · ${product.stock} in stock${
        hasVariants ? ` · ${variantForm!.variants.length} variants` : ""
      }`,
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully.",
    });
  }
);

export const getlatestProducts = TryCatch(async (req, res, next) => {
  let products;

  if(myCache.has("latest-products")){
    products = JSON.parse(myCache.get("latest-products")!);
  }
  else{
    const rows = await prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    // one grouped query for the whole page of cards, not one per product
    const stats = await reviewStatsFor(rows.map((r) => r.id));
    const withVariants = await productsWithVariants(rows.map((r) => r.id));
    products = serializeProducts(rows, stats, withVariants);
    myCache.set("latest-products", JSON.stringify(products));
  }

  return res.status(200).json({
    success: true,
    products,
  });
});

export const getAllCategories = TryCatch(async (req, res, next) => {
  let categories;

  if (myCache.has("categories"))
    categories = JSON.parse(myCache.get("categories") as string);
  else {
    const rows = await prisma.product.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    categories = rows.map((r) => r.category);
    myCache.set("categories", JSON.stringify(categories));
  }

  return res.status(200).json({
    success: true,
    categories,
  });
});

/** Longest term worth matching; also the cache-key length bound. */
const SUGGEST_MAX_TERM = 60;
const SUGGEST_PRODUCT_LIMIT = 8;
const SUGGEST_CATEGORY_LIMIT = 4;

/**
 * `%` and `_` are LIKE wildcards and `\` escapes them, so a term containing any
 * of the three would otherwise change the *shape* of the pattern rather than
 * being searched for. A lone `%` would match the entire catalogue.
 */
const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Type-ahead for the header search box.
 *
 * Separate from `getAllProducts` rather than a flag on it, because the two want
 * genuinely different queries. A results page needs pagination, a total count,
 * price/category filters and star ratings; a dropdown needs eight rows and
 * nothing else. In particular this does **not** call `reviewStatsFor` — that is
 * a second grouped query over the Review table, and it exists to draw stars the
 * dropdown does not render. One query per keystroke instead of two.
 *
 * The `WHERE` is an infix ILIKE, which is answered from the GIN trigram indexes
 * added in the add_search_trigram_indexes migration. `lower()` is applied here
 * to match those index expressions exactly — a bare `ILIKE` would not use them.
 */
export const suggestProducts = TryCatch(async (req, res) => {
  const raw = optionalString(req.query.q, "q", SUGGEST_MAX_TERM);
  const term = raw?.toLowerCase() ?? "";

  // One character matches almost everything, so the payload is large and the
  // result useless. The client enforces this too; this is the backstop.
  if (term.length < 2)
    return res.status(200).json({ success: true, products: [], categories: [] });

  const key = `suggest-${term}`;
  const cached = suggestCache.get(key);
  if (cached) return res.status(200).json({ success: true, ...(cached as object) });

  const pattern = `%${escapeLike(term)}%`;
  const prefix = `${escapeLike(term)}%`;

  // Parameterised — `term` is user input going into raw SQL, and interpolating
  // it would be an injection. $queryRaw's tagged-template form binds it.
  const products = await prisma.$queryRaw<
    { id: string; name: string; photo: string; category: string }[]
  >`
    SELECT "id", "name", "photo", "category"
    FROM "Product"
    -- ILIKE, not lower(...) LIKE, so this shares the raw-column trigram
    -- indexes with getAllProducts instead of needing a second expression
    -- index of its own. pg_trgm answers ILIKE from a gin_trgm_ops index
    -- directly. The ORDER BY below still lowercases, but ordering a handful
    -- of already-selected rows uses no index either way.
    WHERE "name" ILIKE ${pattern} ESCAPE '\\'
       OR "brand" ILIKE ${pattern} ESCAPE '\\'
    ORDER BY
      -- What the shopper started typing beats what merely contains it, so
      -- "lap" offers "Laptop Pro" before "Gaming Laptop".
      (lower("name") LIKE ${prefix} ESCAPE '\\') DESC,
      similarity(lower("name"), ${term}) DESC,
      "name" ASC
    LIMIT ${SUGGEST_PRODUCT_LIMIT}
  `;

  // Categories come from the list getAllCategories already caches rather than
  // a second query — it is a handful of short strings and it is in memory
  // almost always, so matching them costs nothing.
  let categories: string[];
  if (myCache.has("categories"))
    categories = JSON.parse(myCache.get("categories") as string);
  else {
    const rows = await prisma.product.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    categories = rows.map((r) => r.category);
    myCache.set("categories", JSON.stringify(categories));
  }

  const payload = {
    // No price column is selected at all. The dropdown shows a thumbnail and a
    // name, and `price` is a Decimal that would otherwise have to be converted
    // at this boundary to avoid serializing as {"s":..,"e":..,"d":[..]} — work
    // for a value nothing renders.
    products: products.map((p) => ({
      _id: p.id,
      name: p.name,
      photo: p.photo,
      category: p.category,
    })),
    categories: categories
      .filter((c) => c.toLowerCase().includes(term))
      .slice(0, SUGGEST_CATEGORY_LIMIT),
  };

  rememberSuggestion(key, payload);

  return res.status(200).json({ success: true, ...payload });
});

export const getAdminProducts = TryCatch(async (req, res, next) => {
  let products;
  if (myCache.has("all-products"))
    products = JSON.parse(myCache.get("all-products") as string);
  else {
    const rows = await prisma.product.findMany();
    const stats = await reviewStatsFor(rows.map((r) => r.id));
    const withVariants = await productsWithVariants(rows.map((r) => r.id));
    products = serializeProducts(rows, stats, withVariants);
    myCache.set("all-products", JSON.stringify(products));
  }

  return res.status(200).json({
    success: true,
    products,
  });
});

export const getSingleProduct = TryCatch(async (req, res, next) => {
  let product;
  const id = String(req.params.id);
  if (myCache.has(`product-${id}`))
    product = JSON.parse(myCache.get(`product-${id}`) as string);
  else {
    const row = await prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: "asc" } },
        specs: { orderBy: { position: "asc" } },
        // Only the product page needs these, for the same reason it is the only
        // endpoint that includes the gallery: a card renders a hero image and a
        // "from" price, and shipping every combination to the search results
        // would multiply that payload by the size of the catalogue.
        options: { orderBy: { position: "asc" } },
        variants: { orderBy: { position: "asc" } },
      },
    });

    if (!row) return next(new ErrorHandler("Product Not Found", 404));

    const stats = await reviewStatsFor([row.id]);
    product = serializeProduct(row, stats.get(row.id));
    myCache.set(`product-${id}`, JSON.stringify(product));
  }

  return res.status(200).json({
    success: true,
    product,
  });
});

/** Enough to fill the rail and give it something to scroll. */
const RELATED_LIMIT = 10;

/**
 * "You may also like", on the product page.
 *
 * Replaces a rail that was fed by `getlatestProducts` — the five newest
 * products site-wide, filtered client-side to drop the current one. Nothing
 * about that was related to anything, and because the exclusion happened after
 * the server had already picked five, the rail quietly rendered four whenever
 * the product being viewed was among the newest.
 *
 * Relevance is a score in SQL rather than a sequence of queries, so one pass
 * over an indexed candidate set answers the whole thing:
 *
 *   3 — same category *and* same brand
 *   2 — same category
 *   1 — same brand
 *
 * then most-reviewed, then newest. Both legs are indexed (`Product_category_idx`
 * and `Product_brand_idx`).
 *
 * What this deliberately is *not* is "customers who bought this also bought".
 * That is the better signal and it is a straightforward self-join on OrderItem
 * — but it needs purchase history to be dense enough to have seen the pair, and
 * on a young catalogue it returns nothing for almost every product, which reads
 * as broken rather than as empty. The endpoint's shape does not change when
 * that day comes; only the ranking inside it does.
 */
export const getRelatedProducts = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);
  const key = `related-${id}`;

  if (myCache.has(key))
    return res.status(200).json({
      success: true,
      products: JSON.parse(myCache.get(key) as string),
    });

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, category: true, brand: true },
  });
  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  // `brand` defaults to "" and most rows still have it empty, so an unguarded
  // `brand = $brand` would match every brandless product in the catalogue and
  // call them related. The empty string has to mean "no brand to match on",
  // not "matches everything without a brand".
  const brand = product.brand?.trim() ?? "";
  const hasBrand = brand.length > 0;

  const rows = await prisma.$queryRaw<any[]>`
    SELECT p.*
    FROM "Product" p
    LEFT JOIN (
      SELECT "productId", COUNT(*)::int AS cnt
      FROM "Review"
      GROUP BY "productId"
    ) r ON r."productId" = p."id"
    WHERE p."id" <> ${id}
      AND (
        p."category" = ${product.category}
        OR (${hasBrand}::boolean AND p."brand" = ${brand})
      )
    ORDER BY
      (CASE
         WHEN ${hasBrand}::boolean AND p."category" = ${product.category} AND p."brand" = ${brand} THEN 3
         WHEN p."category" = ${product.category} THEN 2
         ELSE 1
       END) DESC,
      COALESCE(r.cnt, 0) DESC,
      p."createdAt" DESC
    LIMIT ${RELATED_LIMIT}
  `;

  // A product in a category of one would otherwise leave the rail empty. Top
  // up with recent arrivals only after the genuinely related ones — never
  // instead of them, which is what the old rail did.
  if (rows.length < RELATED_LIMIT) {
    const seen = [id, ...rows.map((r) => r.id)];
    const filler = await prisma.product.findMany({
      where: { id: { notIn: seen } },
      orderBy: { createdAt: "desc" },
      take: RELATED_LIMIT - rows.length,
    });
    rows.push(...filler);
  }

  // Bounded to RELATED_LIMIT ids, and the rail does render stars — unlike the
  // search dropdown, this one earns the second query.
  const stats = await reviewStatsFor(rows.map((r) => r.id));
  const withVariants = await productsWithVariants(rows.map((r) => r.id));
  const products = serializeProducts(rows, stats, withVariants);

  myCache.set(key, JSON.stringify(products));

  return res.status(200).json({ success: true, products });
});

export const updateProduct = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);
  const { photo, gallery } = uploadedImages(req);
  const everyFile = allUploadedFiles(req.files as any).map((f) => f.path);

  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: true },
  });

  if (!product) {
    removeFiles(everyFile);
    return next(new ErrorHandler("Product Not Found", 404));
  }

  const data: Prisma.ProductUpdateInput = {};
  let variantForm: ReturnType<typeof parseVariantForm>;

  try {
    const { price, stock } = req.body;

    // undefined means "leave the variants alone" and an empty options array
    // means "this product has no variants any more". Collapsing the two would
    // make it impossible either to edit a description without resubmitting the
    // whole variant table, or to remove variants once added.
    variantForm = parseVariantForm(req.body.options, req.body.variants);

    const name = optionalString(req.body.name, "name", LIMITS.name);
    const category = optionalString(req.body.category, "category", LIMITS.category);
    const description = optionalString(
      req.body.description,
      "description",
      LIMITS.description
    );

    if (name) data.name = name;
    if (category) data.category = category.toLocaleLowerCase();
    if (price != null && price !== "") data.price = requireAmount(price, "price");
    if (stock != null && stock !== "") data.stock = requireInteger(stock, "stock");
    // Sent but empty means "clear the field", so these check presence rather
    // than truthiness.
    if (req.body.description !== undefined) data.description = description ?? "";

    if (req.body.brand !== undefined)
      data.brand = optionalString(req.body.brand, "brand", LIMITS.brand) ?? "";
    if (req.body.highlights !== undefined)
      data.highlights =
        optionalString(req.body.highlights, "highlights", LIMITS.bulletList) ?? "";
    if (req.body.inTheBox !== undefined)
      data.inTheBox =
        optionalString(req.body.inTheBox, "inTheBox", LIMITS.bulletList) ?? "";
    if (req.body.warranty !== undefined)
      data.warranty =
        optionalString(req.body.warranty, "warranty", LIMITS.bulletList) ?? "";

    // Submitting specs replaces the whole set — the admin form always posts
    // the complete table, so a removed row has to disappear.
    const specs = parseSpecs(req.body.specs);
    if (specs)
      data.specs = {
        deleteMany: {},
        create: specs.map((spec, index) => ({ ...spec, position: index })),
      };

    for (const file of [photo, ...gallery]) {
      if (file) await assertRealImage(file.path);
    }
    if (photo) data.photo = photo.path;
  } catch (error) {
    removeFiles(everyFile);
    return next(error as ErrorHandler);
  }

  // only remove the previous files once the new ones are known good
  if (photo) {
    rm(product.photo, () => {
      console.log("Old Photo Deleted");
    });
  }

  // Uploading gallery images replaces the existing gallery rather than
  // appending, so the admin form's file input is the whole gallery.
  if (gallery.length > 0) {
    removeFiles(product.images.map((i) => i.url));
    data.images = {
      deleteMany: {},
      create: gallery.map((file, index) => ({ url: file.path, position: index })),
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data });

    if (variantForm) {
      // `replaceVariants` finishes by recomputing the rollup, so a price or
      // stock also submitted in this request is overwritten by the derived
      // value — which is correct: for a product with variants those columns are
      // not editable facts, they are a summary of the table below them.
      //
      // Submitting no options at all is how a product stops having variants:
      // every existing one is then "not in the submission", so the same call
      // removes them — and refuses if any has been ordered, rather than
      // orphaning order history. `syncVariantRollup` leaves `price`/`stock`
      // alone once there are no variants left, so the values submitted with
      // this request become the product's own again.
      await replaceVariants(tx, product.id, variantForm);
    }
  });

  invalidateCache({
    product: true,
    productId: product.id,
    admin: true,
  });

  // `data` holds exactly the fields the request actually changed, so the
  // summary says what was touched rather than listing the whole form.
  recordAudit(req, {
    action: "product.update",
    targetId: product.id,
    summary: `Updated "${product.name}" — changed ${
      Object.keys(data).join(", ") || "nothing"
    }`,
  });

  return res.status(200).json({
    success: true,
    message: "Product Updated Successfully",
  });
});

export const deleteProduct = TryCatch(async (req, res, next) => {
  const product = await prisma.product.findUnique({
    where: { id: String(req.params.id) },
    include: { images: true },
  });
  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  // OrderItem holds an FK with onDelete: Restrict so order history can't be
  // orphaned. Under Mongo this deleted the product and left past orders
  // pointing at nothing.
  const ordered = await prisma.orderItem.count({
    where: { productId: product.id },
  });
  if (ordered > 0)
    return next(
      new ErrorHandler(
        "Cannot delete a product that appears in existing orders",
        400
      )
    );

  rm(product.photo, () => {
    console.log("Product Photo Deleted");
  });
  // ProductImage, Review, ProductOption and ProductVariant rows all cascade;
  // the image files do not. The variants are safe to cascade here only because
  // of the check above — every OrderItem carrying a variantId also carries the
  // product's id, so "appears in existing orders" already covers them.
  removeFiles(product.images.map((i) => i.url));

  await prisma.product.delete({ where: { id: product.id } });

  invalidateCache({
    product: true,
    productId: product.id,
    admin: true,
  });

  recordAudit(req, {
    action: "product.delete",
    targetId: product.id,
    summary: `Deleted "${product.name}"`,
  });

  return res.status(200).json({
    success: true,
    message: "Product Deleted Successfully",
  });
});


export const getAllProducts = TryCatch(
  async (req: Request<{}, {}, {}, searchRequestQuery>, res, next) => {
    const { sort } = req.query;

    // clamped: a negative page produces a negative OFFSET, and an unbounded
    // one lets a client walk the table with cheap requests
    const page = Math.min(Math.max(Math.trunc(Number(req.query.page)) || 1, 1), 10_000);
    const limit = Number(process.env.PRODUCT_PER_PAGE) || 8;
    const skip = (page - 1) * limit;

    const search = optionalString(req.query.search, "search", LIMITS.name);
    const category = optionalString(req.query.category, "category", LIMITS.category);
    const price = req.query.price ? requireAmount(req.query.price, "price") : undefined;

    const where: Prisma.ProductWhereInput = {};

    // `mode: "insensitive"` emits ILIKE, which a trigram GIN index on the raw
    // column answers directly — see the realign_search_trigram_indexes
    // migration. It previously could not: the only trigram indexes were on
    // `lower("name")`, and a predicate has to match an expression index
    // exactly, so this endpoint sequentially scanned Product on every search
    // while the type-ahead over the same column used an index. Nothing looked
    // wrong because both returned the right rows.
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (price !== undefined) where.price = { lte: price };
    if (category) where.category = category.toLocaleLowerCase();

    const [rows, filteredCount] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: sort ? { price: sort === "asc" ? "asc" : "desc" } : undefined,
        take: limit,
        skip,
      }),
      // COUNT in the database instead of fetching every matching row to
      // measure the length of the result
      prisma.product.count({ where }),
    ]);

    const totalPage = Math.ceil(filteredCount / limit);

    // Two independent grouped queries over the same id list, so they go
    // together. Awaiting them in sequence made every catalogue page pay two
    // round trips to the database where one would do.
    const ids = rows.map((r) => r.id);
    const [stats, withVariants] = await Promise.all([
      reviewStatsFor(ids),
      productsWithVariants(ids),
    ]);

    return res.status(200).json({
      success: true,
      products: serializeProducts(rows, stats, withVariants),
      totalPage,
    });
  }
);


/**
 * "Tell me when this is back."
 *
 * Upserts for the same reason the wishlist does — the composite primary key
 * makes a duplicate impossible, so this is one statement rather than a
 * check-then-insert that two tabs can race.
 *
 * Asking again after being notified re-arms the alert: `notifiedAt` is reset to
 * null on update. That is the behaviour someone pressing the button a second
 * time is asking for, and without it the row would sit answered forever and the
 * button would do nothing while appearing to work.
 */
export const watchStock = TryCatch(async (req, res, next) => {
  const userId = req.appUser!.id;
  const productId = String(req.params.id);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, stock: true },
  });
  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  // Nothing to wait for. Told plainly rather than silently recording a request
  // that the next sweep would immediately answer with "it is back!" for
  // something the customer is looking at in stock.
  if (product.stock > 0)
    return next(new ErrorHandler("This product is already in stock", 409));

  await prisma.stockAlert.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: { notifiedAt: null },
  });

  return res.status(200).json({
    success: true,
    message: "We will email you when this is back in stock.",
  });
});

/** Cancels a pending request. Scoped by the caller's own uid, never a body. */
export const unwatchStock = TryCatch(async (req, res) => {
  await prisma.stockAlert.deleteMany({
    where: { userId: req.appUser!.id, productId: String(req.params.id) },
  });

  return res.status(200).json({ success: true, message: "Alert removed." });
});

/** Whether the caller is waiting on this product, so the button renders right. */
export const myStockAlert = TryCatch(async (req, res) => {
  const alert = await prisma.stockAlert.findUnique({
    where: {
      userId_productId: { userId: req.appUser!.id, productId: String(req.params.id) },
    },
    select: { notifiedAt: true },
  });

  return res.status(200).json({
    success: true,
    // A row that has already been notified is not an outstanding request.
    watching: Boolean(alert && !alert.notifiedAt),
  });
});

export const addToWishList = TryCatch(async (req, res, next) => {
  const { id: userId } = req.query;
  const productId = String(req.params.id);

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if(!product) return next(new ErrorHandler("Product Not Found", 404));

  // One row per (user, product) with a composite primary key. The old model
  // pushed onto an array in a single document, which meant read-modify-write
  // and a lost-update race between two tabs; upsert here is a single statement
  // and duplicates are impossible by construction.
  await prisma.wishlistItem.upsert({
    where: {
      userId_productId: { userId: String(userId), productId },
    },
    create: { userId: String(userId), productId },
    update: {},
  });

  invalidateCache({ wishlist: true, userId: String(userId) });

  return res.status(200).json({
    success: true,
    message: "Added to wishList.",
  });
});

export const myWishList = TryCatch(async(req, res, next)=>{
  const {id} = req.query;
  const key = `wishlist-${id}`;
  let products;
  if(myCache.has(key)){
    products = JSON.parse(myCache.get(key) as string);
  }
  else{
    // one join instead of N findById round-trips; the FK guarantees the
    // product still exists, so no null-filtering is needed
    const rows = await prisma.wishlistItem.findMany({
      where: { userId: String(id) },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
    const stats = await reviewStatsFor(rows.map((r) => r.productId));
    const withVariants = await productsWithVariants(rows.map((r) => r.productId));
    products = serializeProducts(rows.map((r) => r.product), stats, withVariants);
    myCache.set(key, JSON.stringify(products));
  }


  return res.status(200).json({
    success: true,
    message: "your wishlist",
    WishList: products
  });

})

export const deleteWishList = TryCatch(async(req, res, next)=>{
  const { id: userId } = req.query;
  const productId = String(req.params.id);

  const { count } = await prisma.wishlistItem.deleteMany({
    where: { userId: String(userId), productId },
  });

  if (count === 0) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found or product not in wishlist',
    });
  }

  invalidateCache({wishlist: true, userId: String(userId)});
  return res.status(200).json({
    success: true,
    message: "Removed from wishlist",
  });

})
