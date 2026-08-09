import { configureStore } from "@reduxjs/toolkit";
import { userAPI } from "./api/userAPI";
import { userReducer } from "./reducer/userReducer";
import { productAPI } from "./api/productAPI";
import { cartReducer } from "./reducer/cartReducer";
import { orderAPI } from "./api/orderAPI";
import { wishlistAPI } from "./api/wishlistAPI";
import { addressAPI } from "./api/addressAPI";
import { returnsAPI } from "./api/returnsAPI";

export const server = import.meta.env.VITE_SERVER;

// There is no dashboard slice here any more: the console has its own store
// (src/admin/store.ts) on its own host, and the endpoints it called are gone.

export const store = configureStore({
    reducer: {
        [userAPI.reducerPath]: userAPI.reducer,
        [userReducer.name]: userReducer.reducer,
        [productAPI.reducerPath]: productAPI.reducer,
        [cartReducer.name]: cartReducer.reducer,
        [orderAPI.reducerPath]: orderAPI.reducer,
        [wishlistAPI.reducerPath] : wishlistAPI.reducer,
        [addressAPI.reducerPath] : addressAPI.reducer,
        [returnsAPI.reducerPath] : returnsAPI.reducer
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(
            userAPI.middleware,
            productAPI.middleware,
            orderAPI.middleware,
            wishlistAPI.middleware,
            addressAPI.middleware,
            returnsAPI.middleware
        ),
});

export type RootState = ReturnType<typeof store.getState>;

// Needed wherever a component dispatches an RTK Query thunk directly rather
// than through a generated hook — "Buy these again" on the order page fetches
// each product's *current* price and stock that way.
export type AppDispatch = typeof store.dispatch;
