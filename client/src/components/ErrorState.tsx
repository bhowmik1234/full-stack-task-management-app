import { FaExclamationTriangle } from "react-icons/fa";

/**
 * "This failed to load", as distinct from "you have nothing here".
 *
 * Every list page in the storefront used to collapse the two: on an error the
 * query's `data` stays undefined, `?? []` turns that into an empty array, and
 * the page renders its empty state. So a customer with twenty orders was told
 * "No orders yet — start shopping", and a wishlist with items in it read
 * "Nothing saved yet". Both are confident, wrong, and send the reader off to
 * fix a problem they do not have.
 *
 * It borrows `.empty-state` for its layout on purpose — the shape is right and
 * the two panels appear in the same slots — but says a different thing and
 * offers the one action that can actually help.
 */
const ErrorState = ({
  title = "We couldn't load this",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  /** Omitted where there is nothing sensible to re-run. */
  onRetry?: () => void;
}) => (
  <div className="empty-state" role="alert">
    <FaExclamationTriangle />
    <h2>{title}</h2>
    <p>{message}</p>
    {onRetry && (
      <button type="button" className="btn" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export default ErrorState;
