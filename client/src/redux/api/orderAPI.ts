import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import {
    CheckoutRequest,
    CheckoutResponse,
    OrderPaymentResponse,
    MessageResponse,
    MyOrdersResponse,
    orderDetailsResponse,
    UpdateOrderRequest,
    VerifyPaymentRequest,
} from "../../types/api-types";

// Storefront only — a customer's own orders. Listing every order, advancing
// fulfilment and deleting live in the console's slice (src/admin/api.ts).
export const orderAPI = createApi({
    reducerPath: "orderApi",
    baseQuery: fetchBaseQuery({
        baseUrl: `${import.meta.env.VITE_SERVER}/api/v1/`,
    }),
    tagTypes: ["orders"],
    endpoints: (builder) => ({
        // Step 1 of checkout: creates the order (PendingPayment) and reserves
        // its stock, then hands back the Razorpay handle. Replaces the old
        // newOrder mutation, which ran *after* the charge.
        createCheckout: builder.mutation<CheckoutResponse, CheckoutRequest>({
            query: ({ userId, ...body }) => ({
                url: `order/checkout?id=${userId}`,
                method: "POST",
                body,
            }),
            invalidatesTags: ["orders"],
        }),
        // Re-opens the Razorpay handle for an order that is still unpaid, so
        // reloading /pay/:id works instead of stranding the customer.
        orderPayment: builder.query<OrderPaymentResponse, UpdateOrderRequest>({
            query: ({ orderId, userId }) => `order/${orderId}/payment?id=${userId}`,
            // never cached: the modal must open against a live handle
            keepUnusedDataFor: 0,
        }),
        // Fast path only — the webhook is what guarantees the order is marked
        // paid, so a failure here is not a failed payment.
        verifyPayment: builder.mutation<MessageResponse, VerifyPaymentRequest>({
            query: ({ userId, ...body }) => ({
                url: `payement/verify?id=${userId}`,
                method: "POST",
                body,
            }),
            invalidatesTags: ["orders"],
        }),
        cancelOrder: builder.mutation<MessageResponse, UpdateOrderRequest>({
            query: ({ userId, orderId }) => ({
                url: `order/${orderId}/cancel?id=${userId}`,
                method: "POST",
            }),
            invalidatesTags: ["orders"],
        }),
        myOrders: builder.query<MyOrdersResponse, string>({
            query: (id) => `order/my?id=${id}`,
            providesTags: ["orders"]
        }),
        orderDetails: builder.query<orderDetailsResponse, UpdateOrderRequest>({
            query: ({orderId, userId}) => `order/${orderId}?id=${userId}`,
            providesTags: ["orders"]
        }),
    }),
});

export const {
    useCreateCheckoutMutation,
    useOrderPaymentQuery,
    useVerifyPaymentMutation,
    useCancelOrderMutation,
    useMyOrdersQuery,
    useOrderDetailsQuery
} = orderAPI;
