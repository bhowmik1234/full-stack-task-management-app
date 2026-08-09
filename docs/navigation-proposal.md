# Navigation and click behaviour: gap analysis and proposal

> **Status: implemented.** N1–N11 and N13 are all done — Phases 1, 2 and 3 of
> §3. N12 (`/admin/*` redirecting silently) is left as it was; §2.4 argues it is
> correct, not a bug. `safeReturnTo` has the unit tests §4 asks for; the
> checklist in §4 is still a manual pass.
>
> One thing outside the original scope was fixed on the way: the store-identity
> `VITE_*` values were documented in `.env.example` but never passed into the
> image build, so every compose deploy rendered `[set VITE_STORE_ADDRESS]` in
> its own policy pages regardless of configuration. The new `VITE_SOCIAL_*`
> would have landed in the same hole, so both are now plumbed through
> `client/Dockerfile` and `docker-compose.yml`.

Scope: the storefront's routing, the sign-in / sign-out round trip, and every
control a customer can click that is meant to move them somewhere. The console
(`src/admin/`) is out of scope — it has its own single nav list, its own guard
and its own active state, and none of the problems below.

The routing itself is in good shape: `App.tsx` has a real 404 catch-all, an
`ErrorBoundary` keyed on pathname, `ScrollToTop` that respects POP and hash
targets, `/account` → `/profile`, and one list (`pages/account/navigation.ts`)
driving the account sidebar so a section cannot be visible but unreachable.
`ProtectedRoute` already records where the visitor was headed.

What is broken is the *return leg*. `ProtectedRoute` remembers the destination;
almost nothing else does, and sign-out remembers nothing at all. Everything in
§2.1 is a customer who clicked the right thing and ended up somewhere they did
not ask for.

---

## 1. How the auth round trip works today

```
                          state.from set?
/orders  (signed out)  ──────  yes  ──────►  /login  ──sign in──►  /orders   ✅
   via ProtectedRoute

Cart "Log in to checkout" ───  no   ──────►  /login  ──sign in──►  /         ❌
Header sign-in icon      ───  no   ──────►  /login  ──sign in──►  /         ❌
Product "Buy now"        ───  no   ──────►  /login  ──sign in──►  /         ❌
Wishlist heart           ───  no route at all: a toast saying "please login"   ❌

/settings ──sign out──► userNotExits ──► ProtectedRoute ──► /login          ❌
                                          (state.from = /settings)
```

`ProtectedRoute` is the only caller that sets `state.from`. `Login.tsx:51` reads
it and `Login.tsx:197` honours it, so the mechanism works — three of the four
places that send someone to sign in just do not use it.

---

## 2. Gaps

Ordered by how much of a customer's intent they discard.

### 2.1 Critical — the customer loses their place

**N1. "Log in to checkout" abandons the cart.**
`pages/Cart.tsx:211` renders `<Link to="/login">` with no state. A signed-out
shopper with a full cart clicks the one call to action on the page, signs in,
and lands on the home page. The cart survives (it is in Redux + storage) but
the flow does not: they have to find their way back to `/cart` and click the
same button again. This is the single most expensive click in the app.

**N2. "Buy now" does the same thing, after adding the item.**
`pages/Product.tsx:186` — `navigate(user?._id ? "/shipping" : "/login")`. The
item *is* added to the cart first, so the state is right; the destination is
thrown away. The comment above it says it sends them to login "rather than
letting it bounce them home" — which is true of `/`, but signing in bounces
them home anyway.

**N3. The header's sign-in icon always returns you to the home page.**
`components/Header.tsx:144`. Signing in from a product page, a search result or
the cart is a navigation away from what you were reading, with no way back but
the browser button. This is the most-used sign-in entry point in the app.

**N4. Signing out strands you on the sign-in form.**
`components/Header.tsx:68` `logoutHandler` dispatches nothing and navigates
nowhere. On any account page — `/profile`, `/orders`, `/settings`, `/wishlist` —
`userNotExits` fires, `ProtectedRoute` re-evaluates, and the customer who just
asked to leave is shown a sign-in page with `state.from` pointing back at the
page they signed out of. `pages/account/Settings.tsx:217` already gets this
right for account closure (`navigate("/", { replace: true })`); sign-out should
match it.

**N5. Login-gated actions are dead ends, not gates.**
`components/ProductCart.tsx:73` ("Please login to use your wishlist."),
`Product.tsx` `toggleStockAlert` ("Please login so we know where to email
you."), and the review form all answer a click with a toast and no route. The
message names the requirement and offers no way to satisfy it. CLAUDE.md states
login is demanded in exactly four places and each explains itself — these
explain, but they do not *offer*.

### 2.2 Moderate — clicks that do nothing, or leave the app

**N6. Four dead social links in the footer.**
`components/Footer.tsx:69-72` — `<a href="#">` for Facebook, Twitter, Instagram
and Pinterest. Clicking one scrolls the page to the top and does nothing else,
which reads as a broken page rather than an absent one. The footer's own
comment records that this class of link was already cleaned up once ("links to
'/' wearing the labels of pages that did not exist"); these four survived.

**N7. A full page reload from inside the return dialog.**
`components/ReturnDialog.tsx:188` uses `<a href="/returns-policy">` where every
other in-app link uses `<Link>`. It is a raw anchor, so the browser reloads the
whole SPA and the half-filled return form is gone. `pages/Product.tsx:456`
links to the same page correctly with `<Link>` — the contrast is the bug.

**N8. The newsletter form reports a success that never happened.**
`Footer.tsx:12-18` clears the field and toasts "Thanks — you're on the list."
There is no endpoint. This is a click that lies about its outcome.

### 2.3 Moderate — you cannot tell where you are

**N9. The header nav has no active state.**
`Header.tsx:198-212` — "Home", "All products" and every category use plain
`Link`, so nothing indicates the current section. Two other places in this
codebase do it properly and can be copied: `pages/account/AccountLayout.tsx:52`
sets `aria-current="page"`, and `components/CheckoutSteps.tsx:17` sets
`aria-current="step"`. The category rail is the harder half — the active
category lives in `?category=`, not the pathname, so `NavLink` alone will not
answer it.

**N10. The account menu is a popup with no focus management.**
`Header.tsx:151-196` closes on route change and on Escape, and has a scrim —
all correct. But focus stays on the trigger button when it opens, is not
trapped, and is not restored on close, and the container has no `role="menu"`.
A keyboard user tabs from the trigger straight past the menu into the page
behind the scrim.

### 2.4 Minor

**N11. `/search/:id` has no canonical relationship to `/search?q=`.** Both
render the same page. `Seo` drops the query string from the canonical URL, so
`/search?q=shoes` canonicalises to `/search` while `/search/shoes` stays
distinct — two URLs, neither pointing at the other.

**N12. `/admin/*` redirects silently.** `App.tsx:190` sends an old console
bookmark to `/` with no explanation. Defensible (the storefront must not
advertise the console) but the operator sees an unexplained bounce.

**N13. `Login.tsx:51` trusts `state.from` unvalidated.** It is only ever set by
`ProtectedRoute` today, so this is latent rather than live — but `from` flows
straight into `<Navigate to={from}>`, and a value of `/login` would loop while a
protocol-relative value would leave the site. One guard closes it permanently.

---

## 3. Proposal

### Phase 1 — the return leg (closes N1–N5, N13)

One helper, four call sites, and a redirect on sign-out.

**3.1 A single "send them to sign in" helper.** New `src/utils/loginRedirect.ts`:

```ts
/** Where /login should return to. Internal paths only — `from` ends up in
 *  <Navigate to>, so a protocol-relative value would leave the site, and
 *  "/login" would loop. */
export const safeReturnTo = (from?: string | null) =>
  from && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login")
    ? from
    : "/";

/** Router state for any link or navigate() that lands on /login. */
export const loginState = (from: string) => ({ from: safeReturnTo(from) });
```

Applied at:

| File | Today | After |
|---|---|---|
| `Cart.tsx:211` | `<Link to="/login">` | `<Link to="/login" state={loginState("/shipping")}>` — straight into checkout, not back to the cart |
| `Product.tsx:186` | `navigate("/login")` | `navigate("/login", { state: loginState("/shipping") })` — the item is already in the cart |
| `Header.tsx:144` | `<Link to="/login">` | `state={loginState(location.pathname + location.search)}` — `location` is already in scope |
| `Login.tsx:51` | `?? "/"` | `safeReturnTo((location.state as …)?.from)` |

Cart and Buy-now deliberately return to `/shipping` rather than to the page the
customer was on: they asked to check out, and sign-in was the only thing in the
way.

**3.2 Sign-out goes home.** `Header.tsx` `logoutHandler` gains
`navigate("/", { replace: true })` after `signOut`, matching
`Settings.tsx:217`. `replace` so the back button does not return to a page the
session no longer permits.

**3.3 Login-gated actions offer the gate.** Replace the three
`toast.error("Please login…")` calls with a navigation carrying the current
location, so the customer signs in and comes back to the product they were
looking at. Whether the *action* replays (the heart having been clicked) is
Phase 3 — the return trip alone fixes the dead end.

### Phase 2 — orientation and affordance (closes N6–N10)

**3.4 Header active state.** `Home` and `All products` become `NavLink` with
`end`. The category rail reads `useSearchParams()` and marks the matching entry
with `aria-current="page"` plus an `is-active` class, since the state lives in
the query string. One new SCSS rule in the header partial.

**3.5 Account menu keyboard behaviour.** Move focus to the first item on open,
restore it to the trigger on close, add `role="menu"` / `role="menuitem"`, and
trap Tab within the menu while it is open. Escape and the scrim already work.

**3.6 Fix the two broken link kinds.** `ReturnDialog.tsx:188` becomes `<Link>`.
The four footer social anchors get real URLs from config (`VITE_SOCIAL_*`, in
`vite-env.d.ts` like the other store-identity values) and each renders **only
when its URL is set** — an absent icon is honest, `href="#"` is not.

**3.7 The newsletter form stops claiming success.** Either wire it to a real
endpoint or replace the fake toast with a link to `/contact`. My recommendation
is to remove the form: `User.emailOptOut` and the unsubscribe HMAC already
exist for people who have accounts, and a second unauthenticated list is a
consent surface with no unsubscribe path behind it.

### Phase 3 — optional, only if Phase 1 leaves a real gap

**3.8 Resume the interrupted action, not just the page.** Carry the intent in
the same router state (`{ from, intent: { type: "wishlist", productId } }`) and
have the destination page act on it once. Worth doing only for the wishlist
heart, which is the one gated action where returning to the page still leaves a
second click. Deliberately *not* a queue or a storage-backed pending-action
system — that is a lot of machinery for one button.

**3.9 Canonicalise `/search/:id`.** Redirect it to `/search?q=<id>` with
`replace`, keeping the old links working while collapsing to one URL.

---

## 4. Verification

There is no route-level test today and this proposal does not add a test
harness — the suite is deliberately unit tests over pure functions (CLAUDE.md),
and route tests would mean adding jsdom to a client suite that has none.

Two things are cheap and worth doing:

- `safeReturnTo` is a pure function and gets a unit test in the existing
  `client/src/**/__tests__/` style — the `/login`, `//host` and `undefined`
  cases are exactly the ones that will not be noticed by hand.
- The rest is a manual checklist, run once per phase:

| Start | Click | Expect |
|---|---|---|
| `/product/:id`, signed out | Buy now | `/login` → sign in → `/shipping`, item in cart |
| `/cart`, signed out | Log in to checkout | `/login` → sign in → `/shipping` |
| `/search?q=x`, signed out | header sign-in | `/login` → sign in → `/search?q=x` |
| `/settings`, signed in | Sign out | `/`, no sign-in form |
| `/orders/:id`, signed in | Sign out | `/`, back button does not re-enter |
| `/product/:id`, signed out | wishlist heart | `/login` → sign in → back on the product |
| return dialog | "returns policy" | new page, no full reload |
| any category | — | that category marked active in the rail |

## 5. What this does not touch

Route structure. Nothing moves, nothing is renamed, no prefix is added. Every
URL in the app today keeps working — the account sections stay at `/orders`,
`/wishlist`, `/profile` for the reason `pages/account/navigation.ts` records,
and checkout stays outside the account shell. The changes above are all to
*where a control sends you*, never to what the address is.
