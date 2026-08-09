import { Prisma } from "../generated/prisma/index.js";
import { prisma } from "./db.js";
import ErrorHandler from "./utiliy-class.js";
import { requireAmount, requireInteger, requireString } from "./validate.js";

/**
 * Product variants: the "Blue / M" of a shirt.
 *
 * The representation is deliberately cheap. `ProductOption` holds the axes and
 * their allowed values; `ProductVariant.optionValues` is an array aligned by
 * index to those options in `position` order. Alignment by index is only safe
 * because the two are always rewritten together, in one transaction, by
 * `replaceVariants` — which is the only writer, and is why no endpoint can edit
 * one without the other.
 *
 * The other half of the design is the rollup: `Product.price` stays populated
 * with the cheapest variant and `Product.stock` with the sum. Every list
 * endpoint, the search, the price filter and every analytics aggregation read
 * those two columns, and none of them had to learn what a variant is. A product
 * with no options is untouched by any of this and costs nothing extra.
 */

/** More axes than this is a catalogue modelled wrong, not a product. */
const MAX_OPTIONS = 3;
const MAX_VALUES_PER_OPTION = 30;
/** The cartesian product gets large fast; this is the ceiling on the result. */
const MAX_VARIANTS = 100;

const LIMITS_VARIANT = {
  optionName: 40,
  optionValue: 60,
  sku: 60,
} as const;

export type OptionInput = { name: string; values: string[] };
export type VariantInput = {
  sku?: string;
  optionValues: string[];
  price: number;
  stock: number;
};
export type VariantForm = { options: OptionInput[]; variants: VariantInput[] };

/** "Blue / M" — what the customer sees, and what an OrderItem snapshots. */
export const variantLabel = (optionValues: string[]): string =>
  optionValues.filter(Boolean).join(" / ");

/**
 * Identity of a combination, independent of its row id.
 *
 * `replaceVariants` matches old rows to new ones on this rather than on id,
 * which is what lets an operator edit prices and stock without deleting and
 * recreating rows that order history points at.
 *
 * The separator is the unit separator (U+001F) rather than a space or a slash,
 * because it cannot occur in a value that came through `requireString` — with a
 * printable separator, ["A B"] and ["A", "B"] would collide and two different
 * combinations would be treated as the same row.
 */
const SEPARATOR = "";
const signature = (optionValues: string[]): string => optionValues.join(SEPARATOR);

const parseJsonField = (value: unknown, field: string): unknown => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string")
    throw new ErrorHandler(`${field} must be a JSON string`, 400);
  try {
    return JSON.parse(value);
  } catch {
    throw new ErrorHandler(`${field} must be valid JSON`, 400);
  }
};

/**
 * Validates the variant half of the admin product form.
 *
 * Both fields arrive as JSON strings for the same reason `specs` does: the body
 * is multipart because it carries image uploads, so nested structures cannot be
 * expressed directly.
 *
 * Returns `undefined` when the form sent nothing at all — meaning "leave the
 * variants alone" — and an empty form (`options: []`) meaning "this product has
 * no variants, remove any it had". Collapsing those two would make it
 * impossible either to edit a product's description without resubmitting its
 * variants, or to remove variants once added.
 */
export const parseVariantForm = (
  optionsRaw: unknown,
  variantsRaw: unknown
): VariantForm | undefined => {
  const optionsJson = parseJsonField(optionsRaw, "options");
  const variantsJson = parseJsonField(variantsRaw, "variants");

  if (optionsJson === undefined && variantsJson === undefined) return undefined;

  if (!Array.isArray(optionsJson))
    throw new ErrorHandler("options must be an array", 400);
  if (!Array.isArray(variantsJson))
    throw new ErrorHandler("variants must be an array", 400);

  if (optionsJson.length === 0) {
    // "No options" is the only shape in which variants may be absent, and it
    // must not smuggle any in — a variant with nothing to vary along cannot be
    // selected in the UI and would be unbuyable stock.
    if (variantsJson.length > 0)
      throw new ErrorHandler("variants require at least one option", 400);
    return { options: [], variants: [] };
  }

  if (optionsJson.length > MAX_OPTIONS)
    throw new ErrorHandler(`A product may have at most ${MAX_OPTIONS} options`, 400);

  const seenNames = new Set<string>();
  const options: OptionInput[] = optionsJson.map((row: any) => {
    const name = requireString(row?.name, "option name", LIMITS_VARIANT.optionName);

    // Case-insensitively, because "Size" and "size" render as two identical
    // dropdowns and the unique index would not catch it.
    const key = name.toLowerCase();
    if (seenNames.has(key)) throw new ErrorHandler(`Duplicate option "${name}"`, 400);
    seenNames.add(key);

    if (!Array.isArray(row?.values) || row.values.length === 0)
      throw new ErrorHandler(`Option "${name}" needs at least one value`, 400);
    if (row.values.length > MAX_VALUES_PER_OPTION)
      throw new ErrorHandler(
        `Option "${name}" may have at most ${MAX_VALUES_PER_OPTION} values`,
        400
      );

    const seenValues = new Set<string>();
    const values = row.values.map((v: unknown) => {
      const value = requireString(v, `value of "${name}"`, LIMITS_VARIANT.optionValue);
      if (seenValues.has(value.toLowerCase()))
        throw new ErrorHandler(`Duplicate value "${value}" in "${name}"`, 400);
      seenValues.add(value.toLowerCase());
      return value;
    });

    return { name, values };
  });

  if (variantsJson.length === 0)
    throw new ErrorHandler("A product with options needs at least one variant", 400);
  if (variantsJson.length > MAX_VARIANTS)
    throw new ErrorHandler(`A product may have at most ${MAX_VARIANTS} variants`, 400);

  const seenSignatures = new Set<string>();
  const seenSkus = new Set<string>();

  const variants: VariantInput[] = variantsJson.map((row: any) => {
    if (!Array.isArray(row?.optionValues) || row.optionValues.length !== options.length)
      throw new ErrorHandler("Each variant must give exactly one value per option", 400);

    const optionValues = row.optionValues.map((v: unknown, i: number) => {
      const value = requireString(v, "variant option value", LIMITS_VARIANT.optionValue);
      // A variant whose value is not one the option declares would render as a
      // selector with an unreachable row: pickable in neither dropdown, yet
      // holding stock nobody can buy.
      if (!options[i].values.includes(value))
        throw new ErrorHandler(
          `"${value}" is not a value of option "${options[i].name}"`,
          400
        );
      return value;
    });

    const sig = signature(optionValues);
    if (seenSignatures.has(sig))
      throw new ErrorHandler(`Duplicate variant "${variantLabel(optionValues)}"`, 400);
    seenSignatures.add(sig);

    const sku =
      row.sku === undefined || row.sku === null || row.sku === ""
        ? undefined
        : requireString(row.sku, "sku", LIMITS_VARIANT.sku);

    if (sku) {
      if (seenSkus.has(sku.toLowerCase()))
        throw new ErrorHandler(`Duplicate SKU "${sku}"`, 400);
      seenSkus.add(sku.toLowerCase());
    }

    return {
      sku,
      optionValues,
      price: requireAmount(row.price, "variant price"),
      stock: requireInteger(row.stock, "variant stock"),
    };
  });

  return { options, variants };
};

type Tx = Prisma.TransactionClient;

/**
 * Writes a product's options and variants, replacing whatever was there.
 *
 * Existing variants are matched to submitted ones by their option-value
 * signature, not by id, so editing a price or a stock level updates the row in
 * place. That matters because `OrderItem.variantId` is `onDelete: Restrict` —
 * delete-and-recreate would fail on any product that has ever been sold, which
 * is every product worth editing.
 *
 * A combination that has been ordered and is now missing from the submission is
 * refused with a message naming it, rather than allowed through as a database
 * error. It is the same rule that stops a product with order history being
 * deleted, applied one level down.
 */
export const replaceVariants = async (
  tx: Tx,
  productId: string,
  form: VariantForm
) => {
  const existing = await tx.productVariant.findMany({
    where: { productId },
    select: { id: true, optionValues: true, _count: { select: { orderItems: true } } },
  });

  const bySignature = new Map(existing.map((v) => [signature(v.optionValues), v]));
  const submitted = new Set(form.variants.map((v) => signature(v.optionValues)));

  const doomed = existing.filter((v) => !submitted.has(signature(v.optionValues)));
  const sold = doomed.find((v) => v._count.orderItems > 0);
  if (sold)
    throw new ErrorHandler(
      `"${variantLabel(sold.optionValues)}" has been ordered and cannot be removed. Set its stock to 0 instead.`,
      409
    );

  if (doomed.length)
    await tx.productVariant.deleteMany({
      where: { id: { in: doomed.map((v) => v.id) } },
    });

  // Options are pure definition with nothing referencing them, so the cheap
  // wholesale replace is safe here in a way it is not for variants.
  await tx.productOption.deleteMany({ where: { productId } });
  for (const [position, option] of form.options.entries()) {
    await tx.productOption.create({
      data: { productId, name: option.name, values: option.values, position },
    });
  }

  for (const [position, variant] of form.variants.entries()) {
    const match = bySignature.get(signature(variant.optionValues));
    const data = {
      sku: variant.sku ?? null,
      price: new Prisma.Decimal(variant.price),
      stock: variant.stock,
      position,
    };

    if (match) await tx.productVariant.update({ where: { id: match.id }, data });
    else
      await tx.productVariant.create({
        data: { ...data, productId, optionValues: variant.optionValues },
      });
  }

  await syncVariantRollup(tx, productId);
};

/**
 * Recomputes `Product.price` and `Product.stock` from the product's variants.
 *
 * This is what keeps variants invisible to the rest of the application. Price
 * becomes the cheapest variant, so a card reading "₹1,299" is honestly the
 * lowest price on offer and the catalogue's price sort still means something;
 * stock becomes the sum, so "out of stock" is true exactly when every
 * combination is.
 *
 * A product with no variants is left alone entirely — its columns are the real
 * values, not a rollup, and overwriting them would zero the catalogue.
 *
 * Anything that changes variant stock **must** call this in the same
 * transaction. The rollup has no trigger behind it, so a path that forgets does
 * not fail; it silently drifts, and the first symptom is overselling.
 */
export const syncVariantRollup = async (tx: Tx, productId: string) => {
  const variants = await tx.productVariant.findMany({
    where: { productId },
    select: { price: true, stock: true },
  });

  if (variants.length === 0) return;

  const price = variants.reduce(
    (min, v) => (v.price.lt(min) ? v.price : min),
    variants[0].price
  );
  const stock = variants.reduce((sum, v) => sum + v.stock, 0);

  await tx.product.update({ where: { id: productId }, data: { price, stock } });
};

type ResolvableProduct = {
  id: string;
  name: string;
  price: Prisma.Decimal;
  stock: number;
  variants: {
    id: string;
    optionValues: string[];
    price: Prisma.Decimal;
    stock: number;
  }[];
};

/**
 * The buyable line a cart item refers to.
 *
 * Checkout must not accept a bare productId for a product that has variants:
 * there is no single price to charge and no single pool to reserve from, and
 * the old behaviour would have charged the rollup minimum for whichever
 * combination the customer thought they were buying.
 */
export const resolveVariant = (
  product: ResolvableProduct,
  variantId: string | undefined
) => {
  if (product.variants.length === 0) {
    if (variantId)
      throw new ErrorHandler(`${product.name} does not have options to choose`, 400);
    return { variantId: null, label: "", price: product.price, stock: product.stock };
  }

  if (!variantId)
    throw new ErrorHandler(`Please choose an option for ${product.name}`, 400);

  // Looked up within the product's own variants rather than by id alone: the id
  // comes from the browser, and a variant belonging to another product would
  // otherwise price and reserve against the wrong row — which is how a client
  // bug becomes buying a laptop at a T-shirt's price.
  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant)
    throw new ErrorHandler(`That option is no longer available for ${product.name}`, 404);

  return {
    variantId: variant.id,
    label: variantLabel(variant.optionValues),
    price: variant.price,
    stock: variant.stock,
  };
};

/**
 * Which of these products have variants.
 *
 * One grouped query for a whole page of results, in the same shape and for the
 * same reason as `reviewStatsFor`: the alternative is a count per product.
 *
 * List endpoints need this even though they do not send the variants
 * themselves. A product card's "Add to cart" button has to know whether it can
 * add anything at all — a product with options cannot be bought without one, so
 * the card must send the shopper to the product page instead of adding a line
 * that checkout is going to refuse. One boolean is enough for that; the
 * combinations are still only sent by `GET /product/:id`.
 */
export const productsWithVariants = async (
  productIds: string[]
): Promise<Set<string>> => {
  if (productIds.length === 0) return new Set();

  const rows = await prisma.productVariant.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _count: { _all: true },
  });

  return new Set(rows.map((r) => r.productId));
};
