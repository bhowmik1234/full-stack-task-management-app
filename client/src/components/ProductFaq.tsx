// Store policy, not per-product content — the answers are the same shipping,
// returns and payment terms quoted everywhere else in the app (cartReducer's
// ₹1,000 free-delivery threshold, the 7-day returns line on the buy box), so
// they live here as constants rather than in the database.
//
// Uses native <details>, so it opens without JavaScript and is keyboard
// accessible for free.
const FAQS = [
  {
    q: "When will my order arrive?",
    a: "Orders are dispatched within one working day. Delivery usually takes 3–5 working days, and you can follow the status of any order from My orders.",
  },
  {
    q: "How much is delivery?",
    a: "Delivery is ₹200, and free on every order over ₹1,000. The exact amount is always shown in your cart before you pay.",
  },
  {
    q: "Can I return this?",
    a: "Yes — you have 7 days from delivery to start a return, as long as the item is unused and in its original packaging. Refunds go back to the original payment method.",
  },
  {
    q: "Is it safe to pay here?",
    a: "Payments are handled by Razorpay — cards, UPI, net banking and wallets. Your payment details go straight to Razorpay and are never stored on our servers.",
  },
  {
    q: "Can I change or cancel my order?",
    a: "Get in touch as soon as you can. While an order is still Processing we can usually change or cancel it; once it ships it has to go through the returns process instead.",
  },
];

const ProductFaq = () => (
  <section className="faq">
    <h2>Frequently asked questions</h2>
    <div className="faq__list">
      {FAQS.map((item) => (
        <details key={item.q} className="faq__item">
          <summary>
            {item.q}
            <span className="faq__marker" aria-hidden />
          </summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  </section>
);

export default ProductFaq;
