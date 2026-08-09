import { describe, expect, it } from "vitest";
import { variantFor } from "../VariantPicker";
import { ProductVariant } from "../../types/types";

/**
 * Matching a selection to a variant.
 *
 * This decides what the buy box charges and what it reserves, so a partial
 * match must never resolve — half a selection resolving to *some* variant is how
 * a customer ends up with a size they did not pick.
 */

const variant = (id: string, optionValues: string[]): ProductVariant => ({
  _id: id,
  id,
  sku: "",
  optionValues,
  label: optionValues.join(" / "),
  price: 100,
  stock: 1,
});

const variants = [
  variant("v1", ["Blue", "S"]),
  variant("v2", ["Blue", "M"]),
  variant("v3", ["Red", "M"]),
];

describe("variantFor", () => {
  it("matches a complete selection", () => {
    expect(variantFor(variants, ["Blue", "M"])?.id).toBe("v2");
  });

  it("does not match a partial selection", () => {
    // "" is how the picker represents an option not yet chosen. Resolving here
    // would let the buy box charge for a combination nobody picked.
    expect(variantFor(variants, ["Blue", ""])).toBeUndefined();
  });

  it("does not match an empty selection", () => {
    expect(variantFor(variants, [])).toBeUndefined();
    expect(variantFor(variants, ["", ""])).toBeUndefined();
  });

  it("does not match a combination that was never made", () => {
    expect(variantFor(variants, ["Red", "S"])).toBeUndefined();
  });

  it("is order-sensitive, matching the option order", () => {
    // optionValues are aligned by index to the product's options, so a
    // reversed selection is a different (and absent) combination.
    expect(variantFor(variants, ["M", "Blue"])).toBeUndefined();
  });
});
