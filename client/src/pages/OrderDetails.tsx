import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import toast from "react-hot-toast";
import { AppDispatch, RootState } from "../redux/store";
import { useCancelOrderMutation, useOrderDetailsQuery } from "../redux/api/orderAPI";
import { productAPI } from "../redux/api/productAPI";
import { addToCart } from "../redux/reducer/cartReducer";
import { Skeleton } from "../components/Loader";
import {
  formatINR,
  orderStatusClass,
  orderStatusLabel,
} from "../utils/features";
import { CustomError } from "../types/api-types";
import ReturnDialog from "../components/ReturnDialog";
import Seo from "../components/Seo";
import { useCancelReturnMutation } from "../redux/api/returnsAPI";

// "My orders" linked here but the page was a stub that rendered the literal
// string "OrderDetails". The API (GET /order/:id) already lets a customer read
// their own order, so this shows it.
const OrderDetails = () => {
  const { id } = useParams();
  const { user } = useSelector((state: RootState) => state.userReducer);

  const { data, isLoading, isError, refetch } = useOrderDetailsQuery(
    { orderId: id!, userId: user?._id! },
    { skip: !id || !user?._id }
  );

  const [cancelOrder] = useCancelOrderMutation();
  const [cancelReturn] = useCancelReturnMutation();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  // The store's return window, so this page states the real number rather than
  // a literal that drifts from what the server enforces.
  const config = useSelector((state: RootState) => state.cartReducer.config);

  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="account-section">
        <Skeleton length={8} height="2.5rem" />
      </div>
    );
  }

  if (isError || !data?.order) {
    return (
      <div className="account-section">
        <div className="empty-state">
          <h2>Order not found</h2>
          <p>We couldn't load this order. It may belong to another account.</p>
          <Link to="/orders" className="btn">Back to my orders</Link>
        </div>
      </div>
    );
  }

  const { order } = data;
  const awaitingPayment = order.status === "PendingPayment";
  // Cancellable right up to despatch. Past that it is a return, which is a
  // different process the backend refuses here.
  const cancellable =
    order.status === "PendingPayment" || order.status === "Processing";

  const isCod = order.paymentMethod === "COD";

  /**
   * Whether the "Return items" button appears.
   *
   * Delivered only — anything earlier is a cancellation — and inside the window
   * the store configures. The window is measured from `deliveredAt`, and an
   * order delivered before that column existed has none: those are treated as
   * still open here and the server decides, rather than the page refusing on
   * the customer's behalf for a reason that is really a schema change.
   */
  const openReturn = (order.returns ?? []).find((r) =>
    ["Requested", "Approved", "Received"].includes(r.status)
  );

  const withinReturnWindow =
    !order.deliveredAt ||
    Date.now() - new Date(order.deliveredAt).getTime() <=
      config.returnWindowDays * 24 * 60 * 60 * 1000;

  const returnable = order.status === "Delivered" && withinReturnWindow && !openReturn;

  const cancelHandler = async () => {
    if (isCancelling) return;
    const confirmed = window.confirm(
      order.paymentStatus === "Paid"
        ? "Cancel this order? Your payment will be refunded to the original method."
        : "Cancel this order?"
    );
    if (!confirmed) return;

    setIsCancelling(true);
    const res = await cancelOrder({ orderId: order._id, userId: user?._id! });
    setIsCancelling(false);

    if ("data" in res && res.data) toast.success(res.data.message);
    else
      toast.error(
        (res.error as CustomError)?.data?.message ?? "Could not cancel this order."
      );
  };

  /**
   * Buy again.
   *
   * The order's items are a *snapshot* — name, photo and the price that was
   * actually paid — so they cannot be pushed into the cart as they stand: the
   * cart would show last year's price while checkout re-derives the real one
   * from the database, and the customer would meet a total they never agreed
   * to. Each product is fetched fresh instead, which is also the only way to
   * learn its current stock, and anything discontinued or sold out is reported
   * rather than silently dropped.
   */
  const reorderHandler = async () => {
    if (isReordering) return;
    setIsReordering(true);

    const results = await Promise.all(
      order.orderItems.map((item) =>
        dispatch(productAPI.endpoints.ProdectDetails.initiate(item.productId))
          .unwrap()
          .then((res) => ({ item, product: res.product }))
          .catch(() => ({ item, product: null }))
      )
    );

    const unavailable: string[] = [];
    let added = 0;

    for (const { item, product } of results) {
      if (!product) {
        unavailable.push(item.name);
        continue;
      }

      // The same combination, if it still exists. A variant can be removed from
      // the catalogue between the order and today, and adding the product
      // without one would put the *cheapest* size in the cart under the name of
      // the one they actually bought.
      const variant = item.variantId
        ? product.variants?.find((v) => v._id === item.variantId)
        : undefined;

      if (item.variantId && !variant) {
        unavailable.push(`${item.name} (${item.variantLabel || "that option"})`);
        continue;
      }

      const stock = variant?.stock ?? product.stock;
      if (stock < 1) {
        unavailable.push(
          item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name
        );
        continue;
      }

      dispatch(
        addToCart({
          productId: product._id,
          photo: product.photo,
          name: product.name,
          // Today's price, never the one on the order — that is the whole
          // reason this re-fetches instead of replaying the snapshot.
          price: variant?.price ?? product.price,
          stock,
          // Never more than is on the shelf today.
          quantity: Math.min(item.quantity, stock),
          variantId: variant?._id ?? null,
          variantLabel: variant?.label ?? "",
        })
      );
      added += 1;
    }

    setIsReordering(false);

    if (added === 0) {
      toast.error("None of these items are available right now.");
      return;
    }

    if (unavailable.length > 0)
      toast.error(`Not available: ${unavailable.join(", ")}`);

    toast.success(`${added} item${added === 1 ? "" : "s"} added to your cart`);
    navigate("/cart");
  };

  const stamp = order.placedAt ?? order.createdAt;
  const invoiceDate = stamp
    ? new Date(stamp).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <div className="order-details">
      {/* Per-customer and behind a sign-in, so a search result pointing here is
          only ever a redirect to the login page. */}
      <Seo title={`Order #${order._id.slice(-8).toUpperCase()}`} noIndex />

      <header>
        <div>
          <Link to="/orders">&#10094; My orders</Link>
          <h2>Order #{order._id.slice(-8).toUpperCase()}</h2>
        </div>
        <span className={orderStatusClass(order.status)}>
          {orderStatusLabel(order.status)}
        </span>
      </header>

      {awaitingPayment && (
        <div className="order-details__notice">
          <p>
            This order isn't paid for yet. We're holding the items for you until
            the checkout expires.
          </p>
          <Link to={`/pay/${order._id}`} className="btn">
            Complete payment
          </Link>
        </div>
      )}

      {/* Cash on delivery. Worth stating on the order rather than only in the
          confirmation email: the amount to have ready is the thing the customer
          comes back to this page to check. */}
      {isCod && order.paymentStatus !== "Paid" && order.status !== "Cancelled" && (
        <div className="order-details__notice order-details__notice--muted">
          <p>
            You are paying on delivery. Please have{" "}
            <strong>{formatINR(order.total)}</strong> ready for the courier.
          </p>
        </div>
      )}

      {/* Carrier and tracking, once the parcel is actually moving. Hidden
          entirely before dispatch — a "Tracking" heading over an empty space
          reads as information that failed to load. */}
      {order.shipment && (
        <section className="card order-details__tracking">
          <h3>Tracking</h3>
          <dl>
            {order.shipment.carrier && (
              <div>
                <dt>Carrier</dt>
                <dd>{order.shipment.carrier}</dd>
              </div>
            )}
            {order.shipment.trackingNumber && (
              <div>
                <dt>Tracking number</dt>
                <dd>
                  <code>{order.shipment.trackingNumber}</code>
                </dd>
              </div>
            )}
            {order.shipment.shippedAt && (
              <div>
                <dt>Dispatched</dt>
                <dd>
                  {new Date(order.shipment.shippedAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
            )}
          </dl>
          {order.shipment.trackingUrl && (
            <a
              href={order.shipment.trackingUrl}
              className="btn btn--subtle"
              target="_blank"
              // noopener because the carrier's page gets a handle on this window
              // otherwise; noreferrer keeps the customer's order URL out of
              // their logs.
              rel="noopener noreferrer"
            >
              Track this parcel
            </a>
          )}
        </section>
      )}

      {order.status === "Cancelled" && (
        <div className="order-details__notice order-details__notice--muted">
          <p>
            This order was cancelled
            {order.cancelReason ? ` — ${order.cancelReason.toLowerCase()}` : ""}.
            {order.paymentStatus === "Refunded" &&
              " Your refund has been sent to the original payment method."}
          </p>
        </div>
      )}

      <div className="order-details__grid">
        <section className="card">
          <h3>Items</h3>
          <ul className="order-details__items">
            {order.orderItems.map((item) => (
              <li key={item._id}>
                <img src={`${import.meta.env.VITE_SERVER}/${item.photo}`} alt={item.name} />
                <div>
                  <Link to={`/product/${item.productId}`}>{item.name}</Link>
                  {/* A snapshot taken at purchase: renaming an option next
                      season must not relabel what someone already received. */}
                  {item.variantLabel && (
                    <span className="order-details__variant">{item.variantLabel}</span>
                  )}
                  <span>
                    {formatINR(item.price)} × {item.quantity}
                  </span>
                </div>
                <strong>{formatINR(item.price * item.quantity)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <aside className="order-details__side">
          <section className="card">
            <h3>Delivery address</h3>
            <address>
              {order.shippingInfo.address}
              <br />
              {order.shippingInfo.city}, {order.shippingInfo.state}
              <br />
              {order.shippingInfo.country} — {order.shippingInfo.pinCode}
            </address>
          </section>

          <section className="card">
            <h3>Payment summary</h3>
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatINR(order.subtotal)}</dd>
              </div>
              <div>
                <dt>Shipping</dt>
                <dd>{order.shippingCharges === 0 ? "Free" : formatINR(order.shippingCharges)}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{formatINR(order.tax)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>- {formatINR(order.discount)}</dd>
              </div>
              <div className="order-details__total">
                <dt>Total</dt>
                <dd>{formatINR(order.total)}</dd>
              </div>
            </dl>

            <p className="order-details__payment-state">
              {order.paymentStatus === "Paid"
                ? "Paid"
                : order.paymentStatus === "Refunded"
                ? "Refunded"
                : "Not paid yet"}
            </p>
          </section>

          <div className="order-details__actions">
            {/* Reordering a checkout that was never paid for makes no sense —
                the items are already in an order, waiting for payment. */}
            {!awaitingPayment && (
              <button
                type="button"
                className="btn btn--subtle"
                onClick={reorderHandler}
                disabled={isReordering}
              >
                {isReordering ? "Adding.." : "Buy these again"}
              </button>
            )}

            {/* Only a paid order has anything to put on a receipt. The browser's
                own print dialogue is the whole mechanism: the invoice below is
                real markup that the print stylesheet reveals and everything
                else hides, so "save as PDF" is a device the customer already
                has and there is no generator to keep in step with the page. */}
            {order.paymentStatus === "Paid" && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => window.print()}
              >
                Download invoice
              </button>
            )}

            {returnable && (
              <button
                type="button"
                className="btn btn--subtle"
                onClick={() => setReturnOpen(true)}
              >
                Return items
              </button>
            )}

            {cancellable && (
              <button
                type="button"
                className="order-details__cancel"
                onClick={cancelHandler}
                disabled={isCancelling}
              >
                {isCancelling ? "Cancelling.." : "Cancel this order"}
              </button>
            )}

            {/* Says *why* returning is not on offer, rather than leaving an
                absent button to be read as a missing feature. Only shown once
                the order has actually been delivered — before that, cancelling
                is the route and it has its own button above. */}
            {order.status === "Delivered" && !returnable && !openReturn && (
              <p className="order-details__hint">
                The {config.returnWindowDays}-day return window for this order
                has closed. <Link to="/contact">Contact us</Link> if something is
                wrong with it.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Returns opened against this order, newest first. Rendered whatever the
          status: a customer who has been refused needs to see that, and the
          reason, more than one who has been approved. */}
      {(order.returns?.length ?? 0) > 0 && (
        <section className="card order-returns">
          <h3>Returns</h3>
          <ul>
            {order.returns!.map((request) => (
              <li key={request._id}>
                <div className="order-returns__head">
                  <span className={`badge badge--${request.status.toLowerCase()}`}>
                    {request.status}
                  </span>
                  <span className="order-returns__date">
                    {new Date(request.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <p className="order-returns__reason">{request.reason}</p>

                <ul className="order-returns__items">
                  {request.items.map((item) => (
                    <li key={item._id}>
                      {item.name ?? "Item"}
                      {item.variantLabel ? ` (${item.variantLabel})` : ""} ×{" "}
                      {item.quantity}
                    </li>
                  ))}
                </ul>

                {/* The operator's note. Shown for a rejection above all: a
                    refusal with no reason attached is what turns a return into
                    a complaint. */}
                {request.decisionNote && (
                  <p className="order-returns__note">{request.decisionNote}</p>
                )}

                {request.status === "Refunded" && request.refundAmount !== null && (
                  <p className="order-returns__refund">
                    Refunded {formatINR(request.refundAmount)} — allow 5–7 working
                    days for it to reach your account.
                  </p>
                )}

                {(request.status === "Requested" || request.status === "Approved") && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={async () => {
                      if (!window.confirm("Withdraw this return request?")) return;
                      const res = await cancelReturn({
                        userId: user?._id!,
                        returnId: request._id,
                      });
                      if ("data" in res && res.data) {
                        toast.success("Return withdrawn.");
                        refetch();
                      } else
                        toast.error(
                          (res.error as CustomError)?.data?.message ??
                            "Could not withdraw this return."
                        );
                    }}
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {returnOpen && user?._id && (
        <ReturnDialog
          order={order}
          userId={user._id}
          // Returns live on the order, which is served by a different API slice
          // — so the returns tag the mutation invalidates cannot reach it.
          // Refetching on close is one request and keeps the page honest;
          // cross-invalidating between slices would mean wiring the order's tag
          // into returnsAPI, which couples two slices for one screen.
          onClose={() => {
            setReturnOpen(false);
            refetch();
          }}
        />
      )}

      {/* The printable receipt. Present in the DOM but hidden on screen, and the
          only thing the print stylesheet shows — so what comes out of the print
          dialogue is a receipt rather than a screenshot of an app. */}
      {order.paymentStatus === "Paid" && (
        <div className="order-invoice" aria-hidden>
          <header>
            <h2>Invoice</h2>
            <div>
              <p>Order #{order._id.slice(-8).toUpperCase()}</p>
              {/* placedAt is when the money arrived, createdAt when checkout
                  started. This block only renders for a paid order, so the
                  first is always set. */}
              <p>{invoiceDate}</p>
            </div>
          </header>

          <div className="order-invoice__parties">
            <div>
              <h3>Billed to</h3>
              <address>
                {user?.name}
                <br />
                {order.shippingInfo.address}
                <br />
                {order.shippingInfo.city}, {order.shippingInfo.state}
                <br />
                {order.shippingInfo.country} — {order.shippingInfo.pinCode}
              </address>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {order.orderItems.map((item) => (
                <tr key={item._id}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{formatINR(item.price)}</td>
                  <td>{formatINR(item.price * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Subtotal</td>
                <td>{formatINR(order.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3}>Shipping</td>
                <td>
                  {order.shippingCharges === 0
                    ? "Free"
                    : formatINR(order.shippingCharges)}
                </td>
              </tr>
              <tr>
                <td colSpan={3}>Tax</td>
                <td>{formatINR(order.tax)}</td>
              </tr>
              <tr>
                <td colSpan={3}>Discount</td>
                <td>- {formatINR(order.discount)}</td>
              </tr>
              <tr className="order-invoice__total">
                <td colSpan={3}>Total paid</td>
                <td>{formatINR(order.amountCharged ?? order.total)}</td>
              </tr>
            </tfoot>
          </table>

          <p className="order-invoice__foot">
            Paid in full. This is a computer-generated invoice and needs no
            signature.
          </p>
        </div>
      )}
    </div>
  );
};

export default OrderDetails;
