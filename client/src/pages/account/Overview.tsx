import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/store";
import { useMyOrdersQuery } from "../../redux/api/orderAPI";
import { useMyWishListQuery } from "../../redux/api/wishlistAPI";
import { useMyAddressesQuery } from "../../redux/api/addressAPI";
import { useMyReviewsQuery } from "../../redux/api/productAPI";
import { formatINR } from "../../utils/features";
import ErrorState from "../../components/ErrorState";
import { ACCOUNT_NAV } from "./navigation";

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

/**
 * The account landing page: what is in flight right now, then the read-only
 * record, then a way into every other section.
 *
 * The identity header lives in AccountLayout, so this page starts at the part
 * that changes. Each count is a query the section it links to would run anyway;
 * RTK Query dedupes them, so opening Orders from here does not refetch.
 */
const Overview = () => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const id = user?._id ?? "";

  // Every one of these carried only `data`, so a failed query was
  // indistinguishable from an empty account: the counts below fell to `?? 0`
  // and the KPIs to an empty array, and the page stated — in the same confident
  // type it uses when it is right — that the customer had placed no orders and
  // spent nothing. A count is a claim about someone's own record, so an
  // unanswered query has to read as unknown rather than as zero.
  const { data: orders, isError: ordersFailed, refetch: refetchOrders } =
    useMyOrdersQuery(id, { skip: !id });
  const { data: wishlist, isError: wishlistFailed } = useMyWishListQuery(id, { skip: !id });
  const { data: addresses, isError: addressesFailed } = useMyAddressesQuery(id, { skip: !id });
  const { data: reviews, isError: reviewsFailed } = useMyReviewsQuery(id, { skip: !id });

  if (!user) return null;

  const all = orders?.orders ?? [];

  /** A number, or "—" when the query behind it never answered. */
  const count = (failed: boolean, n: number, unit: string) =>
    failed ? "—" : `${n} ${unit}`;

  // Two different questions, exactly as the server keeps them apart: `status`
  // is where the parcel is, `paymentStatus` is whether the money moved. Spend
  // counts paid orders only — an abandoned checkout is not money spent.
  const inFlight = all.filter(
    (o) => o.status === "Processing" || o.status === "Shipped"
  );
  const awaitingPayment = all.filter((o) => o.status === "PendingPayment");
  const spent = all
    .filter((o) => o.paymentStatus === "Paid")
    .reduce((sum, o) => sum + o.total, 0);

  const counts: Record<string, string> = {
    "/orders": count(ordersFailed, all.length, "placed"),
    "/wishlist": count(wishlistFailed, wishlist?.WishList.length ?? 0, "saved"),
    "/addresses": count(addressesFailed, addresses?.addresses.length ?? 0, "saved"),
    "/reviews": count(reviewsFailed, reviews?.reviews.length ?? 0, "written"),
  };

  const details = [
    { label: "Name", value: user.name },
    // An account has an email or a phone depending on how it was created, so
    // only the row that has a value is shown.
    ...(user.email ? [{ label: "Email", value: user.email }] : []),
    ...(user.phone ? [{ label: "Phone", value: user.phone }] : []),
    { label: "Gender", value: user.gender || "—" },
    { label: "Date of birth", value: formatDate(user.dob) },
  ];

  return (
    <div className="account-overview">
      {/* An unpaid checkout is holding stock and expires in 30 minutes, so it
          is the one thing on this page that is genuinely urgent. */}
      {awaitingPayment.length > 0 && (
        <div className="account-overview__alert">
          <p>
            You have {awaitingPayment.length} checkout
            {awaitingPayment.length === 1 ? "" : "s"} waiting for payment.
          </p>
          <Link
            to={`/pay/${awaitingPayment[0]._id}`}
            className="btn btn--subtle"
          >
            Finish paying
          </Link>
        </div>
      )}

      {/* All three tiles derive from the orders query, so they stand or fall
          together — one message beats three em dashes with no explanation. */}
      {ordersFailed ? (
        <ErrorState
          title="Couldn't load your order summary"
          message="The rest of your account details below are unaffected."
          onRetry={refetchOrders}
        />
      ) : (
        <div className="account-overview__stats">
          <div className="account-overview__stat">
            <span>Orders placed</span>
            <strong>{all.length}</strong>
          </div>
          <div className="account-overview__stat">
            <span>On the way</span>
            <strong>{inFlight.length}</strong>
          </div>
          <div className="account-overview__stat">
            <span>Total spent</span>
            <strong>{formatINR(spent)}</strong>
          </div>
        </div>
      )}

      <section>
        <h2>Account details</h2>
        <dl className="account-overview__details">
          {details.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="account-overview__note">
          <Link to="/settings">Edit your profile</Link>
          {user.email
            ? " — your photo comes from your Google account."
            : " — you signed in with your phone number."}
        </p>
      </section>

      <section>
        <h2>Jump to</h2>
        <div className="account-overview__cards">
          {/* Driven by the same list as the sidebar, minus this page. */}
          {ACCOUNT_NAV.filter((s) => s.to !== "/profile").map((section) => (
            <Link key={section.to} to={section.to} className="account-overview__card">
              <section.Icon />
              <div>
                <strong>{section.label}</strong>
                <span>{counts[section.to] ?? section.blurb}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Overview;
