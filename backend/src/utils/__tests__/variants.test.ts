import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/index.js";
import { parseVariantForm, resolveVariant, variantLabel } from "../variants.js";

/**
 * Variants.
 *
 * `parseVariantForm` is the boundary between the admin form and the database,
 * and `resolveVariant` decides what a cart line actually costs — the place where
 * a client bug would otherwise become buying a laptop at a T-shirt's price.
 */

const json = (value: unknown) => JSON.stringify(value);

const OPTIONS = json([{ name: "Size", values: ["S", "M"] }]);
const VARIANTS = json([
  { optionValues: ["S"], price: 100, stock: 3 },
  { optionValues: ["M"], price: 120, stock: 0 },
]);

describe("parseVariantForm", () => {
  it("returns undefined when the form sent nothing", () => {
    // "Leave the variants alone" — so a description edit does not have to
    // resubmit the whole table.
    expect(parseVariantForm(undefined, undefined)).toBeUndefined();
  });

  it("distinguishes 'no variants' from 'not submitted'", () => {
    // An empty options array is how a product stops having variants.
    expect(parseVariantForm(json([]), json([]))).toEqual({ options: [], variants: [] });
  });

  it("parses a well-formed submission", () => {
    const form = parseVariantForm(OPTIONS, VARIANTS)!;
    expect(form.options).toHaveLength(1);
    expect(form.variants).toHaveLength(2);
    expect(form.variants[0].price).toBe(100);
  });

  it("refuses a variant value the option never declared", () => {
    // It would render as a row pickable in no dropdown, holding stock nobody
    // can buy.
    expect(() =>
      parseVariantForm(OPTIONS, json([{ optionValues: ["XL"], price: 1, stock: 1 }]))
    ).toThrow(/not a value of option/i);
  });

  it("refuses a variant with the wrong number of values", () => {
    expect(() =>
      parseVariantForm(OPTIONS, json([{ optionValues: ["S", "Blue"], price: 1, stock: 1 }]))
    ).toThrow(/exactly one value per option/i);
  });

  it("refuses duplicate combinations", () => {
    expect(() =>
      parseVariantForm(
        OPTIONS,
        json([
          { optionValues: ["S"], price: 1, stock: 1 },
          { optionValues: ["S"], price: 2, stock: 2 },
        ])
      )
    ).toThrow(/duplicate variant/i);
  });

  it("refuses two options with the same name, case-insensitively", () => {
    // They would render as two identical dropdowns, and the unique index is
    // case-sensitive so it would not catch this.
    expect(() =>
      parseVariantForm(
        json([
          { name: "Size", values: ["S"] },
          { name: "size", values: ["M"] },
        ]),
        json([{ optionValues: ["S", "M"], price: 1, stock: 1 }])
      )
    ).toThrow(/duplicate option/i);
  });

  it("refuses variants with no options to vary along", () => {
    expect(() =>
      parseVariantForm(json([]), json([{ optionValues: [], price: 1, stock: 1 }]))
    ).toThrow(/require at least one option/i);
  });

  it("refuses options with no variants", () => {
    expect(() => parseVariantForm(OPTIONS, json([]))).toThrow(/at least one variant/i);
  });

  it("refuses malformed JSON rather than throwing a SyntaxError", () => {
    expect(() => parseVariantForm("{ not json", json([]))).toThrow(/valid JSON/i);
  });
});

describe("variantLabel", () => {
  it("joins the values as the customer reads them", () => {
    expect(variantLabel(["Blue", "M"])).toBe("Blue / M");
  });

  it("drops empties rather than leaving a dangling separator", () => {
    expect(variantLabel(["Blue", ""])).toBe("Blue");
  });
});

describe("resolveVariant", () => {
  const dec = (n: number) => new Prisma.Decimal(n);

  const plain = {
    id: "p1",
    name: "Torch",
    price: dec(500),
    stock: 4,
    variants: [],
  };

  const withVariants = {
    id: "p2",
    name: "Shirt",
    price: dec(100),
    stock: 3,
    variants: [
      { id: "v1", optionValues: ["S"], price: dec(100), stock: 3 },
      { id: "v2", optionValues: ["M"], price: dec(120), stock: 0 },
    ],
  };

  it("uses the product's own price when it has no variants", () => {
    const line = resolveVariant(plain, undefined);
    expect(line.variantId).toBeNull();
    expect(line.price.toNumber()).toBe(500);
  });

  it("refuses a variantId on a product that has none", () => {
    expect(() => resolveVariant(plain, "v1")).toThrow(/does not have options/i);
  });

  it("demands a choice for a product that has variants", () => {
    // Without this the rollup minimum would be charged for whichever
    // combination the customer thought they were buying.
    expect(() => resolveVariant(withVariants, undefined)).toThrow(/choose an option/i);
  });

  it("prices from the chosen variant, not the rollup", () => {
    const line = resolveVariant(withVariants, "v2");
    expect(line.price.toNumber()).toBe(120);
    expect(line.stock).toBe(0);
    expect(line.label).toBe("M");
  });

  it("refuses a variant belonging to another product", () => {
    // The id comes from the browser; looking it up within the product's own
    // variants is what stops it pricing against the wrong row.
    expect(() => resolveVariant(withVariants, "someone-elses")).toThrow(
      /no longer available/i
    );
  });
});
