# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent npm packages, no workspace/monorepo tooling. Install and run each separately.

- `backend/` — Express 4 + TypeScript (ESM, `"type": "module"`) + Mongoose
- `client/` — React 18 + TypeScript + Vite + Redux Toolkit Query + SCSS

## Commands

Backend (`cd backend`):
- `npm run dev` — dev server via `tsx watch ./src/app.ts` (port hardcoded to 3000 in `src/app.ts`)
- `npm run build` — `tsc` → `dist/`
- `npm start` — `node dist/app.js` (requires a build first)

Client (`cd client`):
- `npm run dev` — Vite dev server
- `npm run build` — `tsc && vite build`
- `npm run lint` — `eslint . --ext ts,tsx --max-warnings 0`

No test framework is configured in either package.

## Environment

`backend/.env`: `MONGO_URI`, `STRIPE_KEY`, `CLOUD_NAME`, `CLOUD_API_KEY`, `CLOUD_API_SECRET`.
The Mongo database name is hardcoded to `Ecommerce_24` in `src/utils/configdb.ts`.

`client/.env`: `VITE_SERVER` (backend origin, no trailing slash), `VITE_STRIPE_PROMISES`, and `VITE_FIREBASE_*` (key, domain, project id, bucket, sender id, appid, measurement id).

## Backend architecture

**ESM import rule** — `module: "NodeNext"` with ESM output means every relative import must carry a `.js` extension even in `.ts` source (`import { User } from "../models/user.js"`). Omitting it breaks at runtime, not compile time.

**Controller wrapper** — every controller is wrapped in `TryCatch` from `src/middlewares/error.ts`, which forwards rejections to `errorMiddleware`. Errors are thrown as `next(new ErrorHandler(message, statusCode))` (`src/utils/utiliy-class.ts` — note the spelling). Do not add try/catch inside controllers; the wrapper handles it.

**Auth is query-param based, not token based.** There is no JWT/session. Firebase Auth runs entirely on the client; the client passes the Firebase UID as `?id=<uid>` on requests, and `adminOnly`/`verifyUser` in `src/middlewares/auth.ts` look that id up in Mongo and check `role`. The User `_id` is therefore a `String` (the Firebase UID), not an ObjectId.

**Caching** — a single in-process `NodeCache` instance (`myCache`, exported from `src/app.ts`) fronts most read endpoints. Values are stored as JSON strings, so reads are `JSON.parse(myCache.get(key)!)`. Any mutation must call `invalidateCache({ product, order, wishlist, admin, userId, orderId, productId })` from `src/utils/features.ts`. Cache keys are conventional strings: `latest-products`, `categories`, `all-products`, `product-${id}`, `all-orders`, `my-orders-${userId}`, `order-${id}`, `wishlist-${userId}`, `admin-stats`, `admin-pie-charts`, `admin-bar-charts`, `admin-line-charts`. When adding a cached endpoint, add its key to `invalidateCache` too — a missed key shows up as stale data, not an error.

**Image uploads** — `singleUpload` (multer, field name `photo`) writes to `backend/uploads/` with a UUID filename, and the product's `photo` field stores that relative disk path. `app.use('/uploads', express.static("uploads"))` serves them, and the client builds URLs as `${VITE_SERVER}/${photo}`. `uploadToCloudinary`/`deleteFromCloudinary` exist in `src/utils/features.ts` and Cloudinary is configured at startup, but the product flow still uses local disk storage — both paths are live, so check which one a given controller uses before changing it.

**Route mounting** (`src/app.ts`): `/api/v1/user`, `/api/v1/product`, `/api/v1/order`, `/api/v1/payement` (spelled that way in URL, route file, and controller), `/api/v1/dashboard`. Wishlist endpoints live under the *product* router: `/api/v1/product/wishlist/{my,:id,delete/:id}`.

`backend/dist/` is committed to git. It goes stale unless `npm run build` is rerun.

## Client architecture

**State** — `src/redux/store.ts` composes five RTK Query API slices (`userAPI`, `productAPI`, `orderAPI`, `dashboardAPI`, `wishlistAPI`) plus two plain slices (`userReducer`, `cartReducer`). Each API slice sets its own `baseUrl` from `VITE_SERVER` and manages cache invalidation through `tagTypes` / `providesTags` / `invalidatesTags`. Adding a slice means registering both its reducer and its middleware in `store.ts`.

Every mutation/admin query takes the user id as a query param (`?id=${userId}`) to satisfy the backend's `adminOnly` middleware — follow that pattern when adding endpoints.

**Auth flow** — `App.tsx` subscribes to Firebase `onAuthStateChanged`, fetches the app user via the plain-axios `getUser(uid)` helper in `redux/api/userAPI.ts` (not an RTK Query endpoint, because it runs outside React), and dispatches `userExits`/`userNotExits`. `ProtectedRoute` gates routes on `isAuthenticated` and `adminOnly`/`admin`.

**Cart totals** are computed client-side in `cartReducer.calculatePrice`: 18% tax, ₹200 shipping waived above ₹1000 subtotal, minus coupon discount. Currency is INR throughout, including the Stripe PaymentIntent.

**Admin tables** all go through `components/admin/TableHOC.tsx` — a generic function that takes `(columns, data, containerClassname, heading, showPagination)` and returns a component using `react-table` v7 with `useSortBy` + `usePagination` (page size 6). `src/types/react-table-config.d.ts` carries the module augmentation that makes v7's plugin types work.

**Styles** are SCSS partials under `src/styles/`, aggregated by `app.scss` (storefront) and `admin-styles/app.scss` (admin).

Routes are lazy-loaded in `App.tsx`; storefront pages live in `src/pages/`, admin pages in `src/pages/admin/`.

## Conventions worth matching

- Shared response/request types live in `client/src/types/api-types.ts` and `client/src/types/types.ts`; backend request-body and query types live in `backend/src/types/types.ts`. They are duplicated by hand, not generated — update both sides when an endpoint's shape changes.
- Product `category` is lowercased on write (`category.toLocaleLowerCase()`), so queries should assume lowercase.
- Several existing identifiers are misspelled and are load-bearing (`payement`, `utiliy-class`, `useSeatchProductsQuery`, `ProdectDetails`, `userExits`). Match the existing spelling rather than "fixing" it in passing.
