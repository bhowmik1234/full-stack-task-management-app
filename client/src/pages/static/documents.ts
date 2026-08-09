import { storeAddress, storeName, supportEmail, supportPhone } from "../../utils/store";

/**
 * The policy pages, as data.
 *
 * Written as structured content rather than as six components because they are
 * six instances of the same thing — a heading, an intro and a list of sections —
 * and the only difference between them is words. One renderer means they cannot
 * drift apart in layout, and adding a seventh is an entry in this file.
 *
 * ## These are templates, and they say so
 *
 * The store's legal identity is not knowable from the code: the registered name,
 * the address, the return window in the operator's actual contract with their
 * courier. Everything that varies comes from `utils/store.ts` (environment) or
 * from the pricing config the server serves, and anything genuinely unknown is
 * left as a visible `[bracketed]` placeholder rather than filled with a
 * plausible invention.
 *
 * That choice matters more than it looks. A returns policy stating a made-up
 * postal address is not a draft — it is a document customers will act on, and
 * parcels will be posted to an address that does not exist. A bracket is
 * embarrassing for a week; an invented address is lost stock.
 *
 * Have a lawyer read these before launch. They are a complete, honest starting
 * point, not legal advice.
 */

export type PolicySection = {
  heading: string;
  /** Each string is a paragraph; nested arrays render as bullet lists. */
  body: (string | string[])[];
};

export type PolicyDocument = {
  slug: string;
  title: string;
  /** Shown under the title in search results and link previews. */
  description: string;
  intro: string;
  sections: PolicySection[];
  /** Rendered as "Last updated" — omit for pages where it reads oddly. */
  updated?: string;
};

/**
 * The date on the policies. A fixed string rather than `new Date()`, because a
 * policy that claims to have been updated today, every day, tells the reader
 * nothing and quietly misrepresents when the terms last changed.
 */
const UPDATED = "9 August 2026";

const CONTACT_LINE = () =>
  `Write to ${supportEmail()}${supportPhone() ? ` or call ${supportPhone()}` : ""}.`;

export const documents: Record<string, PolicyDocument> = {
  about: {
    slug: "about",
    title: "About us",
    description: `Who runs ${storeName()}, what we sell and how to reach us.`,
    intro: `${storeName()} is an online shop. This page says who we are and how to get hold of a person when something goes wrong.`,
    sections: [
      {
        heading: "What we do",
        body: [
          `We sell a curated catalogue across a handful of categories, ship across India, and handle every order ourselves rather than through a marketplace.`,
          `[Replace this section with the store's own description — what you sell, who you sell it to, and what makes the selection yours.]`,
        ],
      },
      {
        heading: "How to reach us",
        body: [
          CONTACT_LINE(),
          `We answer email on working days, usually within one. If your message is about an existing order, quoting the order number gets you a faster answer than describing the items.`,
        ],
      },
      {
        heading: "Where we are",
        body: [storeAddress()],
      },
    ],
  },

  shipping: {
    slug: "shipping",
    title: "Shipping policy",
    description: `Delivery times, charges and coverage for orders from ${storeName()}.`,
    intro:
      "What it costs to have an order delivered, how long it takes, and what happens when it does not arrive.",
    updated: UPDATED,
    sections: [
      {
        heading: "Charges",
        body: [
          "Shipping is charged per order and shown in full on the cart and checkout pages before you pay. Orders above the free-shipping threshold ship at no charge; the threshold and the flat rate are displayed live in your cart, because they are configured by the store and this page would go stale if it repeated them.",
          "Cash-on-delivery orders may carry a handling charge. When they do, it appears on the same line as shipping at checkout.",
        ],
      },
      {
        heading: "Delivery times",
        body: [
          "Orders are usually dispatched within [1–2] working days of payment clearing. Delivery after dispatch typically takes:",
          [
            "Metro cities — [2–4] working days",
            "Other cities and towns — [4–7] working days",
            "Remote pin codes — [7–10] working days",
          ],
          "These are estimates from our couriers, not guarantees. Public holidays, weather and local disruption all move them.",
        ],
      },
      {
        heading: "Tracking",
        body: [
          "When an order is dispatched we email you the carrier and tracking number, and both appear on the order's page under Your orders. Tracking information can take a few hours after dispatch to become active on the carrier's own site.",
        ],
      },
      {
        heading: "If it does not arrive",
        body: [
          "If tracking has not moved for [5] working days, or the estimated window has passed, contact us and we will chase it with the carrier. Do not wait for the return window to close before telling us — a parcel reported late can be traced, and a parcel written off cannot.",
          CONTACT_LINE(),
        ],
      },
      {
        heading: "Addresses",
        body: [
          "We ship to the address recorded on the order. That address is a copy taken at checkout and cannot be changed once the order is placed — if you need it changed, contact us immediately and we will cancel and re-place the order if it has not yet been dispatched.",
        ],
      },
    ],
  },

  returns: {
    slug: "returns",
    title: "Returns and refunds",
    description: `How to return an item to ${storeName()}, and when you get your money back.`,
    intro:
      "You can return most items after delivery. This page explains the window, what qualifies, and how the refund is worked out.",
    updated: UPDATED,
    sections: [
      {
        heading: "The window",
        body: [
          "Returns are accepted within the return window shown on your order page, counted from the day the order was delivered. The window is set by the store and displayed live on the order itself, so it cannot be out of date here.",
          "Start a return from Your orders — open the order, choose Return items, pick what you are sending back and why. You do not need to email us first.",
        ],
      },
      {
        heading: "What can be returned",
        body: [
          "Most items, provided they are unused, in a resaleable condition and in their original packaging with any tags attached.",
          "The following cannot be returned unless they arrived damaged or we sent the wrong thing:",
          [
            "Items marked non-returnable on their product page",
            "Perishable goods",
            "Personal-care and hygiene items once opened",
            "Made-to-order or personalised items",
          ],
          "If an item arrived damaged or is not what you ordered, say so when you open the return. That is not a change of mind and is not subject to the conditions above.",
        ],
      },
      {
        heading: "How to send it back",
        body: [
          "Once we approve the return we email you with where to send the items. Please do not post anything before the return is approved — an unannounced parcel cannot be matched to an order and takes far longer to refund.",
          `Return address: ${storeAddress()}`,
        ],
      },
      {
        heading: "Refunds",
        body: [
          "We refund once the items are back with us and have been checked. That usually happens within [2] working days of the parcel arriving.",
          "The refund covers what you paid for the returned items, plus the tax charged on them. Where a discount code was applied to the order, the same proportion of that discount is deducted, so the value of the code is shared across the whole order rather than kept in full on a partial return.",
          "Delivery charges are refunded only when the entire order is returned. On a partial return the parcel was still delivered, so the delivery charge stands.",
          "Refunds go back to the original payment method and typically take 5–7 working days to appear, depending on your bank. For cash-on-delivery orders we will contact you to arrange the payout.",
        ],
      },
      {
        heading: "Cancelling instead",
        body: [
          "An order that has not yet shipped can be cancelled outright from its order page, which is faster than a return and refunds in full. Once an order has shipped, returns are the only route.",
        ],
      },
    ],
  },

  privacy: {
    slug: "privacy",
    title: "Privacy policy",
    description: `What data ${storeName()} collects, why, and what you can ask us to do with it.`,
    intro:
      "What we collect, why we collect it, who else sees it, and how to get it deleted.",
    updated: UPDATED,
    sections: [
      {
        heading: "What we collect",
        body: [
          "When you create an account we store the name, and the email address or phone number, that your sign-in provider gives us. Signing in with Google provides an email address and a profile photo; signing in by phone provides a number and neither of the others.",
          "When you place an order we store the delivery address you entered, the items, the amounts, and the payment reference our payment provider returns. We do not store card numbers — they are entered on the payment provider's own form and never reach us.",
          "We also store what you choose to save: addresses in your address book, wishlist items, and any reviews you write.",
        ],
      },
      {
        heading: "Why",
        body: [
          "To take and deliver orders, to answer questions about them, to keep the financial records the law requires, and to show you your own order history.",
          "We send two kinds of email, and they are treated differently. Order confirmations, dispatch notices and refund notices are part of the transaction and are sent regardless of preferences — they are the record of what you paid. Everything else (back-in-stock alerts, review requests, reminders about an unfinished checkout) is optional, carries an unsubscribe link, and stops the moment you opt out.",
        ],
      },
      {
        heading: "Who else sees it",
        body: [
          "Only the parties needed to complete an order:",
          [
            "Our payment provider, to take the payment",
            "Our delivery partners, to deliver the parcel — they get the delivery address and a contact number",
            "Our email provider, to send the messages above",
            "Our hosting provider, which stores the database",
          ],
          "We do not sell personal data, and we do not share it for anyone else's advertising.",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "Order records are kept for as long as the law requires us to keep financial records — [7] years in most cases. Account details are kept until you close the account.",
          "Closing your account from Settings anonymises it rather than deleting it outright: your name is removed, your email, phone and photo are cleared, and your wishlist, saved addresses and reviews are deleted. The orders themselves survive, without your identity attached, because a completed purchase is a financial record we are not free to erase.",
        ],
      },
      {
        heading: "Your choices",
        body: [
          "You can view and edit your details, manage your addresses, turn off optional email and close your account from Settings, without asking us.",
          `For anything else — a copy of your data, or a correction we cannot make ourselves — ${CONTACT_LINE().toLowerCase()}`,
        ],
      },
      {
        heading: "Cookies and analytics",
        body: [
          "We use a small amount of browser storage to keep you signed in and to remember your cart and recent searches between visits. Those are necessary for the site to work.",
          "We also use [Firebase Analytics / your analytics provider] to understand which pages are used. [State here whether it is loaded before or after consent, and link your cookie banner if you add one.]",
        ],
      },
    ],
  },

  terms: {
    slug: "terms",
    title: "Terms of service",
    description: `The terms you agree to when buying from ${storeName()}.`,
    intro: "The agreement between you and us when you place an order.",
    updated: UPDATED,
    sections: [
      {
        heading: "Who you are contracting with",
        body: [
          `Purchases on this site are a contract between you and ${storeName()}, [registered entity name and registration number], of ${storeAddress()}.`,
        ],
      },
      {
        heading: "Orders",
        body: [
          "Placing an order is an offer to buy. The contract is formed when we confirm the order by email. We may decline an order — for example if an item turns out to be out of stock, if the price was listed in error, or if we cannot deliver to the address given — and if we do, anything you have paid is refunded in full.",
          "Prices and availability shown on the site can change until the order is confirmed. The prices in your order confirmation are the ones that apply.",
        ],
      },
      {
        heading: "Payment",
        body: [
          "Prices include applicable taxes, which are itemised at checkout. Payment is taken through our payment provider at the time of the order, except for cash-on-delivery orders, which are paid to the courier on delivery.",
          "An order placed but not paid for is held for a short period so the stock is not sold twice, and is cancelled automatically after that. Nothing is charged for a cancelled unpaid order.",
        ],
      },
      {
        heading: "Delivery, returns and refunds",
        body: [
          "Delivery is covered by our shipping policy and returns by our returns policy. Both form part of these terms.",
          "Nothing in these terms limits the rights you have under consumer law, including in relation to goods that are faulty or not as described.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You are responsible for what happens under your account. Do not share your sign-in. Tell us promptly if you think someone else has access to it.",
          "Reviews and other content you post must be your own and must not be unlawful, misleading or abusive. We may remove content that is not.",
        ],
      },
      {
        heading: "Liability",
        body: [
          "We are responsible for loss you suffer that is a foreseeable result of our breaking these terms. We are not responsible for loss that was not foreseeable, or for business losses.",
          "We do not exclude or limit liability where it would be unlawful to do so, including for death or personal injury caused by our negligence, or for fraud.",
        ],
      },
      {
        heading: "Changes and governing law",
        body: [
          "We may change these terms. The version that applies to an order is the one published when the order was placed.",
          "These terms are governed by the laws of India, and disputes are subject to the courts of [city]. [Confirm this with a lawyer — it must match where the business is registered.]",
        ],
      },
    ],
  },
};

export const documentSlugs = Object.keys(documents);
