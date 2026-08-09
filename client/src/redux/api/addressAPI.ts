import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  AddressResponse,
  AddressesResponse,
  MessageResponse,
} from "../../types/api-types";
import { AddressInput } from "../../types/types";

/**
 * The customer's saved shipping addresses.
 *
 * Every request carries `?id=<uid>` like the rest of the storefront; the server
 * scopes each query to that uid and never trusts an address id on its own, so
 * the id in the path is a filter rather than authority.
 */
export const addressAPI = createApi({
  reducerPath: "addressApi",
  baseQuery: fetchBaseQuery({
    baseUrl: `${import.meta.env.VITE_SERVER}/api/v1/address/`,
  }),
  tagTypes: ["address"],
  endpoints: (builder) => ({
    myAddresses: builder.query<AddressesResponse, string>({
      query: (userId) => `my?id=${userId}`,
      providesTags: ["address"],
    }),
    newAddress: builder.mutation<
      AddressResponse,
      { userId: string; body: AddressInput }
    >({
      query: ({ userId, body }) => ({
        url: `new?id=${userId}`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["address"],
    }),
    updateAddress: builder.mutation<
      AddressResponse,
      { userId: string; addressId: string; body: AddressInput }
    >({
      query: ({ userId, addressId, body }) => ({
        url: `${addressId}?id=${userId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["address"],
    }),
    // Setting a default moves it off whichever address held it, so the whole
    // list is refetched rather than one row patched.
    setDefaultAddress: builder.mutation<
      MessageResponse,
      { userId: string; addressId: string }
    >({
      query: ({ userId, addressId }) => ({
        url: `${addressId}/default?id=${userId}`,
        method: "PUT",
      }),
      invalidatesTags: ["address"],
    }),
    deleteAddress: builder.mutation<
      MessageResponse,
      { userId: string; addressId: string }
    >({
      query: ({ userId, addressId }) => ({
        url: `${addressId}?id=${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["address"],
    }),
  }),
});

export const {
  useMyAddressesQuery,
  useNewAddressMutation,
  useUpdateAddressMutation,
  useSetDefaultAddressMutation,
  useDeleteAddressMutation,
} = addressAPI;
