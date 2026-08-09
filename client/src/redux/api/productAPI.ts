import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { AllProductResponse, CategoriesResponse, DeleteReviewRequest, MessageResponse, MyReviewResponse, MyReviewsResponse, NewReviewRequest, ProductResponse, ReviewsResponse, SearchProductsRequest, SearchProductsResponse, StockAlertResponse, SuggestResponse } from "../../types/api-types";

// Storefront only. Product creation, editing and the unpaginated admin
// catalogue live in the console's own slice (src/admin/api.ts) and are not
// shipped to shoppers.
export const productAPI = createApi({
    reducerPath: "productApi",
    baseQuery: fetchBaseQuery({ baseUrl: `${import.meta.env.VITE_SERVER}/api/v1/product/` }),
    tagTypes:["product", "review", "stockAlert"],
    endpoints: (builder) => ({
        // The catalogue reads below set an explicit keepUnusedDataFor.
        //
        // RTK Query's default is 60 seconds, after which the cache entry is
        // dropped and the next mount refetches. For data that is *already*
        // cached server-side and only changes when an operator edits a product,
        // that meant a shopper going home -> product -> back re-fetched a list
        // the server answered from memory anyway — a round trip whose only
        // effect was a spinner. Every one of these carries providesTags:
        // ["product"], so a create, edit or delete still invalidates them
        // immediately. The lifetime governs how long *unused* data survives,
        // not how stale it is allowed to get.
        latestProducts: builder.query<AllProductResponse, string>({query: ()=> "latest", providesTags:[ "product"], keepUnusedDataFor: 300}),
        // Categories drive the header rail, so this is mounted on every page
        // and effectively never unused. An hour keeps it out of the way.
        categories: builder.query<CategoriesResponse, string>({query: ()=> `category`, providesTags:[ "product"], keepUnusedDataFor: 3600}),
        seatchProducts: builder.query<SearchProductsResponse, SearchProductsRequest>(
            {query: ({price, search, sort, category, page})=> {
                let base = `all?search=${search}&page=${page}`;

                if (price) base += `&price=${price}`;
                if (sort) base += `&sort=${sort}`;
                if (category) base += `&category=${category}`;

                return base;
            }
            , providesTags:[ "product"]
            // Paging back and forth through results, or clearing a filter to
            // re-apply it, is the common browsing pattern and was a refetch
            // every time.
            , keepUnusedDataFor: 300

        }),
        // Prefetched on card hover (components/ProductCart.tsx), so this entry
        // usually exists before the detail page mounts. Kept long enough that
        // going back to the grid and returning is free.
        ProdectDetails: builder.query<ProductResponse, string>({query: (id)=> id, providesTags:[ "product"], keepUnusedDataFor: 300}),
        // "You may also like" on the product page. Ranked and self-excluded by
        // the server, so the component renders the list exactly as it arrives.
        relatedProducts: builder.query<AllProductResponse, string>({
            query: (productId) => `${productId}/related`,
            providesTags: ["product"],
            keepUnusedDataFor: 300,
        }),
        // Header type-ahead. Cached per search term, so backspacing through a
        // word costs nothing and retyping it costs nothing — five minutes is
        // well beyond the life of one search session, and an admin edit
        // invalidates "product" anyway.
        suggest: builder.query<SuggestResponse, string>({
            query: (q) => `suggest?q=${encodeURIComponent(q)}`,
            providesTags: ["product"],
            keepUnusedDataFor: 300,
        }),
        // Reviews live under the product they belong to.
        productReviews: builder.query<ReviewsResponse, string>({
            query: (productId) => `${productId}/reviews`,
            providesTags: ["review"],
        }),
        myReview: builder.query<MyReviewResponse, { productId: string; userId: string }>({
            query: ({ productId, userId }) => `${productId}/reviews/mine?id=${userId}`,
            providesTags: ["review"],
        }),
        // Everything the caller has written, for the account page. A separate
        // endpoint from myReview above, which answers "have I reviewed *this*
        // product" and is keyed by product.
        myReviews: builder.query<MyReviewsResponse, string>({
            query: (userId) => `reviews/mine?id=${userId}`,
            providesTags: ["review"],
        }),
        newReview: builder.mutation<MessageResponse, NewReviewRequest>({
            query: ({ productId, userId, ...body }) => ({
                url: `${productId}/reviews?id=${userId}`,
                method: "POST",
                body,
            }),
            // "product" too: a new review moves the average rating shown on
            // the detail page and on every card.
            invalidatesTags: ["review", "product"],
        }),
        deleteReview: builder.mutation<MessageResponse, DeleteReviewRequest>({
            query: ({ productId, userId }) => ({
                url: `${productId}/reviews?id=${userId}`,
                method: "DELETE",
            }),
            invalidatesTags: ["review", "product"],
        }),

        // Back-in-stock request for the product page. Tagged separately from
        // "product" so toggling the alert does not refetch the catalogue.
        stockAlert: builder.query<StockAlertResponse, { productId: string; userId: string }>({
            query: ({ productId, userId }) => `${productId}/stock-alert?id=${userId}`,
            providesTags: ["stockAlert"],
        }),
        watchStock: builder.mutation<MessageResponse, { productId: string; userId: string }>({
            query: ({ productId, userId }) => ({
                url: `${productId}/stock-alert?id=${userId}`,
                method: "POST",
            }),
            invalidatesTags: ["stockAlert"],
        }),
        unwatchStock: builder.mutation<MessageResponse, { productId: string; userId: string }>({
            query: ({ productId, userId }) => ({
                url: `${productId}/stock-alert?id=${userId}`,
                method: "DELETE",
            }),
            invalidatesTags: ["stockAlert"],
        }),
    }),
});

export const {
    useLatestProductsQuery, 
    useCategoriesQuery,
    useSeatchProductsQuery,
    useProdectDetailsQuery,
    useRelatedProductsQuery,
    useSuggestQuery,
    useProductReviewsQuery,
    useMyReviewQuery,
    useMyReviewsQuery,
    useNewReviewMutation,
    useDeleteReviewMutation,
    useStockAlertQuery,
    useWatchStockMutation,
    useUnwatchStockMutation
} = productAPI;