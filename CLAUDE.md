# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent npm packages, no workspace/monorepo tooling. Install and run each separately.

- `backend/` — Express 4 + TypeScript (ESM, `"type": "module"`) + Prisma 7 / PostgreSQL
- `client/` — React 18 + TypeScript + Vite + Redux Toolkit Query + SCSS

## Commands

Backend (`cd backend`):
- `npm run dev` — dev server via `tsx watch ./src/app.ts` (port hardcoded to 3000 in `src/app.ts`)
- `npm run build` — `prisma generate && tsc` → `dist/`, then copies the generated client to `dist/generated/`. That copy step is required: the client is emitted as `.js` under `src/generated/` and `tsc` will not carry it across, so `npm start` fails without it.
- `npm start` — `node dist/app.js` (requires a build first)
- `npm run migrate:dev` — create + apply a migration from schema changes
- `npm run migrate:deploy` — apply pending migrations (production/CI)
- `npm run studio` — Prisma Studio data browser

Postgres runs as the `db` service in `docker-compose.yml`; `docker compose up -d db` starts it.

## Containers

`docker compose up -d` brings up the whole stack: `db` (postgres 16) → `migrate` → `backend` → `web` (nginx serving the SPA and proxying `/api` + `/uploads`). The `migrate` service reuses the backend image, runs `prisma migrate deploy`, and exits; `backend` waits on `service_completed_successfully`, so a fresh volume gets its schema before the API starts rather than crash-looping on missing tables.

Node base images are `node:24-alpine` (Active LTS). Postgres is pinned to 16 deliberately — bumping the major would require `pg_upgrade` against the existing `pgdata` volume, not just a tag change.

`VITE_*` values are baked into the client bundle at **image build time**, so changing any of them needs `docker compose build web`, not just a restart.

Client (`cd client`):
- `npm run dev` — Vite dev server
- `npm run build` — `tsc && vite build`
- `npm run lint` — `eslint .` (flat config in `eslint.config.js`; ESLint 10 no longer reads `.eslintrc`)

No test framework is configured in either package.

## Environment

`backend/.env`: `DATABASE_URL`, `STRIPE_KEY`, `CLOUD_NAME`, `CLOUD_API_KEY`, `CLOUD_API_SECRET`.
Root `.env` (docker compose only): the above plus `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`/`POSTGRES_PORT` and the `VITE_*` client build args. Inside compose the DB host is the service name `db`; from the host it is `localhost:${POSTGRES_PORT}`.

`client/.env`: `VITE_SERVER` (backend origin, no trailing slash), `VITE_STRIPE_PROMISES`, and `VITE_FIREBASE_*` (key, domain, project id, bucket, sender id, appid, measurement id).

## Backend architecture

**ESM import rule** — `module: "NodeNext"` with ESM output means every relative import must carry a `.js` extension even in `.ts` source (`import { prisma } from "../utils/db.js"`). Omitting it breaks at runtime, not compile time.

**Database access** — a single `PrismaClient` (`prisma`, exported from `src/utils/db.ts`) backed by the `@prisma/adapter-pg` driver adapter. Schema lives in `prisma/schema.prisma`; Prisma 7 keeps the connection URL in `prisma.config.ts` (CLI) and the adapter (runtime), *not* in a `url` field on the datasource. `src/utils/db.ts` imports `dotenv/config` itself because ESM evaluates it before `app.ts`'s own `config()` call.

**Money is `Decimal`, not float.** Every price/total column is `@db.Decimal(10,2)`, so Prisma hands back `Decimal` objects that serialize as `{"s":..,"e":..,"d":[..]}` if passed straight to `res.json()`. Convert at the boundary via `src/utils/serialize.ts`.

**Response shaping** — the client still reads Mongo-era shapes (`_id`, a nested `shippingInfo`, `orderItems`). `src/utils/serialize.ts` rebuilds them from the relational rows, which is why the frontend needed no changes. It is the single place to touch if the client ever moves to plain `id`.

**Invariants live in the schema.** `CHECK` constraints enforce non-negative stock/price/total and positive quantity (`prisma/migrations/*_add_check_constraints`). `OrderItem.productId` is `onDelete: Restrict`, so a product with order history cannot be deleted; `WishlistItem` has a composite `@@id([userId, productId])` making duplicate wishlist rows impossible. Prefer adding a constraint over adding a runtime check.

**Order placement is transactional.** `newOrder` wraps pricing, stock reservation and order creation in one `prisma.$transaction`. Stock is reserved with `updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })` — the check and the decrement are a single atomic statement, so concurrent checkouts for the last unit cannot both succeed. Never create the order before reserving stock.

**Controller wrapper** — every controller is wrapped in `TryCatch` from `src/middlewares/error.ts`, which forwards rejections to `errorMiddleware`. Errors are thrown as `next(new ErrorHandler(message, statusCode))` (`src/utils/utiliy-class.ts` — note the spelling). Do not add try/catch inside controllers; the wrapper handles it.

**Auth is query-param based, not token based.** There is no JWT/session. Firebase Auth runs entirely on the client; the client passes the Firebase UID as `?id=<uid>` on requests, and `adminOnly`/`verifyUser` in `src/middlewares/auth.ts` look that id up in Postgres and check `role`. `User.id` is therefore a `TEXT` column holding the Firebase UID, not a generated key. `Product.id` is likewise `TEXT` and still holds the original 24-char Mongo ObjectId hex for rows that predate the Postgres migration, so historical `OrderItem.productId` references stayed valid; new products get a UUID.

**Caching** — a single in-process `NodeCache` instance (`myCache`, exported from `src/app.ts`) fronts most read endpoints. Values are stored as JSON strings, so reads are `JSON.parse(myCache.get(key)!)`. Any mutation must call `invalidateCache({ product, order, wishlist, admin, userId, orderId, productId })` from `src/utils/features.ts`. Cache keys are conventional strings: `latest-products`, `categories`, `all-products`, `product-${id}`, `all-orders`, `my-orders-${userId}`, `order-${id}`, `wishlist-${userId}`, `admin-stats`, `admin-pie-charts`, `admin-bar-charts`, `admin-line-charts`. When adding a cached endpoint, add its key to `invalidateCache` too — a missed key shows up as stale data, not an error.

The dashboard endpoints are **not** cached: `src/controllers/stats.ts` runs SQL aggregations (`count`/`groupBy`/`aggregate`, and `monthlyBuckets` for the month series) rather than loading rows and counting in JS, so the cache no longer earns its place there. Measure before adding caching back.

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
- The API emits `_id` (and `id`) on every entity purely for client compatibility. Add it via `src/utils/serialize.ts` rather than hand-rolling the mapping in a controller.
- `scripts/migrate-mongo-to-postgres.ts` is the one-shot Mongo→Postgres ETL, kept as the record of how the data was transformed. It imports `mongoose`, which is no longer a dependency — running it again needs `npm i mongoose --no-save` first.
