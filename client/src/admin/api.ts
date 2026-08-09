import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";
import { adminServer, currentIdToken } from "./config";
import { getDevSession } from "../utils/devAuth";
import {
  AccessCatalogResponse,
  ActivityResponse,
  AdminMessageResponse,
  AdminOrderResponse,
  AdminOrdersResponse,
  AdminProductResponse,
  AdminProductsResponse,
  AdminUsersResponse,
  AdminCouponsResponse,
  AnalyticsRange,
  AnalyticsResponse,
  CandidatesResponse,
  CouponInput,
  StaffListResponse,
  AdminReturnsResponse,
} from "./types";
import type { Permission } from "./permissions";

/**
 * One slice for the whole console.
 *
 * The storefront's five slices are split by resource because each is consumed
 * by unrelated pages; the console is one screenful of connected data, where a
 * product edit has to invalidate the analytics and the audit trail as well as
 * the product list. Keeping it in one slice makes those relationships
 * declarable in `invalidatesTags` instead of coordinated by hand.
 *
 * **No endpoint here sends `?id=`.** Admin routes take the caller's identity
 * from the verified ID token and ignore the query string entirely — if they
 * did not, an operator could authenticate as themselves and then act as
 * somebody else by editing one parameter, which would be worse than the scheme
 * this replaced. The uid is therefore not a parameter of any request below,
 * which is also why none of these hooks needs an `adminId` argument any more.
 */

const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${adminServer}/api/v1/`,
  prepareHeaders: async (headers) => {
    const token = await currentIdToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    return headers;
  },
});

/** Appends the dev bypass's uid, which has no Firebase session to tokenise. */
const withDevId = (args: string | FetchArgs, uid: string): string | FetchArgs => {
  const add = (url: string) =>
    `${url}${url.includes("?") ? "&" : "?"}id=${encodeURIComponent(uid)}`;

  return typeof args === "string" ? add(args) : { ...args, url: add(args.url) };
};

/**
 * Adds the credential, and retries once on a stale one.
 *
 * A token lives an hour and the SDK refreshes it lazily, so a tab left open
 * over lunch makes its next request with an expired one. Forcing a refresh and
 * retrying turns that into a pause instead of a spurious "please sign in".
 * Re-authentication challenges are deliberately *not* retried — repeating the
 * request would just fail again; the caller has to prompt the human.
 */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions
) => {
  const devUid = getDevSession();
  const request = devUid ? withDevId(args, devUid) : args;

  const result = await rawBaseQuery(request, api, extraOptions);

  const isStale =
    result.error?.status === 401 &&
    (result.error.data as { code?: string } | undefined)?.code !== "REAUTH_REQUIRED";

  if (!isStale || devUid) return result;

  await currentIdToken(true);
  return rawBaseQuery(request, api, extraOptions);
};

export const adminAPI = createApi({
  reducerPath: "adminApi",
  baseQuery,
  tagTypes: [
    "analytics",
    "product",
    "order",
    "user",
    "activity",
    "staff",
    "coupon",
    "returns",
  ],
  endpoints: (builder) => ({
    analytics: builder.query<AnalyticsResponse, AnalyticsRange>({
      query: (range) => `dashboard/analytics?range=${range}`,
      providesTags: ["analytics"],
    }),

    activity: builder.query<ActivityResponse, number | void>({
      query: (limit = 100) => `dashboard/activity?limit=${limit}`,
      providesTags: ["activity"],
    }),

    // ---------------------------------------------------------- products ---
    products: builder.query<AdminProductsResponse, void>({
      query: () => "product/admin-products",
      providesTags: ["product"],
    }),

    product: builder.query<AdminProductResponse, string>({
      // reading one product is a public endpoint; no credential to send
      query: (productId) => `product/${productId}`,
      providesTags: ["product"],
    }),

    createProduct: builder.mutation<AdminMessageResponse, FormData>({
      query: (body) => ({ url: "product/new", method: "POST", body }),
      invalidatesTags: ["product", "analytics", "activity"],
    }),

    updateProduct: builder.mutation<
      AdminMessageResponse,
      { productId: string; body: FormData }
    >({
      query: ({ productId, body }) => ({
        url: `product/${productId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["product", "analytics", "activity"],
    }),

    deleteProduct: builder.mutation<AdminMessageResponse, string>({
      query: (productId) => ({ url: `product/${productId}`, method: "DELETE" }),
      invalidatesTags: ["product", "analytics", "activity"],
    }),

    // ------------------------------------------------------------ orders ---
    orders: builder.query<AdminOrdersResponse, void>({
      query: () => "order/all",
      providesTags: ["order"],
    }),

    order: builder.query<AdminOrderResponse, string>({
      query: (orderId) => `order/${orderId}`,
      providesTags: ["order"],
    }),

    // Advances fulfilment one step: Processing -> Shipped -> Delivered. The
    // backend refuses anything else, so the UI only offers it where it applies.
    //
    // The optional carrier/tracking fields are captured on the Processing ->
    // Shipped step and ignored on the other. There is deliberately no separate
    // "add tracking" endpoint: a second screen to remember is a screen that gets
    // skipped, and the tracking is only useful if it reaches the shipping email
    // that this same transition sends.
    advanceOrder: builder.mutation<
      AdminMessageResponse,
      { orderId: string; carrier?: string; trackingNumber?: string; trackingUrl?: string }
    >({
      query: ({ orderId, ...body }) => ({
        url: `order/${orderId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["order", "analytics", "activity"],
    }),

    // ---------------------------------------------------------- returns ---
    // Defaults to the open statuses — the page exists to be worked through, and
    // a list that opens on years of settled requests buries the four that need
    // a decision today.
    returns: builder.query<AdminReturnsResponse, string | void>({
      query: (status) => `returns/all?status=${status ?? "open"}`,
      providesTags: ["returns"],
    }),

    decideReturn: builder.mutation<
      AdminMessageResponse,
      { returnId: string; approved: boolean; note?: string }
    >({
      query: ({ returnId, ...body }) => ({
        url: `returns/${returnId}/decide`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["returns", "order", "activity"],
    }),

    // Restocking is the operator's choice, not automatic: damaged goods come
    // back but do not go back on the shelf.
    receiveReturn: builder.mutation<
      AdminMessageResponse,
      { returnId: string; restock: boolean }
    >({
      query: ({ returnId, restock }) => ({
        url: `returns/${returnId}/receive`,
        method: "POST",
        body: { restock },
      }),
      invalidatesTags: ["returns", "order", "product", "analytics", "activity"],
    }),

    refundReturn: builder.mutation<
      { success: boolean; message: string; amount: number },
      { returnId: string; amount?: number }
    >({
      query: ({ returnId, amount }) => ({
        url: `returns/${returnId}/refund`,
        method: "POST",
        body: amount === undefined ? {} : { amount },
      }),
      invalidatesTags: ["returns", "order", "analytics", "activity"],
    }),

    deleteOrder: builder.mutation<AdminMessageResponse, string>({
      query: (orderId) => ({ url: `order/${orderId}`, method: "DELETE" }),
      // deleting an order returns its reserved stock, so the catalogue moves too
      invalidatesTags: ["order", "product", "analytics", "activity"],
    }),

    // --------------------------------------------------------- customers ---
    users: builder.query<AdminUsersResponse, void>({
      query: () => "user/all",
      providesTags: ["user"],
    }),

    deleteUser: builder.mutation<AdminMessageResponse, string>({
      query: (userId) => ({ url: `user/${userId}`, method: "DELETE" }),
      invalidatesTags: ["user", "analytics", "activity"],
    }),

    // ----------------------------------------------------------- coupons ---
    // These live under the *payement* router rather than one of their own —
    // `/api/v1/payement/coupon/...` — which is why the URLs below do not match
    // the section name.
    coupons: builder.query<AdminCouponsResponse, void>({
      query: () => "payement/coupon/all",
      providesTags: ["coupon"],
    }),

    createCoupon: builder.mutation<AdminMessageResponse, CouponInput>({
      query: (body) => ({ url: "payement/coupon/new", method: "POST", body }),
      invalidatesTags: ["coupon", "activity"],
    }),

    updateCoupon: builder.mutation<
      AdminMessageResponse,
      { couponId: string; body: CouponInput }
    >({
      query: ({ couponId, body }) => ({
        url: `payement/coupon/${couponId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["coupon", "activity"],
    }),

    deleteCoupon: builder.mutation<AdminMessageResponse, string>({
      query: (couponId) => ({ url: `payement/coupon/${couponId}`, method: "DELETE" }),
      invalidatesTags: ["coupon", "activity"],
    }),

    // ------------------------------------------------------------ access ---
    // Root-only. The server refuses all of these for anyone else, whatever the
    // console renders — and every mutation additionally demands a recent
    // sign-in, so these hooks can come back with REAUTH_REQUIRED even for the
    // owner. `stepUp.ts` is what turns that into a prompt.

    accessCatalog: builder.query<AccessCatalogResponse, void>({
      query: () => "access/catalog",
    }),

    staff: builder.query<StaffListResponse, void>({
      query: () => "access/staff",
      providesTags: ["staff"],
    }),

    candidates: builder.query<CandidatesResponse, string>({
      query: (q) => `access/candidates?q=${encodeURIComponent(q)}`,
      // Deliberately untagged and uncached: a live search is not something the
      // grant flow should reuse, and it changes as fast as it is typed.
      keepUnusedDataFor: 0,
    }),

    grantAccess: builder.mutation<
      AdminMessageResponse,
      { userId: string; permissions: Permission[]; note?: string }
    >({
      query: (body) => ({ url: "access/staff", method: "POST", body }),
      // The customer list shows who is staff, and the grant is audited.
      invalidatesTags: ["staff", "user", "activity"],
    }),

    updateAccess: builder.mutation<
      AdminMessageResponse,
      { userId: string; permissions: Permission[]; note?: string | null }
    >({
      query: ({ userId, ...body }) => ({
        url: `access/staff/${userId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["staff", "activity"],
    }),

    setAccessStatus: builder.mutation<
      AdminMessageResponse,
      { userId: string; action: "suspend" | "restore" }
    >({
      query: ({ userId, action }) => ({
        url: `access/staff/${userId}/${action}`,
        method: "POST",
      }),
      invalidatesTags: ["staff", "user", "activity"],
    }),

    revokeAccess: builder.mutation<AdminMessageResponse, string>({
      query: (userId) => ({ url: `access/staff/${userId}`, method: "DELETE" }),
      invalidatesTags: ["staff", "user", "activity"],
    }),

    transferRoot: builder.mutation<AdminMessageResponse, string>({
      query: (userId) => ({
        url: "access/root",
        method: "POST",
        // The server requires this token, so a request that reaches the API by
        // any route other than the confirmation dialog is refused.
        body: { userId, confirm: "TRANSFER" },
      }),
      invalidatesTags: ["staff", "activity"],
    }),
  }),
});

export const {
  useAnalyticsQuery,
  useActivityQuery,
  useProductsQuery,
  useProductQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useOrdersQuery,
  useOrderQuery,
  useAdvanceOrderMutation,
  useDeleteOrderMutation,
  useReturnsQuery,
  useDecideReturnMutation,
  useReceiveReturnMutation,
  useRefundReturnMutation,
  useUsersQuery,
  useDeleteUserMutation,
  useCouponsQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
  useAccessCatalogQuery,
  useStaffQuery,
  useCandidatesQuery,
  useGrantAccessMutation,
  useUpdateAccessMutation,
  useSetAccessStatusMutation,
  useRevokeAccessMutation,
  useTransferRootMutation,
} = adminAPI;
