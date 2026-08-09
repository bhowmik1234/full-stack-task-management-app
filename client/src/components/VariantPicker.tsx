import { ProductOption, ProductVariant } from "../types/types";

/**
 * The size/colour selector on a product page.
 *
 * Renders one row of buttons per option and marks the values that lead nowhere.
 * "Leads nowhere" is the interesting part: with two options the grid of
 * combinations is usually sparse — a shirt may come in blue in every size but
 * red only in medium — so a picker that offers every value of every option sends
 * people to combinations that were never made, and the only feedback is a
 * disabled Add to cart with no explanation.
 *
 * Values are therefore checked against the variants that are still reachable
 * given the *other* selections, and unreachable ones are disabled with a
 * strikethrough. That is the behaviour every large store converged on, and it is
 * the one that answers "why can't I buy this?" without a sentence.
 *
 * Out-of-stock combinations stay selectable rather than disabled: a customer
 * needs to be able to land on one to be told it is sold out and to ask for a
 * back-in-stock alert. Unreachable and sold-out are different states and the two
 * must not look the same.
 */

type VariantPickerProps = {
  options: ProductOption[];
  variants: ProductVariant[];
  /** One value per option, aligned by index; "" for not yet chosen. */
  selection: string[];
  onChange: (selection: string[]) => void;
};

/** The variant matching a complete selection, or undefined while incomplete. */
export const variantFor = (
  variants: ProductVariant[],
  selection: string[]
): ProductVariant | undefined =>
  variants.find(
    (v) =>
      v.optionValues.length === selection.length &&
      v.optionValues.every((value, index) => value === selection[index])
  );

/**
 * Whether any variant exists with `value` at `optionIndex`, given everything
 * else the customer has already picked.
 *
 * Selections at *other* indices constrain the search; the index being tested
 * does not, or every value would trivially conflict with the current one.
 */
const isReachable = (
  variants: ProductVariant[],
  selection: string[],
  optionIndex: number,
  value: string
) =>
  variants.some(
    (v) =>
      v.optionValues[optionIndex] === value &&
      selection.every(
        (chosen, index) =>
          index === optionIndex || !chosen || v.optionValues[index] === chosen
      )
  );

const VariantPicker = ({ options, variants, selection, onChange }: VariantPickerProps) => {
  if (options.length === 0) return null;

  const choose = (optionIndex: number, value: string) => {
    const next = [...selection];
    next[optionIndex] = value;

    // Picking a value can strand a selection made earlier — choosing red when
    // only medium comes in red leaves "large" selected against a combination
    // that does not exist. Clearing the stranded ones puts the customer one
    // click from a real variant instead of in a state with no Add to cart and
    // nothing indicating which choice to change.
    for (let i = 0; i < next.length; i++) {
      if (i === optionIndex || !next[i]) continue;
      if (!isReachable(variants, next, i, next[i])) next[i] = "";
    }

    onChange(next);
  };

  return (
    <div className="variant-picker">
      {options.map((option, optionIndex) => (
        <fieldset className="variant-picker__group" key={option.name}>
          <legend className="variant-picker__label">
            {option.name}
            {selection[optionIndex] && (
              <span className="variant-picker__chosen">{selection[optionIndex]}</span>
            )}
          </legend>

          <div className="variant-picker__values">
            {option.values.map((value) => {
              const selected = selection[optionIndex] === value;
              const reachable = isReachable(variants, selection, optionIndex, value);

              // A sold-out combination is still worth showing as available to
              // click — see the note at the top.
              const soldOut = variants
                .filter(
                  (v) =>
                    v.optionValues[optionIndex] === value &&
                    selection.every(
                      (chosen, index) =>
                        index === optionIndex || !chosen || v.optionValues[index] === chosen
                    )
                )
                .every((v) => v.stock < 1);

              return (
                <button
                  type="button"
                  key={value}
                  className={[
                    "variant-picker__value",
                    selected ? "is-selected" : "",
                    !reachable ? "is-unavailable" : "",
                    reachable && soldOut ? "is-soldout" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => choose(optionIndex, value)}
                  disabled={!reachable}
                  aria-pressed={selected}
                  // Without this a screen reader announces a disabled button
                  // and nothing about why it is disabled.
                  aria-label={
                    !reachable
                      ? `${value} — not available with your other choices`
                      : soldOut
                        ? `${value} — out of stock`
                        : value
                  }
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
};

export default VariantPicker;
