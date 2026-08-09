import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { signOut } from "firebase/auth";
import { FiLogOut, FiMenu, FiX } from "react-icons/fi";
import { auth } from "../firebase";
import { clearDevSession } from "../../utils/devAuth";
import { useAdminSelector } from "../store";
import { visibleNav } from "../navigation";

const Layout = () => {
  const { user, permissions, isRoot } = useAdminSelector((state) => state.session);
  const [navOpen, setNavOpen] = useState(false);

  // The sidebar lists what this operator can actually open. A tab that leads
  // to a refusal teaches people the tool is broken; a tab that is absent tells
  // them what their job is here.
  const nav = visibleNav(permissions, isRoot);

  const signOutHandler = async () => {
    clearDevSession();
    await signOut(auth).catch(() => {});
    // A dev-bypass session has no Firebase user for onAuthStateChanged to
    // report on, so nothing would tell the store the session ended.
    window.location.assign("/sign-in");
  };

  return (
    <div className={`l-shell${navOpen ? " l-shell--nav-open" : ""}`}>
      <aside className="l-sidebar">
        <div className="l-sidebar__brand">
          <span className="l-sidebar__mark">eb</span>
          <span>
            Console
            <small>ebag admin</small>
          </span>
        </div>

        <nav className="l-nav" aria-label="Console sections">
          {nav.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              // On a phone the sidebar is an overlay; leaving it open across a
              // navigation would hide the page just asked for.
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                isActive ? "l-nav__item l-nav__item--active" : "l-nav__item"
              }
            >
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="l-sidebar__foot">
          <div className="l-account">
            <span className="l-account__avatar" aria-hidden="true">
              {user?.name?.charAt(0).toUpperCase() ?? "?"}
            </span>
            <span className="l-account__id">
              <strong>{user?.name}</strong>
              {/* A phone-only account has no email; both are optional columns. */}
              <small>{user?.email ?? user?.phone ?? "admin"}</small>
            </span>
            {/* Which account you are signed in as matters most when you have
                two — the owner's and your own. */}
            {isRoot && <span className="l-account__tag">Owner</span>}
          </div>
          <button type="button" className="c-btn c-btn--ghost c-btn--block" onClick={signOutHandler}>
            <FiLogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      {/* Only rendered when open, so it can't swallow clicks on desktop. */}
      {navOpen && (
        <button
          type="button"
          className="l-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="l-main">
        <button
          type="button"
          className="l-navtoggle"
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? <FiX /> : <FiMenu />}
        </button>

        <Outlet />
      </div>
    </div>
  );
};

export default Layout;
