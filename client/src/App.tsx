import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { ReactNode, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Loader from "./components/Loader";
import Header from "./components/Header";
import { Toaster } from "react-hot-toast";
import { useSelector } from "react-redux";
import { userReducerIntialState } from "./types/reducer-types";
import ProtectedRoute from "./components/ProtectedRoute";
import Footer from "./components/Footer";
import ScrollToTop from "./components/ScrollToTop";
// Firebase is deliberately NOT imported here. It is dynamically imported by
// useAuthBootstrap so the auth SDK stays out of the entry chunk.
import { useAuthBootstrap } from "./hooks/useAuthBootstrap";
import LoginIntent from "./components/LoginIntent";
import { useStorefrontConfig } from "./hooks/useStorefrontConfig";


// Every lazy route lives in one module so the same loaders can be used to
// *prefetch* a chunk on hover — see routes/lazyRoutes.ts. WishList used to be
// imported statically here, which put it in the entry chunk for everyone.
import {
  AccountLayout,
  AccountOverview,
  Addresses,
  Cart,
  Checkout,
  Contact,
  Home,
  Login,
  MyReturns,
  MyReviews,
  NotFound,
  OrderDetails,
  Orders,
  ProductPage,
  Search,
  Settings,
  Shipping,
  StaticPage,
  WishList,
} from "./routes/lazyRoutes";

// There are no admin routes here, and this bundle does not know where the
// console lives. It is a separate SPA on its own host (client/admin.html,
// src/admin/) — see nginx.conf. Nothing an admin can do is reachable from
// this origin, nothing here links to it, and shoppers never download it.

/**
 * `/search/<term>` is the older "term in the path" form. It rendered the same
 * page as `/search?q=<term>`, which left two URLs for one result set with
 * nothing pointing either at the other — and `Seo` drops the query string from
 * the canonical, so the two could not even agree on which was canonical.
 * Redirect instead: old links keep working and there is one address.
 */
const SearchTermRedirect = () => {
  const { id } = useParams();
  return (
    <Navigate to={id ? `/search?q=${encodeURIComponent(id)}` : "/search"} replace />
  );
};

/** ErrorBoundary, reset whenever the route changes. Must be inside Router. */
const RouteBoundary = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
};

export const App = () => {
  const { user, loading} = useSelector((state:{userReducer: userReducerIntialState})=> state.userReducer)

  // Tax, shipping and COD rules, so the cart's preview and the checkout charge
  // are computed from the same numbers. Loaded here rather than in the cart
  // because the totals appear in more than one place. See the hook.
  useStorefrontConfig();

  // Resolves the session alongside the first paint instead of in front of it,
  // and keeps the Firebase SDK out of the entry chunk. See the hook.
  useAuthBootstrap();

  // No `loading ? <Loader/>` gate here any more. It meant the catalogue, the
  // cart, every product page and the policy documents all waited on a Firebase
  // round trip that most of them have no use for — and when Firebase could not
  // be reached, the whole shop sat on a spinner for ever. Only guarded routes
  // genuinely need the answer, so `ProtectedRoute` is what waits for it now.
  return (
    <Router>
      {/* Must be inside Router — it reads the current location. */}
      <ScrollToTop />
      {/* Finishes a wishlist save that was interrupted by sign-in. Renders
          nothing; at the root because the heart is on the product page and on
          every card in every grid. */}
      <LoginIntent />
      <Header user={user}/>
      <main className="suspense-outlet">
      {/* Inside Router so it can key itself on the pathname: a page that threw
          recovers by navigating away, instead of pinning the error until the
          visitor reloads. Inside Suspense's position but *outside* it, because
          the thing most likely to fail here is a lazy chunk, and a rejected
          import is not something Suspense can catch. */}
      <RouteBoundary>
      <Suspense fallback={<Loader />}>
        <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/product/:id" element={<ProductPage />} />
        {/* /search browses everything. The :id form is the older "search term
            in the path" links; it redirects rather than rendering, so there is
            one URL per result set. See SearchTermRedirect. */}
        <Route path="/search" element={<Search />} />
        <Route path="/search/:id" element={<SearchTermRedirect />} />

        {/* /login is deliberately NOT wrapped in ProtectedRoute.
            It used to be, with `isAuthenticated` inverted to make a
            guests-only guard out of the signed-in guard — but ProtectedRoute
            sends a failing visitor to `/login`, so on `/login` itself that is
            a redirect to the page doing the redirecting. Signing in flips the
            condition and the loop starts: "Maximum update depth exceeded",
            then the browser throttles navigation.

            Login already handles the case this was meant to cover — it
            redirects a signed-in visitor to `state.from` (see Login.tsx) —
            which is the right place for it, because only Login knows where
            they were trying to go. */}
        <Route path="/login" element={<Login />} />

        {/* Static pages. Each slug is its own route rather than one
            `/:slug` catch-all: a catch-all would match every unknown path and
            render a blank policy page where a 404 belongs. The slugs match the
            ones the backend lists in sitemap.xml. */}
        <Route path="/about" element={<StaticPage slug="about" />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/shipping-policy" element={<StaticPage slug="shipping" />} />
        <Route path="/returns-policy" element={<StaticPage slug="returns" />} />
        <Route path="/privacy" element={<StaticPage slug="privacy" />} />
        <Route path="/terms" element={<StaticPage slug="terms" />} />


        {/* loggin user route */}
        <Route element={<ProtectedRoute isAuthenticated={user? true : false} loading={loading}/>}>
          {/* Pathless layout route: these keep their existing URLs and gain the
              account shell around them. Moving them under /account would break
              every bookmark and every link elsewhere in the app for no gain. */}
          <Route element={<AccountLayout />}>
            <Route path="/profile" element={<AccountOverview />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetails />} />
            <Route path="/returns" element={<MyReturns />} />
            <Route path="/wishlist" element={<WishList />} />
            <Route path="/addresses" element={<Addresses />} />
            <Route path="/reviews" element={<MyReviews />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          {/* "/account" is what people type. It is not a section of its own. */}
          <Route path="/account" element={<Navigate to="/profile" replace />} />

          {/* Checkout is outside the shell: a sidebar of other places to go is
              the last thing a payment flow needs. */}
          <Route path="/shipping" element={<Shipping />} />
          {/* The order id is in the path, not in router state: the payment
              page must survive a reload. */}
          <Route path="/pay/:orderId" element={<Checkout />} />
        </Route>

        {/* Old /admin/* bookmarks would otherwise render a blank page under
            the header. They go home like any other unknown path; the console
            is not advertised from this origin. */}
        <Route path="/admin/*" element={<Navigate to="/" replace />} />

        {/* Everything else. Must stay last — React Router picks the best match
            rather than the first, but keeping it here says plainly that it is
            the fallback. Without it an unknown path rendered the header and
            footer with nothing between them, which reads as a page that failed
            to load rather than one that does not exist. */}
        <Route path="*" element={<NotFound />} />

        </Routes>
      </Suspense>
      </RouteBoundary>
      </main>
      <Footer />
      <Toaster
        position="top-center"
        toastOptions={{
          // The default toast is white-on-white against this theme.
          style: {
            background: "#1e1e2a",
            color: "#f6f6f9",
            border: "1px solid #2a2a38",
            borderRadius: "10px",
            fontSize: "0.9rem",
          },
          success: { iconTheme: { primary: "#22c55e", secondary: "#0f0f15" } },
          error: { iconTheme: { primary: "#ef4444", secondary: "#0f0f15" } },
        }}
      />
    </Router>
  )
}
