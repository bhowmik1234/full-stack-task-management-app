import { ReactNode } from "react";

export type BarItem = {
  id: string;
  label: string;
  /** What the bar length encodes. */
  value: number;
  /** Optional second line under the label, e.g. "12 units". */
  meta?: string;
  /** Overrides the default series colour — used for status rows. */
  color?: string;
  href?: string;
};

/**
 * A ranked list drawn as bars.
 *
 * Top-N by magnitude is the case a chart library handles worst: a horizontal
 * bar chart spends most of its width on an axis nobody reads, truncates the
 * category names, and needs a tooltip to answer "how much". Rows of HTML carry
 * the name and the value as text at full size, sort obviously, stay legible on
 * a phone, and are readable by a screen reader without a table view. The bar is
 * there to make the shape of the distribution visible at a glance — it is the
 * secondary encoding, not the only one.
 */
const BarList = ({
  items,
  format,
}: {
  items: BarItem[];
  format: (value: number) => ReactNode;
}) => {
  // Scale to the largest row, not to the total: the question is "how do these
  // compare with each other", and scaling to the sum flattens everything when
  // the list is long.
  const max = Math.max(...items.map((i) => i.value), 0);

  return (
    <ol className="c-barlist">
      {items.map((item) => (
        <li key={item.id}>
          <div className="c-barlist__row">
            <span className="c-barlist__label">
              {item.href ? <a href={item.href}>{item.label}</a> : item.label}
              {item.meta && <small>{item.meta}</small>}
            </span>
            <span className="c-barlist__value">{format(item.value)}</span>
          </div>
          <div className="c-barlist__track">
            <span
              className="c-barlist__fill"
              style={{
                // A hairline stays visible for a non-zero row that would
                // otherwise round away to nothing.
                width: max > 0 ? `${Math.max((item.value / max) * 100, 1.5)}%` : "0%",
                background: item.color,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
};

export default BarList;
