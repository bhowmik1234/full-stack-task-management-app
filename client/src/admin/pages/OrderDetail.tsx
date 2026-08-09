import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiTrash2 } from "react-icons/fi";
import {
  useAdvanceOrderMutation,
  useDeleteOrderMutation,
  useOrderQuery,
} from "../api";
import { useCan } from "../store";
import { uploadUrl } from "../config";
import { formatDateTime } from "../hooks";
import { reportToast } from "../mutation";
import Spinner from "../components/Spinner";
import {
  Card,
  EmptyState,
  Money,
  PageHeader,
  PaymentPill,
  StatusPill,
} from "../components/ui";

const OrderDetail = () => {
  const { id = "" } = useParams();
  const canWrite = useCan()("orders_write");
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOrderQuery(id);
  const [advanceOrder, { isLoading: advancing }] = useAdvanceOrderMutation();
  const [deleteOrder, { isLoading: deleting }] = useDeleteOrderMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The dispatch form. Opened by "Mark as Shipped" rather than shown always,
  // so the Delivered step stays a single click.
  const [shipping, setShipping] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");

  if (isLoading) return <Spinner full />;

  if (isError || !data)
    return (
      <div className="l-page">
        <PageHeader title="Order" />
        <EmptyState>That order could not be loaded.</EmptyState>
      </div>
    );

  const order = data.order;
  const { address, city, state, country, pinCode } = order.shippingInfo;

  // Fulfilment only moves forward from Processing, and the API refuses anything
  // else — an unpaid or cancelled order has nothing to advance, so the button
  // is not offered rather than offered and rejected.
  const advanceable = order.status === "Processing" || order.status === "Shipped";
  const nextStatus = order.status === "Processing" ? "Shipped" : "Delivered";

  /**
   * Advance fulfilment one step, capturing tracking on the dispatch step.
   *
   * The carrier form is shown *before* the Shipped transition rather than as a
   * separate "add tracking" action afterwards, because this transition is what
   * sends the shipping email — tracking added later would arrive in no message
   * at all, and the customer would have to think to come back and look for it.
   *
   * All three fields stay optional. Plenty of small stores hand parcels to a
   * local courier with no number to give, and a required field there would
   * either stop the order shipping or teach operators to type "n/a".
   */
  const advance = async () => {
    reportToast(
      await advanceOrder({
        orderId: order._id,
        ...(nextStatus === "Shipped"
          ? {
              carrier: carrier.trim() || undefined,
              trackingNumber: trackingNumber.trim() || undefined,
              trackingUrl: trackingUrl.trim() || undefined,
            }
          : {}),
      }),
      "Order updated"
    );
    setShipping(false);
  };

  const remove = async () => {
    const ok = reportToast(
      await deleteOrder(order._id),
      "Order deleted"
    );
    if (ok) navigate("/orders");
  };

  return (
    <div className="l-page">
      <PageHeader
        title={`Order ${order._id.slice(0, 8)}`}
        subtitle={
          <Link to="/orders" className="c-link">
            <FiArrowLeft aria-hidden="true" /> All orders
          </Link>
        }
        actions={
          !canWrite ? null : confirmDelete ? (
            <div className="c-confirm">
              <span>
                Delete permanently
                {order.status !== "Cancelled" && " and return its stock"}?
              </span>
              <button type="button" className="c-btn c-btn--ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button type="button" className="c-btn c-btn--danger" disabled={deleting} onClick={remove}>
                Delete
              </button>
            </div>
          ) : (
            <button type="button" className="c-btn c-btn--ghost" onClick={() => setConfirmDelete(true)}>
              <FiTrash2 aria-hidden="true" /> Delete
            </button>
          )
        }
      />

      <div className="l-split l-split--wide">
        <Card title="Items">
          <ul className="c-lineitems">
            {order.orderItems.map((item) => (
              <li key={item._id}>
                <img src={uploadUrl(item.photo)} alt="" loading="lazy" />
                <span className="c-lineitems__name">{item.name}</span>
                <span className="c-lineitems__qty">
                  <Money value={item.price} /> × {item.quantity}
                </span>
                <strong>
                  <Money value={item.price * item.quantity} />
                </strong>
              </li>
            ))}
          </ul>

          <dl className="c-totals">
            <div>
              <dt>Subtotal</dt>
              <dd><Money value={order.subtotal} /></dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd><Money value={order.shippingCharges} /></dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd><Money value={order.tax} /></dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>−<Money value={order.discount} /></dd>
            </div>
            <div className="c-totals__grand">
              <dt>Total</dt>
              <dd><Money value={order.total} /></dd>
            </div>
          </dl>
        </Card>

        <div className="l-stack">
          <Card title="Status">
            <dl className="c-facts c-facts--stacked">
              <div>
                <dt>Fulfilment</dt>
                <dd><StatusPill status={order.status} /></dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd><PaymentPill status={order.paymentStatus} /></dd>
              </div>
              <div>
                <dt>Checkout opened</dt>
                <dd>{formatDateTime(order.createdAt)}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd>{formatDateTime(order.placedAt)}</dd>
              </div>
              {order.cancelReason && (
                <div>
                  <dt>Cancelled because</dt>
                  <dd>{order.cancelReason}</dd>
                </div>
              )}
            </dl>

            {/* Method and tracking, once there is anything to say. Rendered
                above the action so an operator about to advance the order can
                see what was already recorded. */}
            {order.paymentMethod === "COD" && (
              <p className="c-note">
                Cash on delivery — the courier collects{" "}
                <Money value={order.total} />. Marking this delivered records the
                payment.
              </p>
            )}

            {order.shipment && (
              <dl className="c-facts">
                {order.shipment.carrier && (
                  <div>
                    <dt>Carrier</dt>
                    <dd>{order.shipment.carrier}</dd>
                  </div>
                )}
                {order.shipment.trackingNumber && (
                  <div>
                    <dt>Tracking</dt>
                    <dd>{order.shipment.trackingNumber}</dd>
                  </div>
                )}
                {order.shipment.shippedAt && (
                  <div>
                    <dt>Dispatched</dt>
                    <dd>{formatDateTime(order.shipment.shippedAt)}</dd>
                  </div>
                )}
              </dl>
            )}

            {advanceable && canWrite ? (
              nextStatus === "Shipped" && shipping ? (
                <div className="c-ship-form">
                  <label>
                    <span>Carrier</span>
                    <input
                      className="c-input"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      placeholder="e.g. Delhivery"
                    />
                  </label>
                  <label>
                    <span>Tracking number</span>
                    <input
                      className="c-input"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="e.g. 1234567890"
                    />
                  </label>
                  <label>
                    <span>Tracking link</span>
                    <input
                      className="c-input"
                      type="url"
                      value={trackingUrl}
                      onChange={(e) => setTrackingUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>

                  <p className="c-note">
                    All three are optional, and all three go into the dispatch
                    email. Adding them later would arrive in no message at all.
                  </p>

                  <div className="c-ship-form__actions">
                    <button
                      type="button"
                      className="c-btn c-btn--ghost"
                      onClick={() => setShipping(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="c-btn c-btn--primary"
                      disabled={advancing}
                      onClick={advance}
                    >
                      Mark as Shipped
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="c-btn c-btn--primary c-btn--block"
                  disabled={advancing}
                  onClick={() => (nextStatus === "Shipped" ? setShipping(true) : advance())}
                >
                  Mark as {nextStatus}
                </button>
              )
            ) : (
              <p className="c-note">
                {order.status === "PendingPayment"
                  ? "Waiting for the customer's payment. The order is holding its stock until it expires."
                  : order.status === "Cancelled"
                  ? "This order was cancelled and its stock returned."
                  : "This order is complete."}
              </p>
            )}
          </Card>

          <Card title="Customer">
            <dl className="c-facts c-facts--stacked">
              <div>
                <dt>Name</dt>
                <dd>{order.user?.name}</dd>
              </div>
              <div>
                <dt>Ship to</dt>
                <dd>
                  {address}
                  <br />
                  {city}, {state} {pinCode}
                  <br />
                  {country}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;
