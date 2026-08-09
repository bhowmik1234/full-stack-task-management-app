import { useState, useEffect } from "react";
import { VscCheck, VscError } from "react-icons/vsc";
import { FaShoppingBag } from "react-icons/fa";
import { formatINR } from "../utils/features";
import CartItemCard from "../components/CartItem";
import { Link } from "react-router-dom";
import { loginState } from "../utils/loginRedirect";
import { useDispatch, useSelector } from "react-redux";
import { CartReducerInitialState } from "../types/reducer-types";
import { RootState } from "../redux/store";
import { CartItem } from "../types/types";
import { addToCart, calculatePrice, discountApplied, removeCartItem, saveCouponCode } from "../redux/reducer/cartReducer";
import axios from "axios";
import toast from "react-hot-toast";

const Cart = () => {
  const dispatch = useDispatch();

  const { cartItems, subtotal, tax, total, shippingCharges, discount, config } = useSelector((state: { cartReducer: CartReducerInitialState }) => state.cartReducer)

  const { user } = useSelector((state: RootState) => state.userReducer);

  const [couponCode, setCouponcode] = useState<string>("");
  // "idle" is distinct from "invalid": the old boolean rendered "Invalid coupon"
  // as soon as the field had any text, before a request had even been sent.
  const [couponStatus, setCouponStatus] = useState<
    "idle" | "checking" | "valid" | "invalid"
  >("idle");
  // The server's reason for refusing, when it gave one. Empty falls back to a
  // generic message, which is what a network failure gets.
  const [couponError, setCouponError] = useState<string>("");

  const incrementHandler = (cartItem: CartItem) => {
    if (cartItem.quantity >= cartItem.stock) {
      return;
    }
    dispatch(addToCart({ ...cartItem, quantity: cartItem.quantity + 1 }));
  }
  const decrementHandler = (cartItem: CartItem) => {
    if (cartItem.quantity <= 1) {
      return;
    }
    dispatch(addToCart({ ...cartItem, quantity: cartItem.quantity - 1 }));
  }
  // Takes the whole line, not just a product id: two sizes of the same shirt
  // are two cart lines, and removing by product id alone would delete whichever
  // of them happened to be first.
  const removeHandler = (cartItem: CartItem) => {
    dispatch(
      removeCartItem({ productId: cartItem.productId, variantId: cartItem.variantId ?? null })
    );
  }

  const applyCoupon = async () => {
    const code = couponCode.trim();

    if (!code) return;

    // the coupon endpoint requires a logged-in caller, so say so rather than
    // silently doing nothing
    if (!user?._id) {
      toast.error("Please log in to apply a coupon");
      return;
    }

    setCouponStatus("checking");

    try {
      // The subtotal lets the server answer the minimum-cart condition here
      // rather than at the payment screen. It is advisory — checkout re-derives
      // it from the product rows and re-runs the same check — so nothing is
      // trusted to it; it only buys an earlier, more specific answer.
      const { data } = await axios.get(
        `${import.meta.env.VITE_SERVER}/api/v1/payement/discount?coupon=${encodeURIComponent(code)}&id=${encodeURIComponent(user._id)}&subtotal=${encodeURIComponent(subtotal)}`
      );
      dispatch(discountApplied(data.discount));
      dispatch(saveCouponCode(code));
      dispatch(calculatePrice());
      setCouponStatus("valid");
      setCouponError("");
    } catch (error) {
      dispatch(discountApplied(0));
      dispatch(saveCouponCode(""));
      dispatch(calculatePrice());
      // "Expired" and "your cart is ₹200 short" are actionable; "Invalid" sends
      // the customer back to retype a code that was never the problem.
      setCouponError(
        axios.isAxiosError(error)
          ? (error.response?.data as { message?: string } | undefined)?.message ?? ""
          : ""
      );
      setCouponStatus("invalid");
    }
  };

  // Editing the code invalidates whatever discount was applied under the old
  // one — otherwise the summary keeps showing a discount for a coupon that is
  // no longer in the box.
  const couponChangeHandler = (value: string) => {
    setCouponcode(value);
    if (couponStatus !== "idle") {
      setCouponStatus("idle");
      setCouponError("");
      dispatch(discountApplied(0));
      dispatch(saveCouponCode(""));
      dispatch(calculatePrice());
    }
  };

  useEffect(() => {
    dispatch(calculatePrice());
  }, [cartItems, discount])


  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  if (cartItems.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <FaShoppingBag />
          <h2>Your cart is empty</h2>
          <p>Browse the catalogue and add something you like — it will show up here.</p>
          <Link to="/search" className="btn">Start shopping</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart page">
      <main>
        <h1>
          Shopping cart
          <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
        </h1>

        {cartItems.map((i) => (
          <CartItemCard
            // Keyed on the line's identity rather than its array index. With
            // variants a cart can hold two rows for one product, and an index
            // key makes React reuse the wrong row's DOM when one is removed.
            key={`${i.productId}::${i.variantId ?? ""}`}
            cartItem={i}
            incrementHandler={incrementHandler}
            decrementHandler={decrementHandler}
            removeHandler={removeHandler}
          />
        ))}
      </main>

      <aside className="checkout-summary">
        <h2>Order summary</h2>
        <div className="checkout-summary__details">
          {/* ₹, not $: cartReducer, the backend and the Razorpay order
              are all INR */}
          <div className="checkout-summary__row">
            <span>Subtotal</span>
            <span>{formatINR(subtotal)}</span>
          </div>
          <div className="checkout-summary__row">
            <span>Shipping</span>
            <span>{shippingCharges === 0 ? "Free" : formatINR(shippingCharges)}</span>
          </div>
          <div className="checkout-summary__row">
            <span>Tax</span>
            <span>{formatINR(tax)}</span>
          </div>
          <div className="checkout-summary__row checkout-summary__discount">
            <span>Discount</span>
            <span>- {formatINR(discount)}</span>
          </div>
          <div className="checkout-summary__row checkout-summary__total">
            <span>Total</span>
            <span>{formatINR(total)}</span>
          </div>
        </div>

        <div className="checkout-summary__coupon">
          <input
            type="text"
            placeholder="Enter coupon code"
            value={couponCode}
            onChange={(e) => couponChangeHandler(e.target.value)}
          />
          <button
            onClick={applyCoupon}
            disabled={couponStatus === "checking" || !couponCode.trim()}
          >
            {couponStatus === "checking" ? "Checking.." : "Apply"}
          </button>
        </div>

        {couponStatus === "valid" && (
          <div className="checkout-summary__coupon-status green">
            <VscCheck /> {formatINR(discount)} off using <code>{couponCode}</code>
          </div>
        )}
        {couponStatus === "invalid" && (
          <div className="checkout-summary__coupon-status red">
            <VscError /> {couponError || "Invalid coupon"}
          </div>
        )}

        {user?._id ? (
          <Link to="/shipping" className="checkout-summary__checkout-btn">
            Proceed to checkout
          </Link>
        ) : (
          // /shipping is behind ProtectedRoute, which redirects to "/" with
          // no explanation. Send them to login instead — and carry /shipping
          // as the return path rather than this page: they asked to check out,
          // and signing in was the only thing in the way. Without the state
          // they signed in and landed on the home page with a full cart.
          <Link
            to="/login"
            state={loginState("/shipping")}
            className="checkout-summary__checkout-btn"
          >
            Log in to checkout
          </Link>
        )}

        <p className="checkout-summary__note">
          Secure payment · Free delivery over {formatINR(config.freeShippingThreshold)}
        </p>
      </aside>
    </div>
  );
};

export default Cart;
