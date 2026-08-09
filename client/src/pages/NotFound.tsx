import { Link, useLocation } from "react-router-dom";
import Seo from "../components/Seo";

/**
 * 404.
 *
 * Before this, an unknown path rendered the header and footer with nothing
 * between them — indistinguishable from a page that failed to load, which is the
 * worst thing a mistyped URL can look like. Someone waits, reloads, and only
 * then leaves.
 *
 * `noIndex` matters here: without it every bad link anyone ever published
 * becomes an indexable page returning 200, which is the "soft 404" problem. The
 * status code is still 200 — a client-rendered SPA cannot set it, since the
 * server answered before the router ran — so the robots tag is what tells a
 * crawler this is not a page.
 */
const NotFound = () => {
  const { pathname } = useLocation();

  return (
    <div className="page not-found">
      <Seo
        title="Page not found"
        description="This page does not exist."
        noIndex
      />

      <p className="not-found__code">404</p>
      <h1>We could not find that page</h1>
      <p className="not-found__detail">
        Nothing lives at <code>{pathname}</code>. It may have moved, or the link
        may have been mistyped.
      </p>

      <div className="not-found__actions">
        <Link to="/" className="not-found__primary">
          Go to the shop
        </Link>
        <Link to="/search" className="not-found__secondary">
          Browse everything
        </Link>
      </div>

      <p className="not-found__help">
        Looking for an order? It is under <Link to="/orders">Your orders</Link>.
        Still stuck — <Link to="/contact">contact us</Link>.
      </p>
    </div>
  );
};

export default NotFound;
