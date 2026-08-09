import { ReactElement } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import Loader from "./Loader"

interface PropsType{
    isAuthenticated: boolean,
    /** Auth has not resolved yet — "not signed in" is not yet known. */
    loading?: boolean,
    children?: ReactElement,
    redirect?: string
}

const ProtectedRoute = ({isAuthenticated, loading, children, redirect}:PropsType) => {
    const location = useLocation();

    // The app no longer blocks its first paint on the auth round trip, so this
    // can now run *before* the answer is in. Redirecting on a not-yet-known
    // session would bounce a signed-in customer to the login page on every cold
    // load of /orders — the bug that gating the whole app used to hide. Wait
    // here, where only the guarded route pays for it.
    if (loading && !isAuthenticated) return <Loader />;

    // A signed-out visitor used to be bounced to "/" with no explanation, so
    // clicking Wishlist or My orders silently dumped them on the home page.
    // Send them to sign in instead, remembering where they were headed so the
    // login page can put them back there.
    if (!isAuthenticated)
      return (
        <Navigate
          to={redirect ?? "/login"}
          replace
          state={{ from: location.pathname + location.search }}
        />
      );

  return children? children : <Outlet />
}

export default ProtectedRoute
