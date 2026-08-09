/** The console's only loading affordance, at two sizes. */
const Spinner = ({ full = false }: { full?: boolean }) => (
  <div className={full ? "c-spinner c-spinner--full" : "c-spinner"} role="status">
    <span className="c-spinner__ring" />
    <span className="u-visually-hidden">Loading</span>
  </div>
);

export default Spinner;

/**
 * Placeholder rows for a table or a card that is still loading. Sized to the
 * content it replaces so the layout does not jump when the data lands.
 */
export const SkeletonRows = ({ rows = 6, height = "2.75rem" }: { rows?: number; height?: string }) => (
  <div className="c-skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <span key={i} style={{ height }} />
    ))}
  </div>
);
