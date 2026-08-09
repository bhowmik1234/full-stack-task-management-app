import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { useStorefrontConfigQuery } from "../redux/api/returnsAPI";
import { calculatePrice, storeConfig } from "../redux/reducer/cartReducer";

/**
 * Loads the store's tax and shipping rules into the cart slice, once.
 *
 * Called from `App`, not from the cart, deliberately: the total appears in the
 * header's cart badge and on the product page's perks list as well, so waiting
 * until someone opens `/cart` would mean those render from the defaults and then
 * change under the reader.
 *
 * A failed request is not handled and does not need to be. The slice starts with
 * the same numbers that used to be hardcoded, so an unreachable config endpoint
 * degrades to exactly the behaviour the app had before it existed — and the
 * server re-derives every figure at checkout regardless, so the worst case is a
 * preview that disagrees with a correct charge, not a wrong charge.
 */
export const useStorefrontConfig = () => {
  const dispatch = useDispatch();
  const { data } = useStorefrontConfigQuery();

  useEffect(() => {
    if (!data?.config) return;
    dispatch(storeConfig(data.config));
    // Re-price immediately: a cart restored from a previous session already has
    // items, and its totals were computed with the defaults a moment ago.
    dispatch(calculatePrice());
  }, [data, dispatch]);

  return data?.config;
};
