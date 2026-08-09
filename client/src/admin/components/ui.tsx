import { ReactNode } from "react";
import { FiArrowDown, FiArrowUp } from "react-icons/fi";
import { formatINR } from "../../utils/features";

/** Page title, optional subtitle, and a slot for the page's actions. */
export const PageHeader = ({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) => (
  <header className="c-pagehead">
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="c-pagehead__actions">{actions}</div>}
  </header>
);

export const Card = ({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`c-card ${className}`.trim()}>
    {(title || actions) && (
      <div className="c-card__head">
        <div>
          {title && <h2>{title}</h2>}
          {hint && <p>{hint}</p>}
        </div>
        {actions}
      </div>
    )}
    <div className="c-card__body">{children}</div>
  </section>
);

export const EmptyState = ({ children }: { children: ReactNode }) => (
  <p className="c-empty">{children}</p>
);

/**
 * Period-over-period change.
 *
 * The arrow and the sign carry the direction; the colour only reinforces it.
 * `invert` is for measures where down is the good news — an abandonment rate
 * falling is not a decline in the business.
 */
export const Delta = ({ change, invert = false }: { change: number; invert?: boolean }) => {
  if (!Number.isFinite(change) || change === 0)
    return <span className="c-delta c-delta--flat">no change</span>;

  const up = change > 0;
  const good = invert ? !up : up;

  return (
    <span className={`c-delta ${good ? "c-delta--good" : "c-delta--bad"}`}>
      {up ? <FiArrowUp aria-hidden="true" /> : <FiArrowDown aria-hidden="true" />}
      {Math.abs(change)}%
    </span>
  );
};

/**
 * Order status as a labelled pill.
 *
 * "PendingPayment" is a database word — the customer-facing wording lives in
 * utils/features.ts and is reused here so the console and the storefront cannot
 * describe the same order differently.
 */
export const StatusPill = ({ status }: { status: string }) => {
  const tone =
    status === "Delivered"
      ? "good"
      : status === "Shipped"
      ? "warning"
      : status === "Processing"
      ? "info"
      : status === "Cancelled"
      ? "critical"
      : "muted";

  return (
    <span className={`c-pill c-pill--${tone}`}>
      {status === "PendingPayment" ? "Awaiting payment" : status}
    </span>
  );
};

export const PaymentPill = ({ status }: { status?: string }) => {
  const tone =
    status === "Paid"
      ? "good"
      : status === "Refunded"
      ? "info"
      : status === "Failed"
      ? "critical"
      : "muted";

  return <span className={`c-pill c-pill--${tone}`}>{status ?? "Pending"}</span>;
};

/** Money, always through the shared INR formatter — never a hand-written symbol. */
export const Money = ({ value }: { value: number }) => <>{formatINR(value)}</>;

/**
 * Compact money for axis ticks and dense table cells, where the full formatted
 * value is wider than the space it has (₹1,24,500 becomes ₹1.2L).
 */
export const compactINR = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(1)}k`;
  return `₹${Math.round(value)}`;
};
