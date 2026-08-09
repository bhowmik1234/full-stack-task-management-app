import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { BiArrowBack } from "react-icons/bi";
import { FaMapMarkerAlt, FaCity, FaGlobeAmericas, FaFlag } from 'react-icons/fa';
import { MdLocalPostOffice } from 'react-icons/md';
import { CartReducerInitialState, userReducerIntialState } from "../types/reducer-types";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  calculatePrice,
  resetCart,
  saveShippingInfo,
  selectPaymentMethod,
} from "../redux/reducer/cartReducer";
import { formatINR } from "../utils/features";
import CheckoutSteps from "../components/CheckoutSteps";
import { useCreateCheckoutMutation } from "../redux/api/orderAPI";
import {
  useMyAddressesQuery,
  useNewAddressMutation,
} from "../redux/api/addressAPI";
import { CustomError } from "../types/api-types";

/** Sentinel for "typing a fresh address" — not an id any row can have. */
const NEW_ADDRESS = "new";

const Shipping = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { cartItems, couponCode, config, paymentMethod, total } = useSelector((state:{cartReducer: CartReducerInitialState})=> state.cartReducer);
  const { user } = useSelector((state: { userReducer: userReducerIntialState }) => state.userReducer);

  useEffect(()=>{
    if(cartItems.length <= 0){
      navigate("/cart");
    }
  }, [cartItems])

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createCheckout] = useCreateCheckoutMutation();

  // The address book. This page used to start with five blank fields on every
  // single order; a returning customer now picks one instead.
  const { data: addressBook } = useMyAddressesQuery(user?._id ?? "", {
    skip: !user?._id,
  });
  const addresses = addressBook?.addresses ?? [];

  // The id of the saved address in use, or NEW_ADDRESS for a typed one.
  const [selected, setSelected] = useState<string>(NEW_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(true);
  const [createAddress] = useNewAddressMutation();

  const [shippingInfo, setShippingInfo] = useState({
    address: "",
    city: "",
    state: "",
    country: "",
    pinCode: "",
  });

  // Prefill once, when the book arrives.
  //
  // Adjusted during render rather than in an effect: an effect would paint the
  // empty form first and then replace it, and React re-runs this before the
  // browser sees anything. Keyed on the default's id and guarded by
  // `prefilledFor`, so a later refetch — after saving a new address, say —
  // cannot overwrite what the customer has since typed.
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);

  if (defaultAddress && prefilledFor !== defaultAddress._id) {
    setPrefilledFor(defaultAddress._id);
    setSelected(defaultAddress._id);
    setShippingInfo(defaultAddress.shippingInfo);
  }

  const selectHandler = (id: string) => {
    setSelected(id);

    if (id === NEW_ADDRESS) {
      setShippingInfo({ address: "", city: "", state: "", country: "", pinCode: "" });
      return;
    }

    const picked = addresses.find((a) => a._id === id);
    if (picked) setShippingInfo(picked.shippingInfo);
  };

  /**
   * Whether cash on delivery may be offered for this order.
   *
   * Mirrors `codAllowed` on the server, and is only ever a courtesy: checkout
   * re-checks it against a total it derived itself, so a customer who forces the
   * request gets a 400 rather than an unpaid parcel. Hiding the option when it
   * cannot be used is the point — an option that fails on submit is worse than
   * no option.
   */
  const codAvailable =
    config.cod.enabled &&
    (config.cod.maxOrderValue === 0 || total <= config.cod.maxOrderValue);

  // A cart that grows past the COD ceiling while COD is selected has to fall
  // back, or the customer submits an order the server will refuse. Done during
  // render rather than in an effect for the same reason as the prefill above.
  if (!codAvailable && paymentMethod === "COD") {
    dispatch(selectPaymentMethod("Razorpay"));
    dispatch(calculatePrice());
  }

  const choosePaymentMethod = (method: "Razorpay" | "COD") => {
    dispatch(selectPaymentMethod(method));
    // COD can carry a handling charge, so the total changes with the choice.
    dispatch(calculatePrice());
  };

  const changeHandler = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setShippingInfo((prev) => ({ ...prev, [e.target.name]: e.target.value }));

    // Shipping can depend on the destination state, so re-price as it changes.
    // The reducer reads `shippingInfo` from the store, which only updates on
    // submit — so this dispatch carries the new value first.
    if (e.target.name === "state") {
      dispatch(saveShippingInfo({ ...shippingInfo, state: e.target.value }));
      dispatch(calculatePrice());
    }

    // Editing a prefilled address makes it a different address. Leaving it
    // attached to the saved row would mean the picker claims one thing while
    // the order ships to another.
    setSelected(NEW_ADDRESS);
  };

  const submitHandler = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // each submit creates a real order and reserves its stock, so a double
    // click must not create two
    if (isSubmitting) return;
    setIsSubmitting(true);

    dispatch(saveShippingInfo(shippingInfo));

    // Saving the address is a convenience, never a precondition: if it fails
    // (the 20-address cap, a phone the server will not accept) the checkout
    // still goes ahead with the address as typed, because the customer asked
    // to buy something, not to manage their address book.
    if (selected === NEW_ADDRESS && saveAddress && user?._id)
      await createAddress({
        userId: user._id,
        body: {
          label: "Home",
          fullName: user.name,
          phone: user.phone ?? "",
          ...shippingInfo,
        },
      }).unwrap().catch(() => {});

    // Creates the order in PendingPayment and reserves its stock *before* any
    // payment UI appears. The order id is the durable handle from here on:
    // /pay/:orderId can re-open the payment for it after a refresh, and if the
    // customer never pays, the server's expiry sweep releases the stock.
    const res = await createCheckout({
      userId: user?._id!,
      shippingInfo,
      // amounts are re-derived server-side; only what was picked matters
      orderItems: cartItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        // Undefined rather than null for a product without options: the server
        // refuses a variantId on a product that has none, and `undefined` is
        // what JSON.stringify drops entirely.
        variantId: i.variantId ?? undefined,
      })),
      couponCode: couponCode || undefined,
      paymentMethod,
    });

    if ("data" in res && res.data) {
      // A COD order is finished the moment it is created — there is nothing to
      // pay and no Razorpay handle to open, so /pay would have nothing to show.
      // Straight to the order itself.
      if (res.data.paymentMethod === "COD") {
        dispatch(resetCart());
        toast.success("Order placed. You will pay on delivery.");
        navigate(`/orders/${res.data.orderId}`);
        return;
      }

      navigate(`/pay/${res.data.orderId}`);
      return;
    }

    // the API explains why (out of stock, invalid coupon, rate limited);
    // "something went wrong" threw that away
    const err = res.error as CustomError;
    toast.error(err?.data?.message ?? "Could not start checkout. Please try again.");
    setIsSubmitting(false);
  };


  return (
    // <div className="shipping">
    //   <button className="back-btn">
    //     <BiArrowBack />
    //   </button>

    //   <form onSubmit={submitHandler}>
    //     <h1>Shipping Address</h1>

    //     <input
    //       required
    //       type="text"
    //       placeholder="Address"
    //       name="address"
    //       value={shippingInfo.address}
    //       onChange={changeHandler}
    //     />

    //     <input
    //       required
    //       type="text"
    //       placeholder="City"
    //       name="city"
    //       value={shippingInfo.city}
    //       onChange={changeHandler}
    //     />

    //     <input
    //       required
    //       type="text"
    //       placeholder="State"
    //       name="state"
    //       value={shippingInfo.state}
    //       onChange={changeHandler}
    //     />

    //     <select
    //       name="country"
    //       required
    //       value={shippingInfo.country}
    //       onChange={changeHandler}
    //     >
    //       <option value="">Choose Country</option>
    //       <option value="india">India</option>
    //     </select>

    //     <input
    //       required
    //       type="number"
    //       placeholder="Pin Code"
    //       name="pinCode"
    //       value={shippingInfo.pinCode}
    //       onChange={changeHandler}
    //     />

    //     <button type="submit">Pay Now</button>
    //   </form>
    // </div>
    <div className="shipping-container page">
      <button className="back-btn" onClick={() => window.history.back()}>
        <BiArrowBack /> Back to cart
      </button>

      <CheckoutSteps current={2} />

      <form onSubmit={submitHandler} className="shipping-form">
        <h1>Shipping address</h1>
        <p>Where should we deliver your order?</p>

        {addresses.length > 0 && (
          <div className="shipping-form__saved">
            {addresses.map((a) => (
              <label
                key={a._id}
                className={selected === a._id ? "is-selected" : ""}
              >
                <input
                  type="radio"
                  name="saved-address"
                  checked={selected === a._id}
                  onChange={() => selectHandler(a._id)}
                />
                <span>
                  <strong>
                    {a.label}
                    {a.isDefault && " · Default"}
                  </strong>
                  {a.address}, {a.city}, {a.state} {a.pinCode}
                </span>
              </label>
            ))}

            <label className={selected === NEW_ADDRESS ? "is-selected" : ""}>
              <input
                type="radio"
                name="saved-address"
                checked={selected === NEW_ADDRESS}
                onChange={() => selectHandler(NEW_ADDRESS)}
              />
              <span>
                <strong>Use a different address</strong>
                Type it below
              </span>
            </label>
          </div>
        )}

        <div className="form-group">
          <FaMapMarkerAlt className="input-icon" />
          <input
            required
            type="text"
            placeholder="Address"
            name="address"
            value={shippingInfo.address}
            onChange={changeHandler}
          />
        </div>

        <div className="form-group">
          <FaCity className="input-icon" />
          <input
            required
            type="text"
            placeholder="City"
            name="city"
            value={shippingInfo.city}
            onChange={changeHandler}
          />
        </div>

        <div className="form-group">
          <FaFlag className="input-icon" />
          <input
            required
            type="text"
            placeholder="State"
            name="state"
            value={shippingInfo.state}
            onChange={changeHandler}
          />
        </div>

        <div className="form-group">
          <FaGlobeAmericas className="input-icon" />
          <select
            name="country"
            required
            value={shippingInfo.country}
            onChange={changeHandler}
          >
            <option value="">Choose Country</option>
            <option value="india">India</option>
            <option value="usa">United States</option>
            <option value="uk">United Kingdom</option>
            {/* Add more countries as needed */}
          </select>
        </div>

        <div className="form-group">
          <MdLocalPostOffice className="input-icon" />
          {/* text, not number: the backend stores pinCode as a string
              specifically to preserve leading zeros, which type="number"
              would strip before it ever left the form */}
          <input
            required
            type="text"
            inputMode="numeric"
            pattern="[0-9]{4,10}"
            title="Pin code must be 4-10 digits"
            placeholder="Pin Code"
            name="pinCode"
            value={shippingInfo.pinCode}
            onChange={changeHandler}
          />
        </div>

        {/* Only offered for an address that is not already saved. */}
        {selected === NEW_ADDRESS && (
          <label className="shipping-form__save">
            <input
              type="checkbox"
              checked={saveAddress}
              onChange={(e) => setSaveAddress(e.target.checked)}
            />
            <span>Save this address for next time</span>
          </label>
        )}

        {/* Only rendered when the store has enabled COD — a single-option radio
            group is a control that explains nothing and can do nothing. */}
        {config.cod.enabled && (
          <fieldset className="shipping-form__payment">
            <legend>How would you like to pay?</legend>

            <label className={paymentMethod === "Razorpay" ? "is-selected" : ""}>
              <input
                type="radio"
                name="payment-method"
                checked={paymentMethod === "Razorpay"}
                onChange={() => choosePaymentMethod("Razorpay")}
              />
              <span>
                <strong>Pay now</strong>
                Card, UPI, net banking or wallet
              </span>
            </label>

            <label
              className={[
                paymentMethod === "COD" ? "is-selected" : "",
                !codAvailable ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="radio"
                name="payment-method"
                checked={paymentMethod === "COD"}
                disabled={!codAvailable}
                onChange={() => choosePaymentMethod("COD")}
              />
              <span>
                <strong>Cash on delivery</strong>
                {/* Says *why* it is unavailable. A disabled option with no
                    reason is the most common way a checkout loses someone who
                    would otherwise have adjusted their basket. */}
                {!codAvailable
                  ? `Not available above ${formatINR(config.cod.maxOrderValue)}`
                  : config.cod.fee > 0
                    ? `Pay the courier — ${formatINR(config.cod.fee)} handling charge`
                    : "Pay the courier when your order arrives"}
              </span>
            </label>
          </fieldset>
        )}

        <button type="submit" className="submit-btn" disabled={isSubmitting}>
          {isSubmitting
            ? "Processing.."
            : paymentMethod === "COD"
              ? `Place order · ${formatINR(total)}`
              : "Proceed to Payment"}
        </button>
      </form>
    </div>
  );
};

export default Shipping;