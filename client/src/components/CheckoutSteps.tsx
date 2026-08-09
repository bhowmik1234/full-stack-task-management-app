// Cart → Shipping → Payment progress indicator, shown on the two checkout
// pages so it's clear how many steps are left.
const steps = ["Cart", "Shipping", "Payment"];

const CheckoutSteps = ({ current }: { current: 1 | 2 | 3 }) => (
  <nav className="checkout-steps" aria-label="Checkout progress">
    {steps.map((label, index) => {
      const step = index + 1;
      const state =
        step === current ? "current" : step < current ? "done" : "todo";

      return (
        <div key={label} style={{ display: "contents" }}>
          {index > 0 && <span className="checkout-steps__line" />}
          <div
            className={`checkout-steps__step checkout-steps__step--${state}`}
            aria-current={step === current ? "step" : undefined}
          >
            <span>{step}</span>
            {label}
          </div>
        </div>
      );
    })}
  </nav>
);

export default CheckoutSteps;
