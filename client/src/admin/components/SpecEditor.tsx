import { FiPlus, FiX } from "react-icons/fi";
import { ProductSpec } from "../../types/types";

export const emptySpec = (): ProductSpec => ({ group: "General", label: "", value: "" });

/**
 * The product specification table: free group/label/value rows.
 *
 * Free rows rather than fixed columns because a laptop and a torch share almost
 * no attributes. Blank rows are dropped server-side, so there is always a spare
 * one to type into and no "add row" step before the first entry.
 */
const SpecEditor = ({
  specs,
  onChange,
}: {
  specs: ProductSpec[];
  onChange: (specs: ProductSpec[]) => void;
}) => {
  const update = (index: number, patch: Partial<ProductSpec>) =>
    onChange(specs.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)));

  const remove = (index: number) =>
    onChange(specs.length === 1 ? [emptySpec()] : specs.filter((_, i) => i !== index));

  return (
    <div className="c-specs">
      {specs.map((spec, index) => (
        <div key={index} className="c-specs__row">
          <input
            type="text"
            placeholder="Section"
            aria-label={`Section, row ${index + 1}`}
            value={spec.group}
            onChange={(e) => update(index, { group: e.target.value })}
          />
          <input
            type="text"
            placeholder="Label"
            aria-label={`Label, row ${index + 1}`}
            value={spec.label}
            onChange={(e) => update(index, { label: e.target.value })}
          />
          <input
            type="text"
            placeholder="Value"
            aria-label={`Value, row ${index + 1}`}
            value={spec.value}
            onChange={(e) => update(index, { value: e.target.value })}
          />
          <button
            type="button"
            className="c-iconbtn"
            aria-label={`Remove row ${index + 1}`}
            onClick={() => remove(index)}
          >
            <FiX />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="c-btn c-btn--tiny"
        // Carry the last section forward: specs are entered in runs, so the
        // next row is usually in the same section as the one above it.
        onClick={() =>
          onChange([
            ...specs,
            { ...emptySpec(), group: specs[specs.length - 1]?.group || "General" },
          ])
        }
      >
        <FiPlus aria-hidden="true" /> Add row
      </button>
    </div>
  );
};

export default SpecEditor;
