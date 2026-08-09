import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { FaClipboardList } from "react-icons/fa";
import { userReducerIntialState } from "../types/reducer-types";
import { useMyOrdersQuery } from "../redux/api/orderAPI";
import { Order } from "../types/types";
import { Skeleton } from "../components/Loader";
import ErrorState from "../components/ErrorState";
import { queryErrorMessage } from "../utils/errors";
import DataTable, { Column } from "../components/DataTable";
import { formatINR, orderStatusClass, orderStatusLabel } from "../utils/features";

/**
 * Columns work on the order rows as the API returns them.
 *
 * `value` sorts, `render` draws. That split is why Amount and Discount now sort
 * correctly: they used to be pre-formatted strings, so "₹1,000" sorted below
 * "₹900" — lexical order on a currency symbol. Sorting on the number and
 * formatting only at render time removes the whole class of problem.
 */
const columns: Column<Order>[] = [
  {
    key: "id",
    header: "Order",
    // The full uuid overflowed the column; the tail is enough to tell two
    // orders apart, and the row links to the full record anyway.
    value: (o) => `#${o._id.slice(-8).toUpperCase()}`,
  },
  { key: "items", header: "Items", value: (o) => o.orderItems.length },
  {
    key: "discount",
    header: "Discount",
    value: (o) => o.discount,
    render: (o) => formatINR(o.discount),
  },
  {
    key: "amount",
    header: "Amount",
    value: (o) => o.total,
    render: (o) => formatINR(o.total),
  },
  {
    key: "status",
    header: "Status",
    value: (o) => orderStatusLabel(o.status),
    render: (o) => (
      <span className={orderStatusClass(o.status)}>
        {orderStatusLabel(o.status)}
      </span>
    ),
  },
  {
    key: "action",
    header: "",
    // No `value`: an action column has nothing meaningful to sort on.
    render: (o) =>
      // An unpaid order goes straight back to the payment page — that is the
      // one thing the customer still has to do, and its stock is only held
      // until the checkout expires.
      o.status === "PendingPayment" ? (
        <Link to={`/pay/${o._id}`}>Pay now</Link>
      ) : (
        <Link to={`/orders/${o._id}`}>View</Link>
      ),
  },
];

const Orders = () => {
  const { user } = useSelector(
    (state: { userReducer: userReducerIntialState }) => state.userReducer
  );

  const { isLoading, data, isError, error, refetch } = useMyOrdersQuery(user?._id!);

  // The rows are the API's own array now — the page used to copy them into
  // local state through an effect purely to pre-render badges and links into
  // the data, which is what stopped the table sorting.
  const orders = data?.orders ?? [];

  return (
    <div className="container">
      <div>
        <h2>My orders</h2>
        <main>
          {isLoading ? (
            <Skeleton width="100%" length={8} height="3rem" />
          ) : isError ? (
            // This branch has to come before the empty one. On a failed query
            // `data` is undefined, `orders` falls back to [], and the page told
            // a customer with a year of purchases "No orders yet — start
            // shopping". Of everywhere this pattern appeared, it was worst
            // here: an order history reading as empty is alarming, and the
            // suggested remedy was to go and buy something else.
            <ErrorState
              title="Couldn't load your orders"
              message={queryErrorMessage(error)}
              onRetry={refetch}
            />
          ) : orders.length === 0 ? (
            <div className="empty-state">
              <FaClipboardList />
              <h2>No orders yet</h2>
              <p>Once you place an order it will appear here with its status.</p>
              <Link to="/search" className="btn">
                Start shopping
              </Link>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={orders}
              rowKey={(o) => o._id}
              className="orders-table"
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default Orders;
