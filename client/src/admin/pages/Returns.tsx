import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useReturnsQuery,
  useDecideReturnMutation,
  useReceiveReturnMutation,
  useRefundReturnMutation,
} from "../api";
import { useCan } from "../store";
import { reportToast } from "../mutation";
import { formatDate } from "../hooks";
import { SkeletonRows } from "../components/Spinner";
import { Card, EmptyState, Money, PageHeader } from "../components/ui";
import { ReturnRequest, ReturnStatus } from "../../types/types";

/**
 * The returns desk.
 *
 * A queue rather than a table, because a return is worked rather than browsed:
 * each row carries the one or two actions that are legal for its current status
 * and nothing else. That is the same rule the order page follows — a button
 * that always fails is worse than no button — applied to a four-state machine.
 *
 * The transitions are `Requested → Approved → Received → Refunded`, with
 * `Rejected` and `Cancelled` as exits. The server checks the current status on
 * every one of them, so two operators with the same row open get one action and
 * one 409 rather than two emails telling the customer opposite things. What the
 * page does is stop them reaching for the wrong one in the first place.
 */

/** Which statuses the filter offers, and what each is called here. */
const FILTERS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "Requested", label: "Awaiting review" },
  { value: "Approved", label: "Approved" },
  { value: "Received", label: "Received" },
  { value: "Refunded", label: "Refunded" },
  { value: "Rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

/**
 * What an operator should do next, in one sentence.
 *
 * Written out rather than left to the status name because the status says where
 * the row is and not whose turn it is — "Approved" means the store is waiting
 * for a parcel, and nothing about the word says so.
 */
const NEXT_STEP: Record<ReturnStatus, string> = {
  Requested: "Decide whether to accept this return.",
  Approved: "Waiting for the parcel. Mark it received when it arrives.",
  Received: "Items are back. Issue the refund.",
  Refunded: "Settled.",
  Rejected: "Declined.",
  Cancelled: "Withdrawn by the customer.",
};

const Returns = () => {
  const [filter, setFilter] = useState("open");
  const { data, isLoading } = useReturnsQuery(filter);

  const [decide, { isLoading: deciding }] = useDecideReturnMutation();
  const [receive, { isLoading: receiving }] = useReceiveReturnMutation();
  const [refund, { isLoading: refunding }] = useRefundReturnMutation();

  const canWrite = useCan()("orders_write");
  const busy = deciding || receiving || refunding;

  const returns: ReturnRequest[] = data?.returns ?? [];

  const onDecide = async (request: ReturnRequest, approved: boolean) => {
    // A rejection with no reason attached is what turns a return into a
    // complaint, so one is required here even though the column allows empty.
    const note = window.prompt(
      approved
        ? "Anything to tell the customer? (optional)"
        : "Why is this being declined? The customer will see this."
    );

    // `prompt` returns null when cancelled and "" when submitted empty. Only
    // the first is a change of mind.
    if (note === null) return;
    if (!approved && !note.trim()) {
      window.alert("A reason is required when declining a return.");
      return;
    }

    await decide({ returnId: request._id, approved, note: note.trim() }).then((res) =>
      reportToast(res, approved ? "Return approved" : "Return declined")
    );
  };

  const onReceive = async (request: ReturnRequest) => {
    // Restocking is a judgement, not a consequence: damaged goods come back and
    // do not go back on the shelf. Defaulting to yes matches the common case
    // and the question is asked every time.
    const restock = window.confirm(
      "Put these items back into stock?\n\nOK = restock, Cancel = received but not resaleable."
    );

    await receive({ returnId: request._id, restock }).then((res) =>
      reportToast(res, "Marked as received")
    );
  };

  const onRefund = async (request: ReturnRequest) => {
    const typed = window.prompt(
      "Refund amount in rupees. Leave blank for the full calculated refund (item value plus its share of tax, and delivery on a whole-order return).\n\nAn amount may only be lower — this is where a restocking fee goes."
    );
    if (typed === null) return;

    const amount = typed.trim() === "" ? undefined : Number(typed);
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      window.alert("That is not a valid amount.");
      return;
    }

    await refund({ returnId: request._id, amount }).then((res) =>
      reportToast(res, "Refund issued")
    );
  };

  return (
    <>
      <PageHeader
        title="Returns"
        subtitle="Requests from customers to send items back, and the refunds that settle them."
        actions={
          <select
          className="c-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter returns by status"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
            ))}
          </select>
        }
      />

      {isLoading ? (
        <SkeletonRows rows={5} />
      ) : returns.length === 0 ? (
        <EmptyState>
          {filter === "open"
            ? "Nothing waiting. Every return has been settled."
            : "No returns with that status."}
        </EmptyState>
      ) : (
        <div className="c-returns">
          {returns.map((request: ReturnRequest) => (
            <Card key={request._id}>
              <div className="c-returns__head">
                <div>
                  <Link to={`/orders/${request.orderId}`} className="c-returns__order">
                    Order #{request.orderId.slice(-8).toUpperCase()}
                  </Link>
                  <span className="c-returns__meta">
                    {request.user?.name ?? "Customer"} · requested{" "}
                    {formatDate(request.createdAt)}
                  </span>
                </div>
                <span className={`c-pill is-${request.status.toLowerCase()}`}>
                  {request.status}
                </span>
              </div>

              <p className="c-returns__next">{NEXT_STEP[request.status]}</p>

              <dl className="c-returns__facts">
                <div>
                  <dt>Reason</dt>
                  <dd>{request.reason}</dd>
                </div>
                {request.order && (
                  <div>
                    <dt>Order total</dt>
                    <dd>
                      <Money value={request.order.total} />
                    </dd>
                  </div>
                )}
                {request.refundAmount !== null && (
                  <div>
                    <dt>Refunded</dt>
                    <dd>
                      <Money value={request.refundAmount} />
                    </dd>
                  </div>
                )}
                {request.status === "Received" && (
                  <div>
                    <dt>Restocked</dt>
                    <dd>{request.restocked ? "Yes" : "No"}</dd>
                  </div>
                )}
              </dl>

              <ul className="c-returns__items">
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
                      {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    </span>
                    <span className="c-returns__qty">× {item.quantity}</span>
                    {item.price !== undefined && (
                      <span className="c-returns__price">
                        <Money value={item.price * item.quantity} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {/* What the customer said, and what an operator said back. Both
                  matter at the desk: the first is the case, the second is what
                  has already been promised. */}
              {request.note && (
                <p className="c-returns__note">
                  <strong>Customer:</strong> {request.note}
                </p>
              )}
              {request.decisionNote && (
                <p className="c-returns__note">
                  <strong>Decision:</strong> {request.decisionNote}
                </p>
              )}

              {/* Only the actions this status actually permits. An operator
                  without orders_write sees the queue and no buttons — which is
                  the whole point of splitting read from write. */}
              {canWrite && (
                <div className="c-returns__actions">
                  {request.status === "Requested" && (
                    <>
                      <button
                        className="c-btn"
                        disabled={busy}
                        onClick={() => onDecide(request, true)}
                      >
                        Approve
                      </button>
                      <button
                        className="c-btn is-ghost"
                        disabled={busy}
                        onClick={() => onDecide(request, false)}
                      >
                        Decline
                      </button>
                    </>
                  )}

                  {request.status === "Approved" && (
                    <button
                      className="c-btn"
                      disabled={busy}
                      onClick={() => onReceive(request)}
                    >
                      Mark received
                    </button>
                  )}

                  {request.status === "Received" && (
                    <button
                      className="c-btn"
                      disabled={busy}
                      onClick={() => onRefund(request)}
                    >
                      Issue refund
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

export default Returns;
