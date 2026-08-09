import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { MessageResponse, UserResponse } from "../../types/api-types";
import { ProfileInput, User } from "../../types/types";
import axios from "axios";

export const userAPI = createApi({
    reducerPath: "userApi",
    baseQuery: fetchBaseQuery({ baseUrl: `${import.meta.env.VITE_SERVER}/api/v1/user/` }),
    tagTypes: ["users"],
    endpoints: (builder) => ({
        login: builder.mutation<MessageResponse, User>({
            query: (user)=> ({
                url: "new",
                method: "POST",
                body: user
            }),
            invalidatesTags: ["users"]
        }),
        // Name, gender and date of birth only. Email and phone are identity and
        // are owned by the sign-in provider — `syncIdentity` below is the only
        // thing that writes them, and it reads them back from Firebase rather
        // than believing anything sent from here.
        updateProfile: builder.mutation<UserResponse, { userId: string; body: ProfileInput }>({
            query: ({ userId, body }) => ({
                url: `${userId}?id=${userId}`,
                method: "PUT",
                body,
            }),
            invalidatesTags: ["users"],
        }),
        // Called after linkWithCredential succeeds client-side. Sends no body:
        // the server asks Firebase what this uid actually has linked.
        syncIdentity: builder.mutation<UserResponse, string>({
            query: (userId) => ({
                url: `${userId}/identity?id=${userId}`,
                method: "PUT",
            }),
            invalidatesTags: ["users"],
        }),
        closeAccount: builder.mutation<MessageResponse, string>({
            query: (userId) => ({
                url: `me?id=${userId}`,
                method: "DELETE",
            }),
            invalidatesTags: ["users"],
        }),

        // The signed-in half of the unsubscribe link in every notification
        // footer. Both write the same column; this one exists so the choice is
        // reversible without hunting for an old email.
        updateEmailPreferences: builder.mutation<
            MessageResponse & { emailOptOut: boolean },
            { userId: string; emailOptOut: boolean }
        >({
            query: ({ userId, emailOptOut }) => ({
                url: `me/email-preferences?id=${userId}`,
                method: "PUT",
                body: { emailOptOut },
            }),
            invalidatesTags: ["users"],
        }),
    }),
});

// ?id= is the caller's own uid: the endpoint is now self-or-admin, so it must
// be sent even when fetching your own record.
export const getUser = async(id: string) =>{
    const {data}:{data:UserResponse} = await axios.get(`${import.meta.env.VITE_SERVER}/api/v1/user/${id}?id=${encodeURIComponent(id)}`);
    return data;
}

export const {
    useLoginMutation,
    useUpdateProfileMutation,
    useSyncIdentityMutation,
    useCloseAccountMutation,
    useUpdateEmailPreferencesMutation,
} = userAPI;