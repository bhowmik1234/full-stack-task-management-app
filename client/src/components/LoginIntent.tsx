import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import toast from "react-hot-toast";
import { RootState } from "../redux/store";
import { useAddWishListMutation } from "../redux/api/wishlistAPI";
import { readLoginState } from "../utils/loginRedirect";

/**
 * Finishes the one action that survives a trip through sign-in.
 *
 * Sending a signed-out visitor to /login and back to the page they were on
 * fixes the dead end, but the wishlist heart is still a second click away from
 * where they left it — they clicked it once already. The click is carried
 * through the login round trip as `location.state.intent` (see
 * utils/loginRedirect.ts) and finished here.
 *
 * Renders nothing, and lives at the router's root rather than on a page because
 * the heart appears on the product page *and* on every card in every grid, and
 * "add this product to the wishlist" is a plain mutation that belongs to none
 * of them.
 *
 * Deliberately not a general pending-action queue. One intent type, carried in
 * router state that a fresh navigation discards on its own — a storage-backed
 * version would replay a click someone made last week.
 */
const LoginIntent = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.userReducer);
  const [addWishList] = useAddWishListMutation();

  // Strict mode runs effects twice in development, and a completed intent
  // must not be a second POST — the endpoint is idempotent, but the toast is
  // not.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const { intent } = readLoginState(location.state);
    if (!intent || !user?._id) return;

    const key = `${intent.type}:${intent.productId}`;
    if (handled.current === key) return;
    handled.current = key;

    // Clear the state first, so a reload or a back-navigation onto this entry
    // does not look like a fresh intent.
    navigate(location.pathname + location.search, { replace: true, state: null });

    addWishList({ userId: user._id, productId: intent.productId })
      .unwrap()
      .then(() => toast.success("Saved to your wishlist."))
      .catch(() => toast.error("Could not save that to your wishlist."));
  }, [location, user?._id, addWishList, navigate]);

  return null;
};

export default LoginIntent;
