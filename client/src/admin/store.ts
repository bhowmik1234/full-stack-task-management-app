import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { adminAPI } from "./api";
import { sessionSlice } from "./session";
import type { Permission } from "./permissions";

/**
 * The console's own store. It shares no reducer with the storefront — there is
 * no cart here, and the session has states the storefront's user slice cannot
 * represent (see session.ts).
 */
export const store = configureStore({
  reducer: {
    [adminAPI.reducerPath]: adminAPI.reducer,
    [sessionSlice.name]: sessionSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(adminAPI.middleware),
});

export type AdminState = ReturnType<typeof store.getState>;
export type AdminDispatch = typeof store.dispatch;

export const useAdminDispatch = useDispatch.withTypes<AdminDispatch>();
export const useAdminSelector = useSelector.withTypes<AdminState>();

/**
 * What the signed-in operator may do.
 *
 * A hook rather than a plain function so it re-renders when a session reload
 * changes the answer. It gates *rendering* only — hiding a button the server
 * would refuse is a courtesy, not a control, and every endpoint behind it
 * checks the same permission again.
 */
export const useCan = () => {
  const permissions = useAdminSelector((state) => state.session.permissions);
  return (permission: Permission) => permissions.includes(permission);
};

/** True for the owner account, which is the only thing that may manage access. */
export const useIsRoot = () => useAdminSelector((state) => state.session.isRoot);
