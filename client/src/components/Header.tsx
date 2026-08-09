import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  FaSearch,
  FaShoppingBag,
  FaSignInAlt,
  FaSignOutAlt,
  FaUser,
  FaHeart,
  FaClipboardList,
  FaMapMarkerAlt,
  FaTimes,
} from "react-icons/fa";
import { useEffect, useRef, useState } from "react";
import { currentPath, loginState } from "../utils/loginRedirect";
import { prefetchProps } from "../routes/lazyRoutes";
import { User } from "../types/types";
import toast from "react-hot-toast";
import { RootState } from "../redux/store";
import { useDispatch, useSelector } from "react-redux";
import { userNotExits } from "../redux/reducer/userReducer";
import { clearDevSession, getDevSession } from "../utils/devAuth";
import Logo from "../assets/logo-transparent-png.png";
import { useCategoriesQuery } from "../redux/api/productAPI";
import { useMyWishListQuery } from "../redux/api/wishlistAPI";
import SearchBox from "./SearchBox";

interface PropsTypes {
  user: User | null;
}

const Header = ({ user }: PropsTypes) => {
  const { user: userProfle } = useSelector((state: RootState) => state.userReducer);
  const { cartItems } = useSelector((state: RootState) => state.cartReducer);

  const dispatch = useDispatch();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // The category rail's "you are here" is in the query string, not the path, so
  // NavLink cannot answer it — /search?category=tech and /search are the same
  // route. Compared lowercased because categories are stored lowercased.
  const activeCategory = searchParams.get("category")?.toLocaleLowerCase() ?? null;
  const onSearchRoot = location.pathname === "/search" && !activeCategory;

  // The account menu is a popup, so focus has to be moved into it and put back
  // afterwards — otherwise a keyboard user tabs from the trigger straight past
  // the menu into the page behind the scrim.
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The rail shows what the catalogue actually contains rather than a
  // hard-coded list that linked nowhere.
  const { data: categoryData } = useCategoriesQuery("");
  const { data: wishListData } = useMyWishListQuery(user?._id ?? "", {
    skip: !user?._id,
  });

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const wishCount = wishListData?.WishList.length ?? 0;

  // Any navigation closes the overlays — otherwise the menu stayed open on top
  // of the page you just moved to.
  useEffect(() => {
    setIsOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus into the menu when it opens, back to the trigger when it closes.
  // Returning focus matters more than taking it: without it, closing the menu
  // drops focus onto <body> and the next Tab starts again from the top of the
  // page, nowhere near where the visitor was.
  useEffect(() => {
    if (isOpen) menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    else if (document.activeElement === document.body) triggerRef.current?.focus();
  }, [isOpen]);

  // Tab stays inside the menu while it is open. The scrim stops the mouse
  // reaching the page behind it; this is the same boundary for the keyboard.
  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !menuRef.current) return;
    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLElement>("a, button")
    );
    if (!items.length) return;

    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  };

  const logoutHandler = async () => {
    try {
      // A dev-bypass session has no Firebase user, so signOut alone would leave
      // the stored uid behind and the next reload would sign straight back in.
      if (getDevSession()) {
        clearDevSession();
        dispatch(userNotExits());
      }

      // Imported here rather than at module scope. Header renders on every
      // page, so a static `import { auth } from "../firebase"` put the whole
      // Firebase auth SDK in the entry chunk for the sake of one handler most
      // visitors never trigger. By the time anyone can click this, the module
      // is already loaded and warm — useAuthBootstrap fetched it.
      const [{ auth }, { signOut }] = await Promise.all([
        import("../firebase"),
        import("firebase/auth"),
      ]);
      await signOut(auth);
      toast.success("Signed out");
      setIsOpen(false);

      // Signing out from an account page used to leave the customer on the
      // *sign-in form*: userNotExits fires, ProtectedRoute re-evaluates, and it
      // sends them to /login with state.from pointing back at the page they
      // just left. Go home instead, and `replace` so the back button cannot
      // return to a page this session no longer permits. Settings.tsx does the
      // same on account closure.
      navigate("/", { replace: true });
    } catch (error) {
      toast.error("Sign out failed.");
    }
  };

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__logo" to="/">
          <img src={Logo} alt="ebag — home" />
        </Link>

        {/* The box owns its own term, suggestions and keyboard handling now —
            see components/SearchBox.tsx. Header keeps only the mobile
            open/closed state, which is layout, not search. */}
        <SearchBox
          className={`site-header__search${searchOpen ? " site-header__search--open" : ""}`}
        />

        <nav className="site-header__actions" aria-label="Account and cart">
          <button
            type="button"
            className="site-header__action site-header__search-toggle"
            onClick={() => setSearchOpen((prev) => !prev)}
            aria-label={searchOpen ? "Close search" : "Open search"}
            aria-expanded={searchOpen}
          >
            {searchOpen ? <FaTimes /> : <FaSearch />}
          </button>

          <Link
            className="site-header__action"
            to="/wishlist"
            {...prefetchProps("/wishlist")}
            aria-label={`Wishlist${wishCount ? `, ${wishCount} items` : ""}`}
          >
            <FaHeart />
            {wishCount > 0 && <span className="site-header__count">{wishCount}</span>}
          </Link>

          <Link
            className="site-header__action"
            to="/cart"
            {...prefetchProps("/cart")}
            aria-label={`Cart${cartCount ? `, ${cartCount} items` : ""}`}
          >
            <FaShoppingBag />
            {cartCount > 0 && (
              <span className="site-header__count">{cartCount > 99 ? "99+" : cartCount}</span>
            )}
          </Link>

          {user?._id ? (
            <button
              type="button"
              ref={triggerRef}
              className="site-header__action"
              onClick={() => setIsOpen((prev) => !prev)}
              aria-label="Account menu"
              aria-expanded={isOpen}
              aria-haspopup="menu"
              aria-controls="account-menu"
            >
              {userProfle?.photo ? (
                <img src={userProfle.photo} alt="" />
              ) : (
                <FaUser />
              )}
            </button>
          ) : (
            // Carrying where they are, so signing in returns them to the page
            // they were reading. This is the most-used sign-in entry point in
            // the app and it used to always land on the home page.
            <Link
              className="site-header__action"
              to="/login"
              state={loginState(currentPath(location))}
              aria-label="Sign in"
            >
              <FaSignInAlt />
            </Link>
          )}
        </nav>
      </div>

      {isOpen && user?._id && (
        <>
          <button
            type="button"
            className="site-header__scrim"
            aria-label="Close account menu"
            onClick={() => setIsOpen(false)}
          />
          <div
            className="site-header__menu"
            id="account-menu"
            ref={menuRef}
            role="menu"
            aria-label="Account"
            onKeyDown={trapFocus}
          >
            <div className="site-header__menu-header">
              <strong>{userProfle?.name ?? "My account"}</strong>
              {/* Phone accounts have no email — show whichever identifier
                  this user signed up with. */}
              <span>{userProfle?.email ?? userProfle?.phone}</span>
            </div>

            {/* The storefront never advertises the console, whatever role
                this account holds here. The console is a separate app on its
                own host and operators reach it by its own URL. */}
            <Link to="/profile" role="menuitem" className="site-header__menu-item" {...prefetchProps("/profile")}>
              <FaUser />
              <span>My account</span>
            </Link>
            <Link to="/orders" role="menuitem" className="site-header__menu-item" {...prefetchProps("/orders")}>
              <FaClipboardList />
              <span>My orders</span>
            </Link>
            <Link to="/wishlist" role="menuitem" className="site-header__menu-item" {...prefetchProps("/wishlist")}>
              <FaHeart />
              <span>Wishlist</span>
            </Link>
            <Link to="/addresses" role="menuitem" className="site-header__menu-item" {...prefetchProps("/addresses")}>
              <FaMapMarkerAlt />
              <span>Addresses</span>
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={logoutHandler}
              className="site-header__menu-item site-header__menu-item--danger"
            >
              <FaSignOutAlt />
              <span>Sign out</span>
            </button>
          </div>
        </>
      )}

      {/* Nothing here used to indicate the current section, so there was no way
          to tell which category you were browsing. The account sidebar and the
          checkout steps both mark it with aria-current; this matches them. */}
      <nav className="site-header__nav" aria-label="Categories">
        <ul>
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? "is-active" : "")}
              {...prefetchProps("/")}
            >
              Home
            </NavLink>
          </li>
          <li>
            {/* Not NavLink: it would light up for every category too, since
                they are all the same route with a different query string. */}
            <Link
              to="/search"
              className={onSearchRoot ? "is-active" : ""}
              aria-current={onSearchRoot ? "page" : undefined}
              {...prefetchProps("/search")}
            >
              All products
            </Link>
          </li>
          {categoryData?.categories.map((category) => {
            const isActive = activeCategory === category.toLocaleLowerCase();
            return (
              <li key={category}>
                <Link
                  to={`/search?category=${encodeURIComponent(category)}`}
                  className={isActive ? "is-active" : ""}
                  aria-current={isActive ? "page" : undefined}
                  {...prefetchProps("/search")}
                >
                  {category}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
};

export default Header;
