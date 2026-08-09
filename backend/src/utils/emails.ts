import { prisma } from "./db.js";
import { queueMail } from "./mailer.js";
import { unsubscribeUrl } from "./unsubscribe.js";

/**
 * The transactional messages the store sends, and the markup for them.
 *
 * Templates are plain string builders rather than a rendering library on
 * purpose: there are a handful of them, they are mostly a table of line items,
 * and email HTML is not web HTML — it has to survive clients that ignore
 * stylesheets, so everything here is inline-styled and table-based by
 * necessity. A component library would abstract over exactly the details that
 * matter for deliverability.
 *
 * Every exported `send*` is fire-and-forget (see mailer.ts). None of them is
 * awaited by the code that triggers it, and none can fail a request.
 */

const SITE_NAME = () => process.env.STORE_NAME || "The Store";

/**
 * The storefront's canonical origin, for links back into the account pages.
 *
 * `CLIENT_URL` is a comma-separated allowlist for CORS, so the first entry is
 * taken as the canonical one — the rest are alternates (www, a staging host)
 * and linking a customer to a staging origin would be worse than not linking.
 */
const siteUrl = () => (process.env.CLIENT_URL || "").split(",")[0].trim().replace(/\/$/, "");

const orderUrl = (orderId: string) => {
  const base = siteUrl();
  return base ? `${base}/orders/${orderId}` : "";
};

/** Money as the rest of the app renders it. Intl gives the ₹ and the grouping. */
const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

/**
 * Escapes text interpolated into the HTML body.
 *
 * Product names and addresses are customer- and operator-supplied and land
 * inside markup here. An unescaped `<` in a product name would corrupt the
 * message at best; the same string reaches a webmail client that renders HTML,
 * so this is the same discipline the app applies to anything user-controlled.
 */
const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type OrderForMail = {
  id: string;
  total: number;
  subtotal: number;
  tax: number;
  shippingCharges: number;
  discount: number;
  address: string;
  city: string;
  state: string;
  country: string;
  pinCode: string;
  items: { name: string; variantLabel: string; price: number; quantity: number }[];
  customerName: string;
  customerEmail: string;
  paymentMethod: "Razorpay" | "COD";
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
};

/**
 * Loads exactly what a template needs, including the address to send to.
 *
 * Returns null when there is nobody to write to — `User.email` is nullable
 * because a phone sign-in never provides one, so "this customer has no email
 * address" is an ordinary state and not an error. Callers skip silently.
 */
const loadOrderForMail = async (orderId: string): Promise<OrderForMail | null> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      total: true,
      subtotal: true,
      tax: true,
      shippingCharges: true,
      discount: true,
      address: true,
      city: true,
      state: true,
      country: true,
      pinCode: true,
      paymentMethod: true,
      carrier: true,
      trackingNumber: true,
      trackingUrl: true,
      items: { select: { name: true, variantLabel: true, price: true, quantity: true } },
      user: { select: { name: true, email: true } },
    },
  });

  if (!order?.user?.email) return null;

  return {
    id: order.id,
    total: Number(order.total),
    subtotal: Number(order.subtotal),
    tax: Number(order.tax),
    shippingCharges: Number(order.shippingCharges),
    discount: Number(order.discount),
    address: order.address,
    city: order.city,
    state: order.state,
    country: order.country,
    pinCode: order.pinCode,
    items: order.items.map((i) => ({
      name: i.name,
      variantLabel: i.variantLabel,
      price: Number(i.price),
      quantity: i.quantity,
    })),
    customerName: order.user.name,
    customerEmail: order.user.email,
    paymentMethod: order.paymentMethod,
    carrier: order.carrier ?? "",
    trackingNumber: order.trackingNumber ?? "",
    trackingUrl: order.trackingUrl ?? "",
  };
};

// ---------------------------------------------------------------- layout ---

const BODY_STYLE =
  "margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;";
const CARD_STYLE =
  "max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;";
// Split, because these get composed into rules that already set a size. Reusing
// the full `MUTED` there re-declared font-size and silently shrank the totals
// labels to 13px while their amounts stayed at 14px.
const MUTED_INK = "color:#71717a;";
const MUTED = `${MUTED_INK}font-size:13px;line-height:1.6;`;

const layout = ({ heading, intro, body, cta, footer }: {
  heading: string;
  intro: string;
  body: string;
  cta?: { label: string; url: string };
  /**
   * Why this message arrived, and how to stop it. Transactional mail explains
   * itself and offers no opt-out because there is none to offer; notification
   * mail must carry a working unsubscribe link, which is what
   * `notificationFooter` builds.
   */
  footer?: string;
}) => `<!doctype html>
<html><body style="${BODY_STYLE}">
  <div style="${CARD_STYLE}">
    <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;${MUTED_INK}">${esc(SITE_NAME())}</p>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${esc(heading)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${esc(intro)}</p>
    ${body}
    ${
      cta && cta.url
        ? `<p style="margin:28px 0 0;"><a href="${esc(cta.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;">${esc(cta.label)}</a></p>`
        : ""
    }
    <p style="margin:32px 0 0;${MUTED}">${
      footer ?? `You are receiving this because you placed an order with ${esc(SITE_NAME())}.`
    }</p>
  </div>
</body></html>`;

/**
 * The footer every non-transactional message carries.
 *
 * The unsubscribe link is not decoration: these are the first messages the
 * store sends that nobody asked for as part of a purchase, and a working
 * one-click opt-out is the price of sending them at all. If the token cannot be
 * minted — no secret configured — the sentence still explains where to change
 * preferences, because a footer that silently loses its link is worse than one
 * that never had it.
 */
const notificationFooter = (userId: string, reason: string) => {
  const url = unsubscribeUrl(userId, siteUrl());
  const tail = url
    ? `<a href="${esc(url)}" style="color:#71717a;">Unsubscribe from these emails</a>.`
    : "You can turn these off in Settings.";
  return `${esc(reason)} ${tail} Order confirmations and delivery updates are not affected.`;
};

const notificationFooterText = (userId: string, reason: string) => {
  const url = unsubscribeUrl(userId, siteUrl());
  return `\n\n${reason} ${url ? `Unsubscribe: ${url}` : "You can turn these off in Settings."}\nOrder confirmations and delivery updates are not affected.`;
};

/** The line items and totals, shared by every order message. */
const itemsTable = (order: OrderForMail) => {
  const rows = order.items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;font-size:14px;">${esc(item.name)}${
          // The variant is part of what was bought, so a receipt that omits it
          // cannot be checked against the parcel — "a shirt" and "the blue
          // medium shirt" are different claims about what should have arrived.
          item.variantLabel ? ` <span style="${MUTED}">${esc(item.variantLabel)}</span>` : ""
        } <span style="${MUTED}">× ${item.quantity}</span></td>
        <td style="padding:8px 0;font-size:14px;text-align:right;">${esc(inr(item.price * item.quantity))}</td>
      </tr>`
    )
    .join("");

  const line = (label: string, value: string, bold = false) => `<tr>
      <td style="padding:4px 0;font-size:${bold ? "15px" : "14px"};${bold ? "font-weight:600;" : MUTED_INK}">${esc(label)}</td>
      <td style="padding:4px 0;font-size:${bold ? "15px" : "14px"};text-align:right;${bold ? "font-weight:600;" : ""}">${esc(value)}</td>
    </tr>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    ${rows}
    <tr><td colspan="2" style="border-top:1px solid #e4e4e7;padding-top:12px;"></td></tr>
    ${line("Subtotal", inr(order.subtotal))}
    ${order.discount > 0 ? line("Discount", `− ${inr(order.discount)}`) : ""}
    ${line("Tax", inr(order.tax))}
    ${line("Shipping", order.shippingCharges === 0 ? "Free" : inr(order.shippingCharges))}
    ${line("Total", inr(order.total), true)}
  </table>`;
};

/**
 * Carrier and tracking, when the operator captured them.
 *
 * This is the whole reason `Order.carrier`/`trackingNumber` exist: the shipping
 * notice could previously only say "it is on its way", which is the message that
 * generates the most "where is it?" replies — every one of which costs a support
 * conversation to answer with information the store already had.
 *
 * Rendered as a block only when there is something to say. A heading reading
 * "Track your parcel" above an empty space is worse than no heading.
 */
const trackingBlock = (order: OrderForMail) => {
  if (!order.carrier && !order.trackingNumber && !order.trackingUrl) return "";

  const detail = [order.carrier, order.trackingNumber].filter(Boolean).join(" · ");

  return `<div style="margin:24px 0 0;padding:16px;background:#fafafa;border-radius:8px;">
    <p style="margin:0 0 4px;font-size:13px;${MUTED_INK}">Tracking</p>
    <p style="margin:0;font-size:14px;">${esc(detail || "See the carrier's site")}</p>
    ${
      order.trackingUrl
        ? `<p style="margin:8px 0 0;"><a href="${esc(order.trackingUrl)}" style="font-size:14px;color:#18181b;">Track this parcel</a></p>`
        : ""
    }
  </div>`;
};

const trackingText = (order: OrderForMail) => {
  if (!order.carrier && !order.trackingNumber && !order.trackingUrl) return "";
  const detail = [order.carrier, order.trackingNumber].filter(Boolean).join(" - ");
  return `\nTracking: ${detail}${order.trackingUrl ? `\n${order.trackingUrl}` : ""}\n`;
};

const addressBlock = (order: OrderForMail) =>
  `<p style="margin:24px 0 0;${MUTED}">Shipping to<br>${esc(order.address)}, ${esc(order.city)}<br>${esc(order.state)} ${esc(order.pinCode)}, ${esc(order.country)}</p>`;

/** The text/plain alternative. Same information, no markup. */
const itemsText = (order: OrderForMail) =>
  [
    ...order.items.map(
      (i) =>
        `  ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""} x${i.quantity}  ${inr(
          i.price * i.quantity
        )}`
    ),
    `  Subtotal: ${inr(order.subtotal)}`,
    ...(order.discount > 0 ? [`  Discount: -${inr(order.discount)}`] : []),
    `  Tax: ${inr(order.tax)}`,
    `  Shipping: ${order.shippingCharges === 0 ? "Free" : inr(order.shippingCharges)}`,
    `  Total: ${inr(order.total)}`,
  ].join("\n");

// -------------------------------------------------------------- messages ---

/**
 * The receipt. Sent once, from `markOrderPaid`, and only on the transition that
 * actually moved the row — the three callers that race to settle a payment all
 * converge there, and only one of them gets the `paid` outcome, so exactly-once
 * comes from the state machine rather than from a flag added for email.
 */
export const sendOrderConfirmation = async (orderId: string) => {
  const order = await loadOrderForMail(orderId);
  if (!order) return;

  const shortId = order.id.slice(0, 8);

  queueMail({
    to: order.customerEmail,
    subject: `Order confirmed — ${shortId}`,
    html: layout({
      heading: "Thanks for your order",
      intro: `We have received your payment of ${inr(order.total)} and your order is being prepared.`,
      body: itemsTable(order) + addressBlock(order),
      cta: { label: "View your order", url: orderUrl(order.id) },
    }),
    text: `Thanks for your order, ${order.customerName}.

We have received your payment of ${inr(order.total)}. Order ${shortId} is being prepared.

${itemsText(order)}

Shipping to: ${order.address}, ${order.city}, ${order.state} ${order.pinCode}, ${order.country}
${orderUrl(order.id)}`,
  });
};

/** Fulfilment moved forward. One message per transition, from `processOrder`. */
export const sendOrderStatusUpdate = async (
  orderId: string,
  status: "Shipped" | "Delivered"
) => {
  const order = await loadOrderForMail(orderId);
  if (!order) return;

  const shortId = order.id.slice(0, 8);
  const shipped = status === "Shipped";

  queueMail({
    to: order.customerEmail,
    subject: shipped ? `Your order is on its way — ${shortId}` : `Delivered — ${shortId}`,
    html: layout({
      heading: shipped ? "Your order has shipped" : "Your order has been delivered",
      intro: shipped
        ? order.trackingNumber || order.trackingUrl
          ? "It is on its way. You can follow it with the tracking details below."
          : "It is on its way to the address below."
        : "It should be with you now. If anything is wrong, reply to this email.",
      body:
        itemsTable(order) +
        (shipped ? trackingBlock(order) : "") +
        addressBlock(order),
      cta: { label: "View your order", url: orderUrl(order.id) },
    }),
    text: `${shipped ? "Your order has shipped." : "Your order has been delivered."}

Order ${shortId}
${shipped ? trackingText(order) : ""}
${itemsText(order)}

Shipping to: ${order.address}, ${order.city}, ${order.state} ${order.pinCode}, ${order.country}
${orderUrl(order.id)}`,
  });
};

/**
 * The COD equivalent of the receipt.
 *
 * A prepaid order's confirmation comes from `markOrderPaid`, which never runs
 * for cash on delivery — without this the customer would place an order and hear
 * nothing at all. Sent from `createCheckout`, once, on the only path that
 * creates a COD order.
 *
 * It is transactional, not a notification: it confirms an order somebody placed,
 * so it neither checks `emailOptOut` nor carries an unsubscribe link, exactly
 * like every other receipt.
 */
export const sendOrderPlacedByCod = async (orderId: string) => {
  const order = await loadOrderForMail(orderId);
  if (!order) return;

  const shortId = order.id.slice(0, 8);
  const due = `Please keep ${inr(order.total)} ready for the courier.`;

  queueMail({
    to: order.customerEmail,
    subject: `Order confirmed — ${shortId}`,
    html: layout({
      heading: "Thanks for your order",
      intro: `Your order is being prepared. You will pay when it arrives. ${due}`,
      body: itemsTable(order) + addressBlock(order),
      cta: { label: "View your order", url: orderUrl(order.id) },
    }),
    text: `Thanks for your order, ${order.customerName}.

Order ${shortId} is being prepared. You will pay on delivery. ${due}

${itemsText(order)}

Shipping to: ${order.address}, ${order.city}, ${order.state} ${order.pinCode}, ${order.country}
${orderUrl(order.id)}`,
  });
};

/**
 * The order ended. Sent from `releaseOrder`, which is reached by a customer
 * cancelling, an operator cancelling, and the expiry sweep.
 *
 * The expiry case is the one worth being careful about: those customers never
 * completed a payment, so a message that reads like a cancellation confirmation
 * would be confusing. `reason` distinguishes them, and the refund line only
 * appears when money actually moved.
 */
export const sendOrderCancelled = async (
  orderId: string,
  { reason, refunded }: { reason: string; refunded: boolean }
) => {
  const order = await loadOrderForMail(orderId);
  if (!order) return;

  const shortId = order.id.slice(0, 8);
  const expired = /expire/i.test(reason);

  const heading = expired ? "Your order was not completed" : "Your order has been cancelled";
  const intro = expired
    ? "The payment window closed before we received a payment, so the items have been returned to stock. Nothing was charged."
    : refunded
      ? `Your order has been cancelled and ${inr(order.total)} has been refunded. Refunds usually reach the original payment method within 5–7 working days.`
      : "Your order has been cancelled. Nothing was charged.";

  queueMail({
    to: order.customerEmail,
    subject: expired ? `Order not completed — ${shortId}` : `Order cancelled — ${shortId}`,
    html: layout({
      heading,
      intro,
      body: itemsTable(order),
      cta: siteUrl() ? { label: "Continue shopping", url: siteUrl() } : undefined,
    }),
    text: `${heading}

${intro}

Order ${shortId}

${itemsText(order)}`,
  });
};

// -------------------------------------------------------------- returns ---
//
// All transactional. A return is a transaction the customer entered into and
// every message below reports its progress, so none of them consults
// `emailOptOut` — for the same reason a receipt does not. Someone who opted out
// of marketing has not opted out of being told whether their refund happened.

type ReturnForMail = {
  id: string;
  orderId: string;
  customerEmail: string;
  customerName: string;
  items: { name: string; variantLabel: string; quantity: number }[];
};

const loadReturnForMail = async (
  returnId: string
): Promise<ReturnForMail | null> => {
  const request = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    select: {
      id: true,
      orderId: true,
      user: { select: { name: true, email: true } },
      items: {
        select: {
          quantity: true,
          orderItem: { select: { name: true, variantLabel: true } },
        },
      },
    },
  });

  // Same "nobody to write to" case as loadOrderForMail: a phone sign-in has no
  // email, and that is ordinary rather than an error.
  if (!request?.user?.email) return null;

  return {
    id: request.id,
    orderId: request.orderId,
    customerEmail: request.user.email,
    customerName: request.user.name,
    items: request.items.map((i) => ({
      name: i.orderItem.name,
      variantLabel: i.orderItem.variantLabel,
      quantity: i.quantity,
    })),
  };
};

const returnItemsTable = (request: ReturnForMail) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${request.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;font-size:14px;">${esc(i.name)}${
          i.variantLabel ? ` <span style="${MUTED}">${esc(i.variantLabel)}</span>` : ""
        } <span style="${MUTED}">× ${i.quantity}</span></td></tr>`
    )
    .join("")}</table>`;

const returnItemsText = (request: ReturnForMail) =>
  request.items
    .map((i) => `  ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""} x${i.quantity}`)
    .join("\n");

/** "We have your request." Sent when the customer opens a return. */
export const sendReturnRequested = async (returnId: string) => {
  const request = await loadReturnForMail(returnId);
  if (!request) return;

  const shortId = request.orderId.slice(0, 8);

  queueMail({
    to: request.customerEmail,
    subject: `Return requested — ${shortId}`,
    html: layout({
      heading: "We have your return request",
      intro:
        "Someone will review it shortly and email you with what to do next. You do not need to send anything back yet.",
      body: returnItemsTable(request),
      cta: { label: "View your order", url: orderUrl(request.orderId) },
    }),
    text: `We have your return request for order ${shortId}.

Someone will review it shortly. Please do not send anything back yet.

${returnItemsText(request)}

${orderUrl(request.orderId)}`,
  });
};

/**
 * The decision. One function for both outcomes because they are the same
 * message with a different answer, and splitting them duplicates the item list
 * and the order link for no gain.
 *
 * A rejection carries the operator's note when there is one. A refusal with no
 * reason attached is the thing that turns a return into a complaint.
 */
export const sendReturnDecision = async (
  returnId: string,
  { approved, note }: { approved: boolean; note: string }
) => {
  const request = await loadReturnForMail(returnId);
  if (!request) return;

  const shortId = request.orderId.slice(0, 8);

  const heading = approved ? "Your return has been approved" : "We could not accept this return";
  const intro = approved
    ? "Please send the items back to us. Once they arrive and have been checked, we will refund you."
    : note
      ? `We are not able to accept this return. ${note}`
      : "We are not able to accept this return. Reply to this email if you think this is a mistake.";

  queueMail({
    to: request.customerEmail,
    subject: approved ? `Return approved — ${shortId}` : `Return declined — ${shortId}`,
    html: layout({
      heading,
      intro,
      body:
        returnItemsTable(request) +
        (approved && note ? `<p style="margin:20px 0 0;${MUTED}">${esc(note)}</p>` : ""),
      cta: { label: "View your order", url: orderUrl(request.orderId) },
    }),
    text: `${heading}

${intro}

${returnItemsText(request)}

${orderUrl(request.orderId)}`,
  });
};

/** The money went back. Sent from the transition that actually refunded. */
export const sendReturnRefunded = async (returnId: string, amount: number) => {
  const request = await loadReturnForMail(returnId);
  if (!request) return;

  const shortId = request.orderId.slice(0, 8);
  const intro = `We have refunded ${inr(
    amount
  )}. Refunds usually reach the original payment method within 5–7 working days.`;

  queueMail({
    to: request.customerEmail,
    subject: `Refund issued — ${shortId}`,
    html: layout({
      heading: "Your refund is on its way",
      intro,
      body: returnItemsTable(request),
      cta: { label: "View your order", url: orderUrl(request.orderId) },
    }),
    text: `Your refund is on its way.

${intro}

${returnItemsText(request)}

${orderUrl(request.orderId)}`,
  });
};

// --------------------------------------------------------- notifications ---
//
// Everything below is non-transactional: nobody entered into a transaction that
// obliges the store to send it. Each therefore checks `emailOptOut` and carries
// an unsubscribe link, and none of them may ever be reused for a receipt.
//
// The senders take rows the sweep has already loaded rather than re-querying by
// id, because the sweep is processing a batch and a per-message round trip
// would turn one query into hundreds.

type Recipient = { id: string; name: string; email: string | null; emailOptOut: boolean };

/** The one gate. A caller that skips this is sending marketing without consent. */
const mayNotify = (user: Recipient): user is Recipient & { email: string } =>
  Boolean(user.email) && !user.emailOptOut;

/**
 * "The thing you asked about is back."
 *
 * Sent once per request — `notifiedAt` is stamped by the sweep, not here, so
 * that the flag and the send commit in a known order: the sweep marks first and
 * mails after, because a crash that re-sends an alert is worse than one that
 * drops it. A missed restock alert is disappointing; a duplicate is the store
 * looking broken.
 */
export const sendBackInStock = async (
  user: Recipient,
  product: { id: string; name: string; price: number; stock: number }
): Promise<boolean> => {
  if (!mayNotify(user)) return false;

  const url = siteUrl() ? `${siteUrl()}/product/${product.id}` : "";

  queueMail({
    to: user.email,
    subject: `Back in stock — ${product.name}`,
    html: layout({
      heading: `${product.name} is back`,
      intro: `You asked to be told when this was available again. It is in stock now, at ${inr(product.price)}.`,
      // Naming the remaining count only when it is genuinely low: a truthful
      // scarcity cue is useful, an invented one on a shelf of 400 is the kind
      // of thing that teaches people to ignore every email the store sends.
      body:
        product.stock <= 5
          ? `<p style="margin:0;${MUTED}">Only ${product.stock} left.</p>`
          : "",
      cta: { label: "View product", url },
      footer: notificationFooter(user.id, "You asked to be notified about this product."),
    }),
    text: `${product.name} is back in stock, at ${inr(product.price)}.${
      product.stock <= 5 ? `\nOnly ${product.stock} left.` : ""
    }\n\n${url}${notificationFooterText(user.id, "You asked to be notified about this product.")}`,
  });

  return true;
};

/**
 * "How was it?", a few days after delivery.
 *
 * Deliberately links to the product rather than to a review form the store does
 * not have at that URL — `/product/:id` is where the review box lives, so this
 * lands people exactly where they can act.
 */
export const sendReviewRequest = async (
  user: Recipient,
  order: { id: string; items: { productId: string; name: string }[] }
): Promise<boolean> => {
  if (!mayNotify(user)) return false;

  const items = order.items.slice(0, 3);
  const list = items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;font-size:14px;">${esc(i.name)}</td><td style="padding:8px 0;text-align:right;"><a href="${esc(
          siteUrl() ? `${siteUrl()}/product/${i.productId}` : ""
        )}" style="font-size:14px;color:#18181b;">Write a review</a></td></tr>`
    )
    .join("");

  queueMail({
    to: user.email,
    subject: items.length === 1 ? `How is your ${items[0].name}?` : "How was your order?",
    html: layout({
      heading: "How did we do?",
      intro:
        "Your order arrived a few days ago. If you have a moment, a short review helps other people decide — and tells us when something is not right.",
      body: `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${list}</table>`,
      footer: notificationFooter(user.id, "You are receiving this because you bought these items."),
    }),
    text: `How did we do?

Your order arrived a few days ago. A short review helps other people decide.

${items.map((i) => `  ${i.name}: ${siteUrl()}/product/${i.productId}`).join("\n")}${notificationFooterText(
      user.id,
      "You are receiving this because you bought these items."
    )}`,
  });

  return true;
};

/**
 * "You left this behind."
 *
 * Distinct from the "order not completed" notice that `releaseOrder` already
 * sends: that one is immediate and transactional — it tells someone their
 * payment did not go through and nothing was charged. This is a nudge sent a
 * day later, and it is marketing, which is why only this one is opt-out gated
 * and why the sweep refuses to send it to anyone who has since bought
 * something.
 */
export const sendCheckoutRecovery = async (
  user: Recipient,
  order: { id: string; items: { productId: string; name: string; price: number; quantity: number }[] }
): Promise<boolean> => {
  if (!mayNotify(user)) return false;

  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;font-size:14px;">${esc(i.name)} <span style="${MUTED}">× ${i.quantity}</span></td><td style="padding:8px 0;font-size:14px;text-align:right;">${esc(
          inr(i.price * i.quantity)
        )}</td></tr>`
    )
    .join("");

  queueMail({
    to: user.email,
    subject: "You left something in your basket",
    html: layout({
      heading: "Still interested?",
      intro:
        "Your checkout was not completed, so nothing was charged and the items went back on the shelf. They are still available — here is what you were looking at.",
      body: `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
        <p style="margin:20px 0 0;${MUTED}">Prices and availability may have changed since.</p>`,
      cta: siteUrl() ? { label: "Back to the shop", url: siteUrl() } : undefined,
      footer: notificationFooter(user.id, "You started a checkout that was not completed."),
    }),
    text: `Still interested?

Your checkout was not completed, so nothing was charged.

${order.items.map((i) => `  ${i.name} x${i.quantity}  ${inr(i.price * i.quantity)}`).join("\n")}

Prices and availability may have changed since.
${siteUrl()}${notificationFooterText(user.id, "You started a checkout that was not completed.")}`,
  });

  return true;
};
