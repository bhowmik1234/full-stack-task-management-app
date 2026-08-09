# Checkout: gap analysis and proposal

Scope: everything from the cart page to a delivered order.

> **Status.** Items 1–3 of §4 are **implemented**, and payments moved from
> Stripe to Razorpay in the same change. That closes G1–G9, G11, G23 and G21
> (partly — UPI/net banking/wallets now work, COD does not). Section 1 below
> describes the flow *as it was*, and is kept because the rest of the document
> argues against it; §3 Phase 1 describes what was actually built. Phases 3 and
> 4 are untouched — see "Still open" at the end.

## 1. How it worked before (Stripe, payment-first)

```
Cart.tsx                  client-side totals (cartReducer.calculatePrice)
   │                      optional coupon → GET /payement/discount (amount only)
   ▼
Shipping.tsx              address held in Redux only
   │                      POST /payement/create  → calculateOrderAmounts()
   │                                             → stripe.paymentIntents.create()
   │                      clientSecret passed via router location.state
   ▼
Checkout.tsx              stripe.confirmPayment({ redirect: "if_required" })
   │                      if status === "succeeded":
   ▼
POST /order/new           calculateOrderAmounts() again  ← second, independent pricing
                          reduceStock()                  ← first time stock is held
                          order.create(status: Processing)
```

Two independent server-side pricings, a charge that happens between them, and
no record anywhere linking the two.

## 2. Gaps

Ordered by how much money they can lose.

### 2.1 Critical — payment/order integrity

**G1. No webhook; order creation depends on the browser.**
The only thing that creates an order is the `POST /order/new` fired from
`Checkout.tsx:72` after `confirmPayment` resolves. If the tab is closed, the
network drops, or `/order/new` returns 500, the customer is charged and no
order exists. `Checkout.tsx:81` already admits this — it tells the customer to
"contact support". There is no reconciliation job, no way for support to even
find the orphaned charge from this side.

**G2. The order stores no payment reference.**
`model Order` has no `paymentIntentId`, no `paymentStatus`, no amount-charged.
Consequences: cannot verify an order was actually paid, cannot refund from the
admin panel, cannot match a Stripe dashboard charge to an order, cannot detect
duplicates. The intent's `metadata.userId` (`payement.ts:25`) is the only link
and it points at a user, not an order.

**G3. Price/stock can change between the intent and the order.**
`calculateOrderAmounts` runs at `/payement/create` and again at `/order/new`.
Between them an admin can edit a price, a coupon can be deleted, stock can go
to zero. Nothing asserts `order.total === paymentIntent.amount / 100`. The
customer can be charged ₹5,000 and receive an order recorded at ₹4,000, or vice
versa, silently.

**G4. Stock is reserved *after* the charge.**
`calculateOrderAmounts` only *reads* stock; `reduceStock` runs inside
`/order/new`, after the card is charged. For the last unit, two customers can
both pay and the loser gets a 409 — money taken, no order, no automatic refund.
The atomic `updateMany` is correct, it is just placed one step too late.

**G5. No idempotency anywhere.**
`stripe.paymentIntents.create` is called without an `idempotencyKey`, and
`/order/new` has no dedupe key. A retry, a double-submit that beats the
`isSubmitting` flag, or a client-side retry after a timeout produces a second
order or a second charge. The `isSubmitting` guard in `Shipping.tsx:46` is
client state — it does not survive a refresh.

**G6. Redirect-based payment methods are broken.**
`return_url: window.location.origin` (`Checkout.tsx:63`) sends the customer to
the home page. `redirect: "if_required"` avoids this for plain card auth, but
Indian card payments require 3DS, and UPI/netbanking always redirect. On return
the app has no `clientSecret`, no cart context, and the code path that creates
the order never runs. Effectively, anything but a no-3DS card is a charge with
no order.

### 2.2 High — order lifecycle

**G7. No payment states.** `OrderStatus` is `Processing | Shipped | Delivered`.
There is no `PendingPayment`, `Paid`, `PaymentFailed`, `Cancelled`,
`Refunded`. An unpaid order and a paid one are indistinguishable.

**G8. No cancellation, return, or refund.** Neither customer nor admin can
cancel. `deleteOrder` hard-deletes the row (`order.ts:216`) and **does not
restore stock** — units vanish from inventory permanently. There is no refund
call to Stripe anywhere in the codebase.

**G9. `processOrder` is a one-way ratchet.** No way to correct a mistaken
transition, no per-transition timestamps (so no "shipped on", no SLA), no
carrier or tracking number, and no notification when it moves.

**G10. No confirmation to the customer.** No email, no SMS, no invoice, no
receipt. `newOrder` returns `{ message: "Order Placed Successfully" }` and that
is the entire confirmation. Note phone-auth users have no email at all
(`User.email` is nullable), so this needs both channels.

**G11. No order confirmation page.** `ResponseToast` drops the user on
`/orders` with a toast. There is no "order #1234 placed" screen, and
`newOrder` does not even return the order id.

### 2.3 Medium — cart and coupons

**G12. Cart is not persisted.** `cartReducer` is plain in-memory Redux with no
`redux-persist` and no server-side cart. A refresh anywhere in checkout empties
the cart and bounces the user to `/cart` (`Shipping.tsx:21`). This also means
abandoned-cart recovery is impossible.

**G13. Cart prices and stock go stale.** `CartItem` carries the `price` and
`stock` captured when the item was added. A cart open for a day shows old
prices, and the first the customer hears of a change is a 409 at checkout.
There is no "re-validate cart" endpoint.

**G14. Coupons have no rules.** `model Coupon` is `{ code, amount }` — flat
amount only. Missing: expiry, min-order value, usage limit, per-user limit,
active flag, percentage type, and any redemption record. Any code, once
leaked, is infinitely reusable by everyone forever.

**G15. Coupon isn't re-validated at pay time on the client.** The discount is
applied in `Cart.tsx` and the code is carried in Redux; the server does
re-check it (`calculateOrderAmounts`), but a deleted coupon surfaces as a hard
error at `/payement/create` rather than a corrected total.

### 2.4 Medium — address and shipping

**G16. Addresses are not saved.** No `Address` model. The customer retypes
everything every order, and the entered address lives only in Redux until
`newOrder` writes it flat onto the order.

**G17. The address is missing fields deliveries need.** No recipient name, no
contact phone, no address line 2 / landmark, no address label. A phone-auth
user's number is on `User` but never copied onto the order.

**G18. Country selector is fiction.** `Shipping.tsx:182-186` offers India, USA
and UK, but pricing is INR-only, tax is a flat 18% GST, and shipping is a flat
₹200/free — none of which apply outside India. Either restrict to India or
build real international handling.

**G19. No serviceability or pincode validation.** `pattern="[0-9]{4,10}"` is
the only check. No verification the pincode exists, matches the state, or is
deliverable. No delivery estimate is ever shown.

### 2.5 Medium — UX and trust

**G20. No review step.** The flow goes address → Stripe card form. The
customer never sees items, address and total on one screen before paying, and
cannot edit the address from the payment page (only browser-back, which loses
the intent).

**G21. Card only.** For an INR storefront, UPI is the dominant method, and COD
is table stakes in Indian ecommerce. Neither exists.

**G22. No guest checkout.** Login is required to reach `/shipping`. Defensible,
but it is a conversion decision that was never made explicitly.

**G23. `clientSecret` is passed through `location.state`.** Refreshing `/pay`
loses it and `Checkout.tsx:106` redirects back to `/shipping`, which creates a
*second* PaymentIntent. Abandoned intents accumulate at Stripe.

### 2.6 Lower — compliance and reporting

**G24. Tax is a flat 18% with no breakup.** No CGST/SGST/IGST split, no HSN
codes, no per-product tax rate, no GSTIN capture. Indian B2C invoices need at
least the split and a sequential invoice number.

**G25. No invoice number or downloadable invoice.**

**G26. No audit trail.** No record of who changed an order's status or when.

## 3. Proposal

Four phases. Phase 1 is the one that matters; the rest are product work.

### Phase 1 — Make payment and order atomic (fixes G1–G7, G23) — implemented

Invert the flow: **create the order first, in `PendingPayment`, and let the
payment provider confirm it.** Built with Razorpay rather than Stripe; the
shape below is what shipped, with Razorpay's identifiers in place of the
PaymentIntent ones.

1. **Schema.**
   ```prisma
   model Order {
     ...
     paymentIntentId String?     @unique
     paymentStatus   PaymentStatus @default(Pending)
     amountCharged   Decimal?    @db.Decimal(10, 2)
     placedAt        DateTime?   // when payment succeeded
   }
   enum PaymentStatus { Pending Paid Failed Refunded PartiallyRefunded }
   enum OrderStatus { PendingPayment Processing Shipped Delivered Cancelled Returned }
   ```
   Plus a `StockReservation` table (`orderId`, `productId`, `quantity`,
   `expiresAt`) or simply rely on the order row itself in `PendingPayment` as
   the reservation.

2. **New endpoint `POST /api/v1/order/checkout`** replacing
   `/payement/create`. In one transaction: price the cart, `reduceStock`,
   create the order as `PendingPayment`, create the PaymentIntent with
   `metadata: { orderId }` and `idempotencyKey: orderId`, store
   `paymentIntentId` on the order, return `{ orderId, clientSecret }`.
   Stock is now held before the customer ever sees a card form (G4), the
   amount is bound to a specific order (G3), and retries are idempotent (G5).

3. **`POST /api/v1/payement/webhook`** — raw-body Stripe webhook verified with
   `STRIPE_WEBHOOK_SECRET`, mounted *before* `express.json()`.
   - `payment_intent.succeeded` → order to `Paid`/`Processing`, set
     `amountCharged` and `placedAt`, assert it equals `order.total`, invalidate
     cache, fire confirmation (Phase 2).
   - `payment_intent.payment_failed` / `canceled` → `Cancelled`, restore stock.
   Handler must be idempotent (keyed on `paymentIntentId` + current status), as
   Stripe redelivers.
   This is what makes the flow survive a closed tab (G1).

4. **Expiry job** — a periodic sweep cancelling `PendingPayment` orders older
   than ~30 minutes and restoring their stock, so an abandoned checkout does
   not hold inventory forever.

5. **Client** — `Checkout.tsx` no longer calls `newOrder`. It confirms payment
   with a real `return_url` of `/order/:id/confirm` (G6), and that page polls
   `GET /order/:id` until `paymentStatus` leaves `Pending`. `/pay/:orderId`
   becomes a real route that can re-fetch its own `clientSecret` on refresh
   (G23). `resetCart` moves to the confirmation page.

6. Retire `POST /order/new` as a client-facing route, or keep it admin-only.

> Migration note: existing orders backfill as `paymentStatus = Paid`,
> `paymentIntentId = null`.

### Phase 2 — Lifecycle and communication (G8–G11, G26)

- `cancelOrder` (customer, allowed while `Processing`) and `refundOrder`
  (admin) → `stripe.refunds.create`, restore stock, set `Refunded`.
- Fix `deleteOrder` to restore stock, or replace it with `Cancelled` and stop
  hard-deleting order history.
- `OrderEvent` table (`orderId`, `from`, `to`, `actorId`, `note`, `createdAt`)
  written on every transition — gives the audit trail and per-state timestamps.
- `trackingNumber` + `carrier` on `Order`, surfaced in `OrderDetails.tsx`.
- Notifications on `Paid` / `Shipped` / `Delivered` / `Cancelled`. Email for
  Google accounts, SMS for phone accounts — the `User.email`/`User.phone`
  nullability already forces this branch.
- `newOrder`/checkout returns the order id; add an `/order/:id/confirm` page.

### Phase 3 — Cart, coupons, addresses (G12–G19)

- Persist the cart: `redux-persist` on `cartReducer` for the quick fix, or a
  server-side `Cart`/`CartItem` table if cross-device carts matter.
- `POST /api/v1/cart/validate` → returns current price/stock per line so the
  cart page can show "price changed" / "only 2 left" before checkout.
- Coupon rules: `type` (flat/percent), `expiresAt`, `minOrderValue`,
  `maxDiscount`, `usageLimit`, `perUserLimit`, `active`, plus a
  `CouponRedemption` row written inside the checkout transaction.
- `Address` model on `User` with a default flag, `name`, `phone`, `line2`,
  `label`; `Shipping.tsx` becomes a picker with an "add new" form.
- Decide on international: either drop USA/UK from the selector, or add
  country-specific tax/shipping tables. Recommend dropping for now.
- Pincode → city/state autofill and a delivery-estimate line.

### Phase 4 — Conversion and compliance (G20–G25)

- Insert a **Review order** step between address and payment.
- Enable UPI and netbanking on the PaymentIntent (`automatic_payment_methods`
  — needs the redirect handling from Phase 1 to be in place first).
- COD as a payment method: order goes straight to `Processing` with
  `paymentStatus = Pending`, no PaymentIntent.
- Sequential invoice numbers, GST breakup on the order, PDF invoice on
  `OrderDetails`.
- Guest checkout, if the conversion data justifies it.

## 4. Suggested order of work

| # | Work | Fixes | Size | Status |
|---|------|-------|------|--------|
| 1 | Order-first checkout + payment ids + Razorpay webhook | G1–G5, G7 | L | **done** |
| 2 | `/pay/:orderId` re-fetches its own handle; redirect methods work | G6, G11, G23 | M | **done** |
| 3 | Restore stock on cancel/delete; cancel + refund | G8, G9 | M | **done** |
| 4 | Persist cart | G12 | S | open |
| 5 | Coupon rules + redemptions | G14 | M | open |
| 6 | Saved addresses + full address fields | G16, G17 | M | open |
| 7 | Notifications + `OrderEvent` + tracking | G10, G26 | M | open |
| 8 | Review step, COD | G20, G21 | L | partly (UPI/wallets live) |
| 9 | Invoices and GST | G24, G25 | M | open |

Items 1–3 are correctness; everything below is product.

### Still open

Unchanged by this work and still true: the cart is unpersisted in-memory Redux
(G12, G13), coupons are still bare `{code, amount}` with no expiry or usage
limit (G14, G15), addresses are not saved and lack a recipient name/phone
(G16, G17), the country dropdown still offers USA/UK against INR-only pricing
(G18), there is no serviceability check (G19), no review-before-pay step (G20),
no COD (G21), no guest checkout (G22), no order confirmation email or SMS
(G10), no per-transition audit trail or tracking number (G26), and no invoice
or GST breakup (G24, G25).

## 5. Notes on things that are already right

Worth not regressing while doing the above:

- `calculateOrderAmounts` re-derives all money server-side and never trusts the
  client's numbers.
- `reduceStock`'s single-statement `updateMany({ stock: { gte } })` is the
  correct concurrency primitive — Phase 1 moves *when* it runs, not how.
- The `newOrder` transaction boundary, the `user !== requesterId` check, the
  `Decimal` money columns and the CHECK constraints.
- `Checkout.tsx` already refuses to clear the cart when order creation fails —
  Phase 1 makes that branch unreachable rather than removing the concern.
