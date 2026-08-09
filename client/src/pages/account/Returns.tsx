import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { FiRotateCcw } from "react-icons/fi";
import { RootState } from "../../redux/store";
import { useMyReturnsQuery } from "../../redux/api/returnsAPI";
import { Skeleton } from "../../components/Loader";
import ErrorState from "../../components/ErrorState";
import { queryErrorMessage } from "../../utils/errors";
import Seo from "../../components/Seo";
import { formatINR } from "../../utils/features";
import { ReturnStatus } from "../../types/types";

/**
 * Every return the customer has opened, across every order.
 *
 * The per-order view already shows an order's own returns; this exists because
 * "where is my refund?" is a question about money, not about an order — the
 * customer usually remembers the item, rarely the order number, and would
 * otherwise have to open orders one at a time looking for it.
 */

/**
 * What each status means to the person waiting.
 *
 * Written as sentences rather than left as bare status names because
 * "Received" tells a warehouse something and tells a customer nothing — the
 * useful information is whether they still have to do anything.
 */
const EXPLANATION: Record<ReturnStatus, string> = {
  Requested: "We are reviewing this. Please do not post anything back yet.",
  Approved: "Approved — please send the items back using the details we emailed you.",
  Received: "We have the items and are checking them. Your refund follows shortly.",
  Refunded: "Refunded. Allow 5–7 working days for it to reach your account.",
  Rejected: "We were not able to accept this return.",
  Cancelled: "You withdrew this request.",
};

const Returns = () => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const { data, isLoading, isError, error, refetch } = useMyReturnsQuery(
    user?._id ?? "",
    { skip: !user?._id }
  );

  const returns = data?.returns ?? [];

  if (isLoading) {
    return (
      <div className="account-section">
        <Skeleton length={5} height="3rem" />
      </div>
    );
  }

  // `isError` was not even destructured here, so a failed load fell straight
  // through to the empty state below. Of all the places this happened it is the
  // one with money attached: a customer chasing a refund was shown a page
  // saying they had never returned anything.
  if (isError) {
    return (
      <div className="account-section">
        <ErrorState
          title="Couldn't load your returns"
          message={queryErrorMessage(error)}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="account-section">
      <Seo title="Your returns" noIndex />

      <header className="account-section__head">
        <h1>Returns</h1>
        <p>Items you have sent back, and where each refund has got to.</p>
      </header>

      {returns.length === 0 ? (
        <div className="empty-state">
          <FiRotateCcw />
          <h2>No returns yet</h2>
          <p>
            To send something back, open the order it came in and choose
            &ldquo;Return items&rdquo;.
          </p>
          <Link to="/orders" className="btn">
            Go to your orders
          </Link>
        </div>
      ) : (
        <ul className="returns-list">
          {returns.map((request) => (
            <li key={request._id} className="card">
              <div className="returns-list__head">
                <div>
                  <Link to={`/orders/${request.orderId}`}>
                    Order #{request.orderId.slice(-8).toUpperCase()}
                  </Link>
                  <span className="returns-list__date">
                    Requested{" "}
                    {new Date(request.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <span className={`badge badge--${request.status.toLowerCase()}`}>
                  {request.status}
                </span>
              </div>

              <p className="returns-list__explain">{EXPLANATION[request.status]}</p>

              <ul className="returns-list__items">
                {request.items.map((item) => (
                  <li key={item._id}>
                    {item.photo && (
                      <img
                        src={`${import.meta.env.VITE_SERVER}/${item.photo}`}
                        alt={item.name ?? ""}
                      />
                    )}
                    <span>
                      {item.name ?? "Item"}
                      {item.variantLabel ? ` · ${item.variantLabel}` : ""} ×{" "}
                      {item.quantity}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="returns-list__meta">
                <div>
                  <dt>Reason</dt>
                  <dd>{request.reason}</dd>
                </div>
                {request.refundAmount !== null && (
                  <div>
                    <dt>Refunded</dt>
                    <dd>{formatINR(request.refundAmount)}</dd>
                  </div>
                )}
              </dl>

              {/* The operator's note, when there is one. It matters most on a
                  rejection: a refusal with no reason attached is what turns a
                  return into a complaint. */}
              {request.decisionNote && (
                <p className="returns-list__note">{request.decisionNote}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Returns;
