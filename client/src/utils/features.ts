import { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { MessageResponse } from "../types/api-types"
import { SerializedError } from "@reduxjs/toolkit";
import { NavigateFunction } from "react-router-dom";
import toast from "react-hot-toast";

type Restype = {
    data: MessageResponse;
} |
{
    error: FetchBaseQueryError | SerializedError;
};

export const ResponseToast = (res: Restype, navigate: NavigateFunction |  null, url: string)=>{
    if("data" in res){
        toast.success(res.data.message);
        if(navigate){
            navigate(url);
        }
    } 
    else{
        // On a network failure or a non-JSON response there is no `data`, and
        // reading .message off it threw a TypeError that replaced the real
        // error with a blank screen.
        const error = res.error as FetchBaseQueryError;
        const body = "data" in error ? (error.data as MessageResponse | undefined) : undefined;
        toast.error(body?.message ?? "Something went wrong. Please try again.");
    }
    
}

// Single place that formats money for display. The cart reducer, the backend
// and the Razorpay order are all INR, but several screens still rendered
// a "$" in front of the number.
const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
});

export const formatINR = (amount: number) => inr.format(Number(amount) || 0);

/**
 * How an order status is shown, in one place so the customer's order list, the
 * order page and the admin table can't drift apart.
 *
 * `PendingPayment` is the state checkout creates an order in — the row exists
 * and is holding stock, but no money has arrived. "PendingPayment" is a
 * database word, so it is relabelled for anyone who has to read it.
 */
export const orderStatusLabel = (status: string) =>
    status === "PendingPayment" ? "Awaiting payment" : status;

export const orderStatusTone = (status: string) => {
    switch (status) {
        case "Delivered":
            return "success";
        case "Shipped":
            return "warning";
        case "PendingPayment":
            return "info";
        // the bare .badge is the muted grey — right for something that is over
        case "Cancelled":
            return "muted";
        default:
            return "danger";
    }
};

/** `class` for a status badge, e.g. `badge badge--success`. */
export const orderStatusClass = (status: string) => {
    const tone = orderStatusTone(status);
    return tone === "muted" ? "badge" : `badge badge--${tone}`;
};
