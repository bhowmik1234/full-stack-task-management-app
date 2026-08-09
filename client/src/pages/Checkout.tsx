import { useState } from "react";
import toast from "react-hot-toast";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../redux/store";
import {
    useOrderPaymentQuery,
    useVerifyPaymentMutation,
} from "../redux/api/orderAPI";
import { resetCart } from "../redux/reducer/cartReducer";
import { formatINR } from "../utils/features";
import { CustomError } from "../types/api-types";
import CheckoutSteps from "../components/CheckoutSteps";
import { Skeleton } from "../components/Loader";
import { loadRazorpay, openRazorpay, RazorpayHandlerResponse } from "../utils/razorpay";

/**
 * Payment step, at /pay/:orderId.
 *
 * The order already exists by the time this renders — Shipping created it and
 * reserved its stock. That inversion is what makes this page safe to reload,
 * bookmark or come back to: it re-fetches the Razorpay handle from the order
 * id rather than carrying a one-shot secret in router state, which is what the
 * old Stripe version did (and lost on every refresh, minting a new
 * PaymentIntent each time).
 *
 * It also means this page cannot lose a payment. If the customer pays and then
 * closes the tab before `verifyPayment` runs, Razorpay's webhook marks the
 * order paid server-side anyway.
 */
const Checkout = () => {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const { user } = useSelector((state: RootState) => state.userReducer);

    const [isPaying, setIsPaying] = useState(false);

    const { data, isLoading, isError, error } = useOrderPaymentQuery(
        { orderId: orderId!, userId: user?._id! },
        { skip: !orderId || !user?._id }
    );

    const [verifyPayment] = useVerifyPaymentMutation();

    if (!orderId) return <Navigate to="/cart" />;

    if (isLoading) {
        return (
            <div className="checkout page">
                <CheckoutSteps current={3} />
                <Skeleton length={6} height="2.5rem" />
            </div>
        );
    }

    // The API distinguishes "already paid", "cancelled" and "expired" with its
    // own message; showing it beats a generic failure, because each one has a
    // different next step for the customer.
    if (isError || !data) {
        const message =
            (error as CustomError)?.data?.message ??
            "We couldn't open the payment for this order.";
        return (
            <div className="page">
                <div className="empty-state">
                    <h2>Payment unavailable</h2>
                    <p>{message}</p>
                    <Link to="/orders" className="btn">View my orders</Link>
                </div>
            </div>
        );
    }

    // amount comes back in paise, the unit Razorpay works in
    const totalRupees = data.amount / 100;

    const onPaymentSuccess = async (response: RazorpayHandlerResponse) => {
        const res = await verifyPayment({
            userId: user?._id!,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
        });

        setIsPaying(false);

        if ("data" in res) {
            dispatch(resetCart());
            toast.success("Payment successful");
            navigate(`/orders/${orderId}`);
            return;
        }

        // Verification failing does NOT mean the payment failed — the money may
        // well have moved, and the webhook will settle the order regardless. So
        // this must never tell the customer to pay again.
        dispatch(resetCart());
        toast.error(
            "We're still confirming your payment. Check My orders in a moment — do not pay again."
        );
        navigate(`/orders/${orderId}`);
    };

    const payHandler = async () => {
        if (isPaying) return;
        setIsPaying(true);

        const ready = await loadRazorpay();
        if (!ready) {
            setIsPaying(false);
            return toast.error(
                "Could not reach the payment provider. Check your connection and try again."
            );
        }

        try {
            const instance = openRazorpay({
                key: data.keyId,
                amount: data.amount,
                currency: data.currency,
                order_id: data.razorpayOrderId,
                name: "ebag",
                description: `Order #${orderId.slice(-8).toUpperCase()}`,
                prefill: data.prefill,
                notes: { orderId },
                // matches the dark storefront theme
                theme: { color: "#e11d63" },
                handler: onPaymentSuccess,
                modal: {
                    // Closing the modal is not a failure — the order is still
                    // there and payable until it expires.
                    ondismiss: () => {
                        setIsPaying(false);
                        toast("Payment cancelled. Your order is still waiting.");
                    },
                },
            });

            instance.on("payment.failed", (payload: any) => {
                setIsPaying(false);
                toast.error(
                    payload?.error?.description ??
                    "Payment failed. You can try again."
                );
            });
        } catch {
            setIsPaying(false);
            toast.error("Could not open the payment window. Please try again.");
        }
    };

    return (
        <div className="checkout page">
            <CheckoutSteps current={3} />

            <div className="checkout-container">
                <h1>Payment</h1>
                <p>
                    Order #{orderId.slice(-8).toUpperCase()} — paying{" "}
                    {formatINR(totalRupees)}, securely by Razorpay.
                </p>

                <button type="button" onClick={payHandler} disabled={isPaying}>
                    {isPaying ? "Processing.." : `Pay ${formatINR(totalRupees)}`}
                </button>

                <p className="checkout-container__note">
                    Cards, UPI, net banking and wallets are all accepted. Your items
                    are held for you until this order is paid for — if you close this
                    page you can pick it up again from{" "}
                    <Link to="/orders">My orders</Link>.
                </p>
            </div>
        </div>
    );
};

export default Checkout;
