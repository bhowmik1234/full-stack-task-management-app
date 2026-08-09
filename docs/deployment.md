# Deployment guide

Taking this store from a fresh server to live, with HTTPS, backups, and both
sites running: the shop and the admin console.

Follow the phases in order. Phases 1–4 can be done in any order but must all be
finished before phase 5, because certificate issuance and the first build both
depend on them.

**Time:** about an hour, most of it waiting for DNS.

**Contents**

1. [What you need first](#1-what-you-need-first)
2. [Prepare the server](#2-prepare-the-server)
3. [DNS](#3-dns)
4. [Third-party accounts](#4-third-party-accounts)
5. [Configure `.env`](#5-configure-env)
6. [First deploy](#6-first-deploy)
7. [Post-deploy setup](#7-post-deploy-setup)
8. [Verify it works](#8-verify-it-works)
9. [Changing values later](#9-changing-values-later)
10. [Operating](#10-operating)
11. [Backups and restore](#11-backups-and-restore)
12. [Troubleshooting](#12-troubleshooting)
13. [Full variable reference](#13-full-variable-reference)

---

## 1. What you need first

| | |
|---|---|
| **A server** | 2 GB RAM minimum (4 GB comfortable — it runs Postgres, Node, nginx and Caddy). Any Linux with Docker. |
| **A domain** | You must be able to edit its DNS records. |
| **Firebase project** | Free tier is fine. Handles all customer and operator sign-in. |
| **Razorpay account** | For payments. Needs KYC completed before live keys are issued — start this early, it can take days. |
| **Resend account** | Optional. Without it the store runs and logs emails instead of sending them. |

The store is priced in **INR** throughout and Razorpay is the only payment
provider wired in. Swapping providers is a code change, not configuration.

---

## 2. Prepare the server

SSH in as root or a sudo user.

### 2.1 Install Docker

```sh
curl -fsSL https://get.docker.com | sh
```

Verify — you need Compose **v2.24 or newer**, because the production overlay
uses the `!override` tag:

```sh
docker --version
docker compose version
```

### 2.2 Create a non-root user

Running the stack as root is avoidable, so avoid it:

```sh
adduser deploy
usermod -aG docker deploy
su - deploy
```

Everything from here runs as `deploy`.

### 2.3 Firewall

Ports 80 and 443 must be open. **80 is not optional** — Let's Encrypt validates
the domain over it, and it serves the HTTP→HTTPS redirect.

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do not open 5432. The overlay binds Postgres to loopback deliberately.

---

## 3. DNS

Create three records pointing at your server's IP:

| Type | Name | Value |
|---|---|---|
| A | `your-domain.com` | your server IP |
| A | `www` | your server IP |
| A | `app.admin` | your server IP |

`app.admin.your-domain.com` is the **admin console**. It is reachable only by
hostname — there is deliberately no `/admin` path on the shop, so this record is
not optional if you want a console.

**Wait for propagation before phase 6.** Certificates cannot be issued for a
hostname that does not yet resolve to this server, and Let's Encrypt limits you
to 5 failures per hostname per week — enough to lock you out of HTTPS for days.

Check all three resolve to the right IP:

```sh
dig +short your-domain.com www.your-domain.com app.admin.your-domain.com
```

---

## 4. Third-party accounts

### 4.1 Firebase — sign-in for both customers and operators

At <https://console.firebase.google.com>:

**a. Create a project** (or use an existing one).

**b. Enable sign-in providers** — Authentication → Sign-in method:
- **Google** — required. Operators can *only* sign in this way by default.
- **Phone** — optional, for customer SMS sign-in. Enable it if you want it;
  the storefront offers both.

**c. Authorize your domains** — Authentication → Settings → Authorized domains.
Add **both**:
```
your-domain.com
app.admin.your-domain.com
```
Forgetting the admin host is the single most common setup mistake. Console
sign-in fails with `auth/unauthorized-domain` and nothing else explains why.

**d. Get the web app config** — Project settings → General → Your apps → Web app
(create one if absent). Copy these into `.env`:

| Firebase field | `.env` variable |
|---|---|
| `apiKey` | `VITE_FIREBASE_KEY` |
| `authDomain` | `VITE_FIREBASE_DOMAIN` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `storageBucket` | `VITE_FIREBASE_BUCKET` |
| `messagingSenderId` | `VITE_FIREBASE_SENDER_ID` |
| `appId` | `VITE_FIREBASE_APPID` |
| `measurementId` | `VITE_FIREBASE_MEASUREMENT_ID` |

These are public values compiled into the browser bundle. They are not secrets.

**e. Get the service account** — Project settings → Service accounts →
Generate new private key. A JSON file downloads. Take three fields:

| JSON field | `.env` variable |
|---|---|
| `project_id` | `FIREBASE_PROJECT_ID` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |

**This one is a real secret.** For `FIREBASE_PRIVATE_KEY`, keep the surrounding
double quotes and the literal `\n` sequences exactly as they appear in the JSON
— do not convert them to real newlines:

```sh
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQI...\n-----END PRIVATE KEY-----\n"
```

Without these three, every admin route returns **503** in production. That is
deliberate: a console protected only by a uid in a URL, while the docs and UI
claim otherwise, is worse than one that is plainly broken.

### 4.2 Razorpay — payments

At <https://dashboard.razorpay.com>:

**a. Complete KYC** and switch to **Live** mode. Test keys work for testing but
take no real money.

**b. API keys** — Settings → API Keys → Generate:
- `RAZORPAY_KEY_ID` — public, handed to the browser to open checkout
- `RAZORPAY_KEY_SECRET` — secret, signs the checkout callback, never leaves the server

**c. Webhook** — Settings → Webhooks → Add New Webhook:

| Field | Value |
|---|---|
| URL | `https://your-domain.com/api/v1/payement/webhook` |
| Secret | any strong random string → `RAZORPAY_WEBHOOK_SECRET` |
| Events | `payment.captured`, `order.paid`, `payment.failed` |

Note the URL spelling: **`payement`**. It is misspelled consistently throughout
the codebase and is load-bearing — the route really is spelled that way.

The webhook secret is a *different* secret from the API key secret. They sign
different things and are not interchangeable.

**Do not skip the webhook.** It is what settles an order when a customer closes
the tab mid-payment. Without it, that order stays unpaid until the expiry sweep
cancels it 30 minutes later — leaving a customer charged with no order.

Generate a secret with:

```sh
openssl rand -hex 32
```

### 4.3 Resend — transactional email (optional)

At <https://resend.com>: verify your sending domain, create an API key.

- `RESEND_API_KEY` — the key
- `MAIL_FROM` — must be on the verified domain, e.g. `Your Store <orders@your-domain.com>`
- `STORE_NAME` — appears in subject lines

Unset, the store still takes orders and logs each message instead of sending —
but customers get no receipts, no shipping notices and no refund confirmations.
Treat it as required for a real shop.

---

## 5. Configure `.env`

```sh
git clone <your-repo-url> ecommerce
cd ecommerce
cp .env.example .env
nano .env
```

This root `.env` is read by **docker compose only**. `backend/.env` and
`client/.env` are for local `npm run dev` and are not used in production.

### 5.1 The 15 values you must set

Compose refuses to start without these, rather than starting a store that
cannot charge anyone:

```sh
# --- database ---
POSTGRES_PASSWORD=<openssl rand -base64 24>
DATABASE_URL=postgresql://ecommerce:<same password>@db:5432/ecommerce?schema=public

# --- TLS ---
SITE_DOMAIN=your-domain.com          # apex only: no https://, no trailing slash
ACME_EMAIL=you@your-domain.com

# --- payments ---
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxx

# --- console sign-in (service account JSON) ---
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# --- client sign-in (web app config) ---
VITE_FIREBASE_KEY=AIza...
VITE_FIREBASE_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APPID=1:123:web:abc

# --- origins ---
VITE_SERVER=https://your-domain.com
```

The password appears twice — in `POSTGRES_PASSWORD` and inside `DATABASE_URL`.
They must match. If the password contains `@`, `/`, `:` or `#`, URL-encode it in
`DATABASE_URL` or use a password without them.

### 5.2 Strongly recommended

```sh
# Pins admin routes to the console's origin. Unset, that protection is OFF.
ADMIN_URL=https://app.admin.your-domain.com

# Email. Without these, no receipts go out.
RESEND_API_KEY=re_xxxxx
MAIL_FROM=Your Store <orders@your-domain.com>
STORE_NAME=Your Store

# Store identity — rendered into the policy pages and page titles.
# Unset renders a visible [placeholder], deliberately, rather than an invention.
VITE_STORE_NAME=Your Store
VITE_SUPPORT_EMAIL=support@your-domain.com
VITE_SUPPORT_PHONE=+91 90000 00000
VITE_STORE_ADDRESS=1 Example Road, City, State 000000
VITE_SITE_URL=https://your-domain.com
```

Leave `CLIENT_URL` empty and `VITE_ADMIN_SERVER` empty. Behind this nginx both
SPAs are same-origin with the API, which is what makes them work without CORS.

### 5.3 Optional — business rules

These are **backend** values read at runtime, so changing one is a restart, not
a rebuild. Every one is optional and reproduces the previous hardcoded default
if unset.

```sh
TAX_RATE=0.18                 # a fraction, not a percentage
SHIPPING_FEE=200
FREE_SHIPPING_THRESHOLD=1000  # subtotal strictly above this ships free
SHIPPING_ZONES=               # e.g. {"kerala":150,"assam":250}
RETURN_WINDOW_DAYS=7
LOW_STOCK_THRESHOLD=5

COD_ENABLED=false             # cash on delivery, off by default
COD_MAX_ORDER_VALUE=20000     # 0 = no ceiling
COD_FEE=0

# Console session policy
ADMIN_SIGN_IN_PROVIDERS=google.com
ADMIN_SESSION_MAX_AGE_HOURS=12
ADMIN_REQUIRE_MFA=false       # see the warning in phase 9
```

### 5.4 Lock the file down

It now holds your database password, payment secret and Firebase private key:

```sh
chmod 600 .env
```

---

## 6. First deploy

Every command uses both compose files. Set this alias so the second one is never
forgotten — a deploy missing it has no TLS, no backups, and Postgres exposed:

```sh
alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
echo "alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'" >> ~/.bashrc
```

Build and start:

```sh
dc up -d --build
```

First build takes several minutes. Then watch Caddy get certificates — this is
where domain problems surface:

```sh
dc logs -f caddy
```

Look for `certificate obtained successfully`. Ctrl-C to stop tailing.

Check everything is up, and that `backend` reports **healthy**:

```sh
dc ps
```

`migrate` showing `Exited (0)` is correct — it applies migrations and stops.

---

## 7. Post-deploy setup

### 7.1 Create the owner account

Nobody can enter the console until this is done. It is a shell command on
purpose: the first owner has no owner to authorize them, and any HTTP endpoint
able to mint an owner could mint one at any time.

**Step 1.** Go to `https://your-domain.com/login` and sign in **with Google**,
using the account that will own the store. This creates the user row. (Sign in
on the *shop*, not the console — you have no access there yet.)

**Step 2.** Get that account's uid from Firebase Console → Authentication →
Users → the `User UID` column.

**Step 3.** Grant it:

```sh
dc exec backend node dist/scripts/grant-root.js <the-firebase-uid>
```

(Locally, outside Docker, the same thing is `npm run grant:root -- <uid>` in
`backend/`. The container runs the compiled `dist/` copy because it installs
production dependencies only and has no TypeScript runtime.)

**Step 4.** Sign in at `https://app.admin.your-domain.com`.

From here on, all other operator access is granted through the console's Access
page — never this command again, except to recover stranded ownership.

### 7.2 Import pre-existing product photos

Only if your repo carries product images from earlier development. They are not
in the Docker image and the volume mounts over them, so products referencing
them would show broken images:

```sh
./scripts/import-uploads.sh
```

### 7.3 Seed the catalogue

There is no bulk import. Add products through the console: Catalogue → New
product.

---

## 8. Verify it works

Work through all of it. Each line catches a different misconfiguration.

**TLS and both hosts**

```sh
curl -sI https://your-domain.com | head -1                  # 200
curl -sI https://app.admin.your-domain.com | head -1        # 200
curl -sI http://your-domain.com | head -1                   # 308 -> https
```

**The two sites are actually separate** — each must refuse the other's bundle:

```sh
curl -so /dev/null -w '%{http_code}\n' https://your-domain.com/admin.html            # 404
curl -so /dev/null -w '%{http_code}\n' https://app.admin.your-domain.com/index.html  # 404
```

**Backend health**

```sh
curl -s https://your-domain.com/api/v1/config/storefront   # JSON of your pricing rules
dc exec backend wget -qO- localhost:3000/health/ready      # {"success":true,...}
```

**Security headers**

```sh
curl -sI https://your-domain.com | grep -i 'content-security\|strict-transport'
```

**In a browser, end to end:**

- [ ] Storefront loads, products visible
- [ ] Sign in with Google works
- [ ] Add to cart → `/shipping` → place an order
- [ ] Payment completes and the order appears under `/orders`
- [ ] Receipt email arrives (if Resend is configured)
- [ ] Console loads at `app.admin.` and sign-in works
- [ ] The order is visible in the console and can be advanced to Shipped
- [ ] `https://your-domain.com/sitemap.xml` lists your products

**Payments, properly.** Place one real low-value order and refund it from the
console. Test keys do not prove the live webhook works, and the webhook is the
part that fails quietly.

---

## 9. Changing values later

**This distinction matters.** Which file a value lives in determines what
applying it costs:

| Kind | Examples | To apply |
|---|---|---|
| **`VITE_*`** — compiled into the browser bundle at image build | store name, Firebase web config, social links, `VITE_SITE_URL` | `dc up -d --build web` |
| **Everything else** — read at runtime | pricing, tax, COD, secrets, `ADMIN_URL`, mail | `dc up -d backend` |

A `VITE_*` change followed by a plain restart does nothing at all, and nothing
reports an error — the old value is already baked into the bundle.

**Changing pricing** (tax, shipping, free-shipping threshold) only needs the
backend restarted. The storefront fetches those from
`GET /api/v1/config/storefront` at runtime precisely so a tax change is not a
rebuild of two applications.

**Enabling MFA for operators** — `ADMIN_REQUIRE_MFA=true`. Have every operator
enrol a second factor **first**; switching it on before they do locks all of
them out, owner included. It also requires the Firebase project upgraded to
Identity Platform.

**Rotating a secret:** edit `.env`, then `dc up -d backend`. Changing
`MAIL_UNSUBSCRIBE_SECRET` invalidates every unsubscribe link already sitting in
customers' inboxes.

---

## 10. Operating

### Updating

```sh
git pull
dc up -d --build
```

Migrations apply automatically before the backend starts. Expect a few seconds
of downtime — zero-downtime is out of scope for a single-container backend. The
backend handles SIGTERM by draining in-flight requests first, so a redeploy does
not cut off a checkout mid-transaction.

### Everyday commands

```sh
dc ps                          # health of everything
dc logs -f backend             # application log
dc logs -f caddy               # TLS and renewals
dc logs --tail=100 backup      # backup history
dc restart backend
dc exec db psql -U ecommerce   # database shell
```

### Reaching the origin directly

`web` and `db` are bound to loopback, so these work over SSH on the box and from
nowhere else. Bypassing Caddy is how you tell a TLS problem from an application
one:

```sh
curl -sI localhost:8080                   # nginx directly
curl -s localhost:8080/health/ready       # backend readiness through nginx
```

### Certificate renewal

Automatic. Caddy renews about 30 days before expiry. Nothing to schedule and no
timer to notice has stopped. Confirm with `dc logs caddy | grep -i renew`.

---

## 11. Backups and restore

The `backup` service dumps the database daily into `./backups`, keeps 14 days,
and prunes only *after* a dump that succeeded.

```sh
ls -lh backups/
```

### Get them off the machine

**What runs now is not yet a backup.** It sits on the same disk as the database.
It survives a bad migration or a mistaken `DELETE` — not a failed disk, a lost
server, or a compromised host, which are the cases people actually lose
businesses to. Add one of these:

```sh
# from another machine, nightly via cron
rsync -az deploy@your-server:/home/deploy/ecommerce/backups/ /local/backups/
```

or `rclone` to object storage, or your provider's automated volume snapshots.

### Product images are not in the database

They live in the `uploads` volume and need their own snapshot:

```sh
docker run --rm -v ecommerce_uploads:/src:ro -v "$PWD/backups:/out" \
  alpine:3 tar czf /out/uploads-$(date -u +%Y%m%d).tar.gz -C /src .
```

### Restoring

```sh
gunzip -c backups/ecommerce-<stamp>.sql.gz | dc exec -T db psql -U ecommerce -d ecommerce
```

The dumps are `--clean --if-exists`: this drops and recreates each object rather
than merging into existing data.

### Test the restore before you need it

A backup nobody has restored is a hypothesis. Into a scratch database:

```sh
dc exec db psql -U ecommerce -d postgres -c 'CREATE DATABASE restoretest;'
gunzip -c backups/<file>.sql.gz | dc exec -T db psql -U ecommerce -d restoretest
dc exec db psql -U ecommerce -d restoretest -c 'SELECT count(*) FROM "Order";'
dc exec db psql -U ecommerce -d postgres -c 'DROP DATABASE restoretest;'
```

---

## 12. Troubleshooting

### Certificates will not issue

```sh
dc logs caddy | grep -i error
```

- DNS does not resolve to this server yet → `dig +short your-domain.com`
- Port 80 blocked → the ACME challenge cannot complete
- Rate limited after repeated failures → 5 per hostname per week; wait it out.
  Fix DNS *before* retrying rather than restarting repeatedly.

### Admin routes return 503

`FIREBASE_PROJECT_ID` / `CLIENT_EMAIL` / `PRIVATE_KEY` missing or malformed —
usually the private key. It needs surrounding double quotes and literal `\n`.

This is a deliberate fail-closed: rather than silently downgrade to the weaker
`?id=` scheme, the console breaks visibly.

### Console sign-in: `auth/unauthorized-domain`

`app.admin.your-domain.com` is not in Firebase → Authentication → Settings →
Authorized domains.

### Signed in, but "no console access"

No `StaffMember` row. See [7.1](#71-create-the-owner-account). Access is a staff
row, never `User.role` — the two are deliberately separate.

### The backend will not start, complaining about a route

`routeAudit` refused to boot because a route carries no guard. This is by
design: it turns a forgotten access check into a process that will not start,
rather than an endpoint that quietly works for everyone. Add the guard, or an
explicit `PUBLIC` entry with a reason.

### `backend` unhealthy but the site works

The readiness probe cannot reach Postgres. Compose does not restart containers
on healthcheck failure, so this reports and waits.

```sh
dc logs backend | grep readiness
dc ps db
```

### Orders stuck in `PendingPayment`

The webhook is not arriving. Check the URL (`payement`, not `payment`), the
secret, and Razorpay Dashboard → Webhooks for delivery failures.

### Everything is rate limited

`TRUST_PROXY` does not match your proxy count, so every visitor shares one
bucket. It must be **exact**:

| Setup | Value |
|---|---|
| base compose only (nginx → backend) | `1` |
| this overlay (caddy → nginx → backend) | `2` — set for you |
| plus Cloudflare or a cloud load balancer | `3` |

Too low attributes every request to the proxy; too high lets a client forge the
address the limiter keys on. Neither produces an error. If you put anything else
in front of Caddy, raise it in `docker-compose.prod.yml`.

### Store name / policy pages show `[placeholders]`

The `VITE_*` identity values are unset, or were set without rebuilding:
`dc up -d --build web`.

---

## 13. Full variable reference

**Required** (compose refuses to start):

| Variable | Where it comes from |
|---|---|
| `POSTGRES_PASSWORD` | you choose |
| `DATABASE_URL` | built from the above |
| `SITE_DOMAIN` | your domain, apex, no scheme |
| `ACME_EMAIL` | your email |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` | Razorpay → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks |
| `FIREBASE_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | service account JSON |
| `VITE_FIREBASE_KEY` / `_DOMAIN` / `_PROJECT_ID` / `_APPID` | Firebase web app config |
| `VITE_SERVER` | `https://your-domain.com` |

**Recommended:** `ADMIN_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `STORE_NAME`,
`VITE_STORE_NAME`, `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_PHONE`,
`VITE_STORE_ADDRESS`, `VITE_SITE_URL`.

**Optional with sensible defaults:** `POSTGRES_USER` (`ecommerce`),
`POSTGRES_DB` (`ecommerce`), `TAX_RATE` (`0.18`), `SHIPPING_FEE` (`200`),
`FREE_SHIPPING_THRESHOLD` (`1000`), `SHIPPING_ZONES` (none),
`RETURN_WINDOW_DAYS` (`7`), `LOW_STOCK_THRESHOLD` (`5`), `COD_ENABLED`
(`false`), `COD_MAX_ORDER_VALUE` (`20000`), `COD_FEE` (`0`),
`ADMIN_SIGN_IN_PROVIDERS` (`google.com`), `ADMIN_SESSION_MAX_AGE_HOURS` (`12`),
`ADMIN_REQUIRE_MFA` (`false`), `BACKUP_INTERVAL_SECONDS` (`86400`),
`BACKUP_RETENTION_DAYS` (`14`), `BACKUP_DIR` (`./backups`),
`MAIL_UNSUBSCRIBE_SECRET` (falls back to the Razorpay secret),
`VITE_SOCIAL_*` (icons omitted), `CLOUD_*` (Cloudinary; unused by the current
product flow, which writes to local disk).

**Leave empty in this deployment:** `CLIENT_URL`, `VITE_ADMIN_SERVER` — both
SPAs are same-origin with the API behind this nginx.

`.env.example` carries a comment on every one of these explaining what it does
and why it defaults the way it does. Read it there rather than guessing.

---

## Before you call it launched

- [ ] **A lawyer has read the policy pages.** They are complete templates with
      visible `[bracketed]` placeholders for what the code cannot know — the
      registered entity, the postal address, the governing jurisdiction. They
      are brackets rather than plausible inventions because a returns policy
      stating a made-up address means parcels posted somewhere that does not
      exist.
- [ ] A real payment has been taken and refunded end to end
- [ ] Backups are being copied off the server, and a restore has been tested
- [ ] `ADMIN_REQUIRE_MFA=true`, after operators have enrolled
- [ ] You know where the logs are and have read them once while things worked
