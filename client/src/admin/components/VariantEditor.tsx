import { ProductOption, ProductVariant } from "../../types/types";

/**
 * The variant half of the product form.
 *
 * The operator names the axes and their values — "Size: S, M, L" — and the grid
 * of combinations is generated from them. That is the shape every catalogue tool
 * converged on, and the reason is arithmetic: three sizes in four colours is
 * twelve rows, and asking someone to type twelve rows by hand guarantees a
 * missing one nobody notices until a customer cannot buy it.
 *
 * Generating is explicit rather than automatic on every keystroke, because
 * regenerating discards the prices and stock levels already typed into rows that
 * are about to be recreated. The button says what it will do; an effect would
 * silently undo five minutes of work when someone fixed a typo in an option
 * value.
 */

export type DraftVariant = {
  /** Aligned by index to `options`. */
  optionValues: string[];
  sku: string;
  price: string;
  stock: string;
};

type VariantEditorProps = {
  options: ProductOption[];
  variants: DraftVariant[];
  onOptionsChange: (options: ProductOption[]) => void;
  onVariantsChange: (variants: DraftVariant[]) => void;
  /** Falls back into the generated rows so they are not all blank. */
  basePrice: number;
};

const MAX_OPTIONS = 3;

const key = (values: string[]) => values.join("");

/** Every combination of the option values, in option order. */
const cartesian = (options: ProductOption[]): string[][] =>
  options.reduce<string[][]>(
    (rows, option) => rows.flatMap((row) => option.values.map((v) => [...row, v])),
    [[]]
  );

const VariantEditor = ({
  options,
  variants,
  onOptionsChange,
  onVariantsChange,
  basePrice,
}: VariantEditorProps) => {
  const setOption = (index: number, patch: Partial<ProductOption>) =>
    onOptionsChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  const addOption = () =>
    onOptionsChange([...options, { name: "", values: [] }]);

  const removeOption = (index: number) => {
    const next = options.filter((_, i) => i !== index);
    onOptionsChange(next);
    // The existing rows are aligned by index to the old option list, so they
    // are meaningless the moment one is removed. Clearing is honest; leaving
    // them would submit values against the wrong axis.
    onVariantsChange([]);
    if (next.length === 0) onVariantsChange([]);
  };

  /**
   * Rebuilds the grid, keeping what has already been typed.
   *
   * Rows are matched on their option values, so regenerating after adding a
   * colour keeps every price and stock level already entered and only adds the
   * genuinely new combinations. That is the difference between a button an
   * operator will press and one they learn to avoid.
   */
  const generate = () => {
    const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
    if (usable.length === 0) return;

    const existing = new Map(variants.map((v) => [key(v.optionValues), v]));

    onVariantsChange(
      cartesian(usable).map((optionValues) => {
        const match = existing.get(key(optionValues));
        return (
          match ?? {
            optionValues,
            sku: "",
            // Seeded from the product's own price so a twelve-row grid is not
            // twelve zeroes to correct one at a time.
            price: basePrice > 0 ? String(basePrice) : "",
            stock: "0",
          }
        );
      })
    );
  };

  const setVariant = (index: number, patch: Partial<DraftVariant>) =>
    onVariantsChange(variants.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const usableOptions = options.filter((o) => o.name.trim() && o.values.length > 0);
  const expected = usableOptions.length ? cartesian(usableOptions).length : 0;
  const stale = expected > 0 && expected !== variants.length;

  return (
    <div className="c-variants">
      <p className="c-note">
        Leave this empty for a product sold in one form. Adding an option — Size,
        Colour — turns the price and stock above into a summary: the catalogue
        shows the cheapest variant and the total across them.
      </p>

      {options.map((option, index) => (
        <div className="c-variants__option" key={index}>
          <label>
            <span>Option name</span>
            <input
              className="c-input"
              value={option.name}
              onChange={(e) => setOption(index, { name: e.target.value })}
              placeholder="Size"
            />
          </label>

          <label>
            <span>Values, comma separated</span>
            <input
              className="c-input"
              value={option.values.join(", ")}
              onChange={(e) =>
                setOption(index, {
                  values: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
              placeholder="S, M, L"
            />
          </label>

          <button
            type="button"
            className="c-btn c-btn--ghost"
            onClick={() => removeOption(index)}
          >
            Remove
          </button>
        </div>
      ))}

      <div className="c-variants__actions">
        {options.length < MAX_OPTIONS && (
          <button type="button" className="c-btn c-btn--ghost" onClick={addOption}>
            Add option
          </button>
        )}
        {usableOptions.length > 0 && (
          <button type="button" className="c-btn" onClick={generate}>
            {variants.length ? "Rebuild combinations" : "Generate combinations"}
          </button>
        )}
      </div>

      {/* Says so rather than silently submitting a grid that no longer matches
          the options above — which the server would reject with a message about
          option values, several steps from the cause. */}
      {stale && (
        <p className="c-note is-warning">
          The options have changed since the combinations were built. Rebuild
          them before saving — {expected} expected, {variants.length} present.
        </p>
      )}

      {variants.length > 0 && (
        <table className="c-variants__table">
          <thead>
            <tr>
              {usableOptions.map((o) => (
                <th key={o.name}>{o.name}</th>
              ))}
              <th>SKU</th>
              <th>Price</th>
              <th>Stock</th>
              <th>
                <span className="c-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant, index) => (
              <tr key={key(variant.optionValues)}>
                {variant.optionValues.map((value, i) => (
                  <td key={i}>{value}</td>
                ))}
                <td>
                  <input
                    className="c-input"
                    value={variant.sku}
                    onChange={(e) => setVariant(index, { sku: e.target.value })}
                    placeholder="optional"
                  />
                </td>
                <td>
                  <input
                    className="c-input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={variant.price}
                    onChange={(e) => setVariant(index, { price: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="c-input"
                    type="number"
                    min={0}
                    value={variant.stock}
                    onChange={(e) => setVariant(index, { stock: e.target.value })}
                  />
                </td>
                <td>
                  {/* Removing a combination that has been ordered is refused by
                      the server, which names it — order history has to keep
                      resolving. Setting stock to 0 is the way to retire one. */}
                  <button
                    type="button"
                    className="c-btn c-btn--ghost"
                    onClick={() =>
                      onVariantsChange(variants.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/** Turns a loaded product's variants into editable drafts. */
export const draftsFrom = (variants: ProductVariant[] = []): DraftVariant[] =>
  variants.map((v) => ({
    optionValues: v.optionValues,
    sku: v.sku ?? "",
    price: String(v.price),
    stock: String(v.stock),
  }));

export default VariantEditor;
