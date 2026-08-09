import { lazy } from "react";

/**
 * Every lazily-loaded route, declared once so it can also be *prefetched*.
 *
 * Code splitting is what keeps the entry bundle small, but it moves the cost to
 * the click: the first navigation to a route downloads its chunk while the
 * visitor watches a spinner. On a fast connection that is a flash; on a phone on
 * mobile data it is the difference between an app that feels instant and one
 * that feels broken.
 *
 * The fix is to start the download on *intent* — a hover, a focus, a touch —
 * which happens tens to hundreds of milliseconds before the click. By the time
 * the navigation commits the chunk is usually already parsed, so `React.lazy`
 * resolves without ever showing a fallback.
 *
 * `import()` is idempotent: the module registry caches the promise, so
 * prefetching something already loaded costs nothing and needs no bookkeeping
 * of its own. That is what makes this safe to fire on every hover.
 */
export const load = {
  home: () => import("../pages/Home"),
  cart: () => import("../pages/Cart"),
  product: () => import("../pages/Product"),
  search: () => import("../pages/Search"),
  login: () => import("../pages/Login"),
  shipping: () => import("../pages/Shipping"),
  checkout: () => import("../pages/Checkout"),
  orders: () => import("../pages/Orders"),
  orderDetails: () => import("../pages/OrderDetails"),
  wishlist: () => import("../pages/WishList"),
  accountLayout: () => import("../pages/account/AccountLayout"),
  accountOverview: () => import("../pages/account/Overview"),
  addresses: () => import("../pages/account/Addresses"),
  reviews: () => import("../pages/account/Reviews"),
  returns: () => import("../pages/account/Returns"),
  settings: () => import("../pages/account/Settings"),
  staticPage: () => import("../pages/static/StaticPage"),
  contact: () => import("../pages/static/Contact"),
  notFound: () => import("../pages/NotFound"),
} as const;

export const Home = lazy(load.home);
export const Cart = lazy(load.cart);
export const ProductPage = lazy(load.product);
export const Search = lazy(load.search);
export const Login = lazy(load.login);
export const Shipping = lazy(load.shipping);
export const Checkout = lazy(load.checkout);
export const Orders = lazy(load.orders);
export const OrderDetails = lazy(load.orderDetails);
export const WishList = lazy(load.wishlist);
export const AccountLayout = lazy(load.accountLayout);
export const AccountOverview = lazy(load.accountOverview);
export const Addresses = lazy(load.addresses);
export const MyReviews = lazy(load.reviews);
export const MyReturns = lazy(load.returns);
export const Settings = lazy(load.settings);
export const StaticPage = lazy(load.staticPage);
export const Contact = lazy(load.contact);
export const NotFound = lazy(load.notFound);

/**
 * The account sections share a layout chunk, so entering the area at all needs
 * two chunks. Warm both together — otherwise the sidebar paints and the section
 * under it is still a spinner.
 */
const ACCOUNT = [load.accountLayout] as const;

/** Match a path to the chunk(s) rendering it. Longest prefix wins. */
const ROUTE_CHUNKS: [string, readonly (() => Promise<unknown>)[]][] = [
  ["/product/", [load.product]],
  ["/orders/", [...ACCOUNT, load.orderDetails]],
  ["/orders", [...ACCOUNT, load.orders]],
  ["/profile", [...ACCOUNT, load.accountOverview]],
  ["/addresses", [...ACCOUNT, load.addresses]],
  ["/reviews", [...ACCOUNT, load.reviews]],
  ["/returns-policy", [load.staticPage]],
  ["/returns", [...ACCOUNT, load.returns]],
  ["/settings", [...ACCOUNT, load.settings]],
  ["/wishlist", [...ACCOUNT, load.wishlist]],
  ["/shipping-policy", [load.staticPage]],
  ["/shipping", [load.shipping]],
  ["/pay/", [load.checkout]],
  ["/search", [load.search]],
  ["/cart", [load.cart]],
  ["/login", [load.login]],
  ["/contact", [load.contact]],
  ["/about", [load.staticPage]],
  ["/privacy", [load.staticPage]],
  ["/terms", [load.staticPage]],
  ["/", [load.home]],
];

/**
 * Start downloading whatever renders `path`. Safe to call repeatedly and on
 * every hover; failures are swallowed because a prefetch that does not arrive
 * must never surface as an error — the real navigation will ask again.
 */
export const prefetchRoute = (path: string) => {
  const pathname = path.split("?")[0];
  // Sorted longest-first so "/returns-policy" cannot be captured by "/returns".
  const entry = ROUTE_CHUNKS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(prefix)
  );
  if (!entry) return;
  for (const loader of entry[1]) loader().catch(() => {});
};

/**
 * Props that turn any link into one that warms its destination on intent.
 *
 * `onMouseEnter` covers the pointer, `onFocus` covers the keyboard, and
 * `onTouchStart` covers touch — where there is no hover at all, but the gap
 * between finger-down and the click event is still worth having.
 */
export const prefetchProps = (path: string) => ({
  onMouseEnter: () => prefetchRoute(path),
  onFocus: () => prefetchRoute(path),
  onTouchStart: () => prefetchRoute(path),
});
