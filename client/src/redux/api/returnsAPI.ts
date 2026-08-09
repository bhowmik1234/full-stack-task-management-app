import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { ReturnRequest, StorefrontConfig } from "../../types/types";
import { MessageResponse } from "../../types/api-types";

/**
 * Returns, and the storefront's pricing configuration.
 *
 * Two unrelated resources in one slice because both are small, both are read by
 * the same corner of the app (the order page and the cart's total), and a slice
 * per endpoint costs a reducer and a middleware entry in `store.ts` for one
 * query. `/config/storefront` sits here rather than in `productAPI` because it
 * is not about products.
 */
export const returnsAPI = createApi({
  reducerPath: "returnsApi",
  baseQuery: fetchBaseQuery({
    baseUrl: `${import.meta.env.VITE_SERVER}/api/v1/`,
  }),
  tagTypes: ["returns"],
  endpoints: (builder) => ({
    /**
     * Tax, shipping and COD rules.
     *
     * Cached for an hour: these change when an operator edits an environment
     * variable and redeploys, which is not something a shopper's session will
     * see happen. Re-fetching them on every mount would be a request per page
     * view for a value that is effectively static.
     */
    storefrontConfig: builder.query<{ success: boolean; config: StorefrontConfig }, void>({
      query: () => "config/storefront",
      keepUnusedDataFor: 3600,
    }),

    returnReasons: builder.query<{ success: boolean; reasons: string[] }, string>({
      query: (userId) => `returns/reasons?id=${userId}`,
      keepUnusedDataFor: 3600,
    }),

    myReturns: builder.query<{ success: boolean; returns: ReturnRequest[] }, string>({
      query: (userId) => `returns/my?id=${userId}`,
      providesTags: ["returns"],
    }),

    requestReturn: builder.mutation<
      { success: boolean; return: ReturnRequest },
      {
        userId: string;
        orderId: string;
        reason: string;
        note?: string;
        items: { orderItemId: string; quantity: number }[];
      }
    >({
      query: ({ userId, ...body }) => ({
        url: `returns/new?id=${userId}`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["returns"],
    }),

    cancelReturn: builder.mutation<MessageResponse, { userId: string; returnId: string }>({
      query: ({ userId, returnId }) => ({
        url: `returns/${returnId}/cancel?id=${userId}`,
        method: "POST",
      }),
      invalidatesTags: ["returns"],
    }),
  }),
});

export const {
  useStorefrontConfigQuery,
  useReturnReasonsQuery,
  useMyReturnsQuery,
  useRequestReturnMutation,
  useCancelReturnMutation,
} = returnsAPI;
