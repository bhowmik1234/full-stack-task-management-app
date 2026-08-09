import { lazy, ReactElement, ReactNode, Suspense, useCallback, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ErrorBoundary from "../components/ErrorBoundary";
import { Toaster } from "react-hot-toast";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";
import { fetchSession } from "./auth";
import { sessionLoaded, sessionRejected, signedOut } from "./session";
import { useAdminDispatch, useAdminSelector, useIsRoot } from "./store";
import { landingFor } from "./navigation";
import type { Permission } from "./permissions";
import { clearDevSession, getDevSession } from "../utils/devAuth";
import Layout from "./components/Layout";
import RequireAdmin from "./components/RequireAdmin";
import RequirePermission from "./components/RequirePermission";
import Spinner from "./components/Spinner";

// The console is behind a login, so nothing here is on a first-paint path that
// matters; splitting keeps the initial bundle to the shell and the sign-in.
const Overview = lazy(() => import("./pages/Overview"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Products = lazy(() => import("./pages/Products"));
const ProductForm = lazy(() => import("./pages/ProductForm"));
const Orders = lazy(() => import("./pages/Orders"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const Returns = lazy(() => import("./pages/Returns"));
const Customers = lazy(() => import("./pages/Customers"));
const Activity = lazy(() => import("./pages/Activity"));
const Coupons = lazy(() => import("./pages/Coupons"));
const Access = lazy(() => import("./pages/Access"));
const SignIn = lazy(() => import("./pages/SignIn"));

/** Shorthand so every guarded route reads as "path — permission — page". */
const gated = (permission: Permission, page: ReactElement) => (
  <RequirePermission permission={permission}>{page}</RequirePermission>
);

/**
 * The overview needs `analytics_read`, which not every operator has. Sending
 * someone whose job is answering order queries to a permission refusal every
 * time they sign in would be a daily insult from the tool they were given, so
 * "/" resolves to the first section they can actually see.
 */
const Landing = () => {
  const permissions = useAdminSelector((state) => state.session.permissions);
  const isRoot = useIsRoot();

  if (permissions.includes("analytics_read")) return <Overview />;

  const home = landingFor(permissions, isRoot);
  return home && home !== "/" ? (
    <Navigate to={home} replace />
  ) : (
    // Staff with an empty permission set. Possible only briefly, between a
    // grant being narrowed to nothing and it being revoked, but it has to say
    // something rather than render an empty shell.
    <div className="c-denied">
      <h1>Nothing to show yet</h1>
      <p>Your account has console access but no sections enabled.</p>
    </div>
  );
};

/**
 * Signs the console out after 30 minutes with no interaction.
 *
 * Defence in depth and nothing more — an unattended console on a shared
 * warehouse machine is a real way for access to be used by the wrong person,
 * and a timer in the browser does nothing about a stolen credential. It is not
 * a substitute for suspension, which is enforced server-side on the next
 * request.
 */
const IDLE_MS = 30 * 60 * 1000;

const useIdleSignOut = (active: boolean) => {
  const end = useCallback(async () => {
    clearDevSession();
    await signOut(auth).catch(() => {});
    window.location.assign("/sign-in");
  }, []);

  useEffect(() => {
    if (!active) return;

    let timer = window.setTimeout(end, IDLE_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(end, IDLE_MS);
    };

    const events = ["pointerdown", "keydown", "visibilitychange"] as const;
    for (const event of events) window.addEventListener(event, reset, { passive: true });

    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, reset);
    };
  }, [active, end]);
};

/**
 * Same boundary the storefront uses, wearing the console's own classes — the
 * two apps share no stylesheet, so `.empty-state` would render unstyled here.
 * The lazy-chunk case is if anything sharper on this side: an operator leaves
 * the console open all day, and a deploy in the meantime makes every route
 * they have not yet visited fail to import.
 */
const ConsoleBoundary = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} className="c-denied" buttonClassName="c-btn">
      {children}
    </ErrorBoundary>
  );
};

const AdminApp = () => {
  const dispatch = useAdminDispatch();
  const status = useAdminSelector((state) => state.session.status);

  useIdleSignOut(status === "authenticated");

  useEffect(() => {
    // The dev bypass wins over Firebase and never subscribes to it, so a
    // stored uid survives a reload the way a real session does. It compiles
    // out of a production build — see utils/devAuth.ts.
    const devUid = getDevSession();
    if (devUid) {
      fetchSession()
        .then((session) => dispatch(sessionLoaded(session)))
        .catch(() => {
          // The seed rows are missing. Fall back to signed out rather than
          // leaving the console on its loader forever.
          clearDevSession();
          dispatch(signedOut());
        });
      return;
    }

    return onAuthStateChanged(auth, async (account) => {
      if (!account) return dispatch(signedOut());

      try {
        // Authenticating with Google proves who you are, not what you may do.
        // Both answers come from the server, which reads them out of the token
        // rather than being told — see auth.ts.
        dispatch(sessionLoaded(await fetchSession()));
      } catch (error) {
        // The server refuses sessions for reasons the person can act on: the
        // wrong sign-in method, a session too old, a missing second factor.
        // Dropping to "signed out" here would bounce them to the sign-in form
        // to make the same rejected session again, forever.
        dispatch(
          sessionRejected(
            error instanceof Error && error.message
              ? error.message
              : "Could not start a console session."
          )
        );
      }
    });
  }, [dispatch]);

  return (
    <BrowserRouter>
      <ConsoleBoundary>
      <Suspense fallback={<Spinner full />}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />

          <Route
            element={
              <RequireAdmin>
                <Layout />
              </RequireAdmin>
            }
          >
            <Route path="/" element={<Landing />} />
            <Route path="/analytics" element={gated("analytics_read", <Analytics />)} />
            <Route path="/products" element={gated("products_read", <Products />)} />
            {/* Both product form routes need write, not read: the page exists
                to submit changes, and offering it to someone who can only look
                produces a form that fails on save. */}
            <Route path="/products/new" element={gated("products_write", <ProductForm />)} />
            <Route path="/products/:id" element={gated("products_write", <ProductForm />)} />
            <Route path="/orders" element={gated("orders_read", <Orders />)} />
            <Route path="/orders/:id" element={gated("orders_read", <OrderDetail />)} />
            {/* Reading the queue needs orders_read; the actions on it need
                orders_write and the page gates each one itself. */}
            <Route path="/returns" element={gated("orders_read", <Returns />)} />
            <Route path="/customers" element={gated("customers_read", <Customers />)} />
            <Route path="/activity" element={gated("activity_read", <Activity />)} />
            <Route path="/coupons" element={gated("coupons_read", <Coupons />)} />
            {/* Access is root's, and root holds every permission — so it is
                gated on access_manage, which nothing else can ever be granted. */}
            <Route path="/access" element={gated("access_manage", <Access />)} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ConsoleBoundary>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#171b23",
            color: "#e8eaef",
            border: "1px solid #2e3442",
            borderRadius: "8px",
            fontSize: "0.875rem",
          },
          success: { iconTheme: { primary: "#0ca30c", secondary: "#0b0d11" } },
          error: { iconTheme: { primary: "#d03b3b", secondary: "#0b0d11" } },
        }}
      />
    </BrowserRouter>
  );
};

export default AdminApp;
