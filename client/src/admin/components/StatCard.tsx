import { ReactNode } from "react";
import { Delta } from "./ui";

/**
 * One headline number.
 *
 * The value is the largest thing in the tile and the change is a caption under
 * it. The previous dashboard drew each percentage as a conic-gradient ring,
 * which encoded a change of +40% and +400% as the same 144° of arc — the ring
 * carried no information the number did not, and misrepresented it.
 */
const StatCard = ({
  label,
  value,
  change,
  hint,
  invertDelta = false,
}: {
  label: string;
  value: ReactNode;
  change?: number;
  hint?: string;
  /** For measures where a fall is the good news (abandonment, refunds). */
  invertDelta?: boolean;
}) => (
  <article className="c-stat">
    <p className="c-stat__label">{label}</p>
    <p className="c-stat__value">{value}</p>
    <p className="c-stat__foot">
      {change !== undefined && <Delta change={change} invert={invertDelta} />}
      {hint && <span className="c-stat__hint">{hint}</span>}
    </p>
  </article>
);

export default StatCard;
