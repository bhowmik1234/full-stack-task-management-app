import { Link, Outlet, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/store";
import { ACCOUNT_NAV, isActiveSection } from "./navigation";

/**
 * The shell every signed-in account page renders inside.
 *
 * A pathless layout route (see App.tsx), so the sections keep the URLs the rest
 * of the app already links to. `ProtectedRoute` above it has already
 * established there is a user, so `user` is only ever null for the instant
 * before that redirect commits.
 */
const AccountLayout = () => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const { pathname } = useLocation();

  if (!user) return null;

  return (
    <div className="account page">
      <header className="account__identity">
        {user.photo ? (
          <img src={user.photo} alt="" referrerPolicy="no-referrer" />
        ) : (
          // A phone account has no provider photo, so there is always a
          // fallback rather than a broken image.
          <span className="account__initial">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div>
          <h1>{user.name}</h1>
          <p>{user.email ?? user.phone}</p>
        </div>
      </header>

      <div className="account__body">
        {/* Horizontally scrollable on narrow screens rather than collapsing
            into a menu — six items fit, and a disclosure would hide the only
            navigation on the page. */}
        <nav className="account__nav" aria-label="Account sections">
          {ACCOUNT_NAV.map((section) => {
            const active = isActiveSection(section, pathname);
            return (
              <Link
                key={section.to}
                to={section.to}
                className={
                  active ? "account__nav-item is-active" : "account__nav-item"
                }
                aria-current={active ? "page" : undefined}
              >
                <section.Icon />
                <span>{section.label}</span>
              </Link>
            );
          })}
        </nav>

        <section className="account__content">
          <Outlet />
        </section>
      </div>
    </div>
  );
};

export default AccountLayout;
