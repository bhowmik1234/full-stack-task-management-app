import express from "express";
import { connectdb, prisma } from "./utils/db.js";
import { errorMiddleware } from "./middlewares/error.js";
import NodeCache from "node-cache";
import { config } from "dotenv";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import { v2 as cloudinary } from "cloudinary";
import { globalLimiter } from "./middlewares/rateLimit.js";
import { startOrderExpirySweep } from "./utils/expireOrders.js";
import { startNotificationSweep } from "./utils/notifications.js";
import { auditRouteGuards, type Mount } from "./utils/routeAudit.js";
// routes
import userRoute from "./routes/user.js";
import productRoute from "./routes/product.js"
import orderRoute from "./routes/order.js"
import payementRoute from "./routes/payement.js"
import dashboardRoute from "./routes/stats.js"
import accessRoute from "./routes/access.js"
import addressRoute from "./routes/address.js"
import returnsRoute from "./routes/returns.js"
import configRoute from "./routes/config.js"
import { serveRobots, serveSitemap } from "./utils/sitemap.js";

const app = express();

config({
    path: "./.env",
})
// read after config() so a PORT in .env is picked up; in Docker the real env wins
const PORT = Number(process.env.PORT) || 3000;
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME ,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET,
});


/**
 * The read cache fronting most endpoints.
 *
 * `new NodeCache()` defaults to `stdTTL: 0` — entries never expire — and every
 * key was only ever removed by an explicit `invalidateCache`. That is correct
 * for `latest-products` and `categories`, which are a fixed handful of keys.
 * It is a slow leak for the per-user and per-row ones: `my-orders-${userId}`,
 * `wishlist-${userId}`, `order-${id}`, `product-${id}`, `related-${id}`. A
 * customer who browses once leaves entries behind that nothing ever deletes,
 * because invalidation is keyed on writes that will never come for a user who
 * has gone. Given time the process grows until it is paging, and the symptom is
 * "the site got slow", nowhere near the cause.
 *
 * The TTL is a bound, not a correctness mechanism — writes still invalidate
 * immediately, and an expired entry costs one query to rebuild. It is set long
 * enough that hot keys effectively never expire under real traffic.
 *
 * `maxKeys` is deliberately *not* set, unlike `suggestCache`: `set` throws when
 * a capped cache is full, and callers here write to it inline in a request path
 * that would then 500. The key space is bounded by real users and real rows
 * rather than by attacker-supplied search terms, so a TTL is the right bound —
 * see utils/suggestCache.ts for the case that genuinely needs a cap.
 *
 * `useClones: false` skips a structured clone on every get and set. Values here
 * are JSON *strings* which are immutable, so there is nothing to defend against
 * by copying — it was pure cost.
 */
export const myCache = new NodeCache({
  stdTTL: 3600,
  checkperiod: 600,
  useClones: false,
});
connectdb();

// Reclaims stock from checkouts that were started but never paid for. See
// utils/expireOrders.ts — checkout reserves stock up front, so something has
// to give it back when the customer walks away.
startOrderExpirySweep();

// Back-in-stock alerts, review requests and abandoned-checkout nudges. Also a
// sweep rather than hooks on each event: stock rises in three different places
// and "has stock and somebody is waiting" is a query, not an event. See
// utils/notifications.ts.
startNotificationSweep();

/**
 * How many proxies sit in front of this process.
 *
 * req.ip has to come from X-Forwarded-For or every client shares a single
 * rate-limit bucket — and `globalLimiter` is app-wide, so that means one visitor
 * can lock out everyone. But the count must be *exact*, not generous: each hop
 * trusted is one more entry of X-Forwarded-For taken on faith, and trusting one
 * too many lets the client forge the value the limiter keys on. Trusting one too
 * few attributes every request to the proxy. Both failures are silent.
 *
 * The count is the deployment's, not the code's, which is why it is an env var:
 *   1  the bundled compose stack           (nginx -> backend)
 *   2  with TLS terminated in front of it  (caddy -> nginx -> backend)
 * A managed load balancer or Cloudflare in front of Caddy makes it 3. Each
 * layer appends to the header, so this is simply how many appended it.
 *
 * See docker-compose.prod.yml, which sets it to 2 alongside the Caddy service.
 */
const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? 1);
app.set("trust proxy", Number.isFinite(TRUST_PROXY) ? TRUST_PROXY : 1);

app.use(
  helmet({
    // The API serves JSON and uploaded images, never HTML, so the strictest
    // policy applies. The SPA gets its own headers from nginx.
    contentSecurityPolicy: {
      directives: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }, // <img> from the SPA origin
    referrerPolicy: { policy: "no-referrer" },
  })
);

// CLIENT_URL may hold a comma-separated list. In production an unset value is
// a misconfiguration, not a reason to accept every origin: behind nginx the
// SPA is same-origin anyway, so denying cross-origin is the safe default.
//
// ADMIN_URL is the console's own origin (app.admin.<domain>). It is listed here
// as well as being pinned in middlewares/auth.ts, and the two do different
// jobs: CORS decides whose script may *read* a response, while the pin decides
// which origin may reach an admin route at all. Behind the bundled nginx the
// console is same-origin with the API, so this only matters when the two are
// split across hosts.
const allowedOrigins = [process.env.CLIENT_URL, process.env.ADMIN_URL]
  .filter(Boolean)
  .join(",")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV === "production"
        ? false
        : true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    maxAge: 600,
  })
);

app.use(globalLimiter);

// The Razorpay webhook is authenticated by an HMAC over the exact bytes it
// sent, so it must see the raw buffer. This has to come *before* express.json()
// — once the body is parsed, re-serializing it changes key order and
// whitespace and the signature no longer matches.
app.use(
  "/api/v1/payement/webhook",
  express.raw({ type: "application/json", limit: "100kb" })
);

// bounded so a single request can't buffer an arbitrarily large body
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
// `dev` is a development format: ANSI colour codes, no timestamp, no response
// size, no referrer. Aggregated production logs are read long after the fact
// and usually through something that does not render colour, so the escape
// sequences become noise around a line that cannot say *when* it happened.
// `combined` is the Apache format every log tool already parses.
//
// Health probes are skipped rather than logged. Compose polls readiness every
// 30s forever; at that rate the probe is the majority of the log on a quiet
// store, and it buries the requests someone is actually looking for.
app.use(
  morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
    skip: (req) => req.path === "/health" || req.path === "/health/ready",
  })
);

/**
 * Health probes, split in two because they answer different questions and a
 * caller that conflates them makes the wrong decision.
 *
 * `/health` is liveness: the process is up and the event loop is turning. It
 * touches nothing external, so it stays true during a database outage — which
 * is the point. An orchestrator that restarts on this signal must not be told
 * "unhealthy" because Postgres is briefly away; killing the API changes nothing
 * about the database and throws away every in-flight request as well.
 *
 * `/health/ready` is readiness: this instance can actually serve a request,
 * which means the connection pool answers. `SELECT 1` is the cheapest statement
 * that proves the pool is live rather than merely configured — Prisma connects
 * lazily, so a process can listen happily with an unreachable database and only
 * fail on the first customer to load the catalogue.
 *
 * Both are outside /api/v1 deliberately: routeAudit walks that prefix and would
 * demand a guard, and a probe that needs a credential is a probe that reports a
 * misconfigured credential as a dead application. They disclose nothing beyond
 * up/not-up — no version, no dependency detail, no error text — because this is
 * reachable from anywhere the API is.
 */
app.get("/health", (_req, res) => {
  res.json({ success: true, status: "ok" });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, status: "ready" });
  } catch (error) {
    // Logged, not returned: the message can carry the connection string's host
    // and user. 503 rather than 500 — this is "not yet", and it is the status
    // load balancers understand as "take me out of rotation".
    console.error("[health] readiness check failed", error);
    res.status(503).json({ success: false, status: "not ready" });
  }
});

app.get("/", (_req, res) => {
  res.json({ success: true, message: "ebag API" });
});

// Crawler-facing documents. Deliberately outside /api/v1: nginx proxies these
// two paths from the storefront's own origin, so a crawler fetching
// example.com/sitemap.xml reaches them at the URL the sitemap's contents claim
// to describe. A sitemap served from a different host is ignored.
app.get("/sitemap.xml", serveSitemap);
app.get("/robots.txt", serveRobots);

// One list, used to mount *and* to audit. Keeping them together is what stops
// the audit from drifting away from reality — a router that is mounted is a
// router that is checked, by construction.
const API: Mount[] = [
  { path: "/api/v1/user", router: userRoute },
  { path: "/api/v1/product", router: productRoute },
  { path: "/api/v1/order", router: orderRoute },
  { path: "/api/v1/payement", router: payementRoute },
  { path: "/api/v1/dashboard", router: dashboardRoute },
  { path: "/api/v1/access", router: accessRoute },
  { path: "/api/v1/address", router: addressRoute },
  { path: "/api/v1/returns", router: returnsRoute },
  { path: "/api/v1/config", router: configRoute },
];

for (const { path, router } of API) app.use(path, router);

// Deny by default, enforced at boot: every route above must carry a guard from
// middlewares/auth.ts or be listed as deliberately public with a reason. An
// endpoint that forgets its guard is the likeliest way this app gets an
// access-control hole, and it is invisible in testing because it works. This
// turns it into a process that will not start.
auditRouteGuards(API);



// Defence in depth around user-supplied files: even though multer now names
// files from their validated mimetype and the bytes are checked, nothing here
// should ever be interpreted as a document by the browser.
app.use(
  "/uploads",
  express.static("uploads", {
    index: false,
    dotfiles: "deny",
    // An upload's filename is a UUID minted by multer and its bytes never
    // change — editing a product's photo writes a *new* file and repoints the
    // row. So the content at a given /uploads URL is immutable, and revalidating
    // it is a round trip per image per page to be told "unchanged". Without this
    // every card on every catalogue page cost a 304; `immutable` stops even
    // that, including on reload. Set here rather than in nginx so a deploy that
    // exposes the backend directly gets it too.
    maxAge: "1y",
    immutable: true,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Content-Disposition", "inline");
    },
  })
);
// An unmatched API path. Without this, Express's default handler answers with
// an **HTML** "Cannot GET /api/v1/…" page, and the client — which parses every
// API response as JSON — gets a PARSING_ERROR carrying a string body. Reading
// `.message` off that is the same TypeError the storefront pages were fixed
// for, arriving from the other direction. A typo'd endpoint should look like
// every other refusal this API issues.
//
// Scoped to /api/v1 so the static /uploads mount above and the crawler
// documents keep their own behaviour.
app.use("/api/v1", (req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// error middleware
app.use(errorMiddleware);

const server = app.listen(PORT, ()=>{
    console.log(`running on port ${PORT}.`);
})

/**
 * Shutdown and last-resort error handling.
 *
 * Neither existed, and the two are related: without them the process either
 * vanished mid-request or died with nothing but a default stack trace, and
 * compose's `restart: unless-stopped` brought it back — so both failures showed
 * up as unexplained restarts rather than as anything anyone could act on.
 */

// Node terminates on an unhandled rejection, so this is the difference between
// a restart with a logged cause and one without. It deliberately does not
// swallow it: a rejection nobody handled is a bug, and a process that carries
// on in an unknown state is worse than one that restarts clean. TryCatch covers
// the controllers and both sweeps catch their own, so reaching here means
// something genuinely unaccounted for.
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection", reason);
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaught exception", error);
  shutdown("uncaughtException", 1);
});

let shuttingDown = false;

/**
 * Stop taking new connections, let in-flight requests finish, then close the
 * database pool. `docker compose down`, a redeploy and a `kill` all arrive as
 * SIGTERM; with no handler the process was killed outright, dropping whatever
 * requests were open — including, in the worst case, one part-way through a
 * checkout transaction.
 */
const shutdown = (signal: string, code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — closing`);

  // Nothing left to wait for after this; if a connection refuses to drain we
  // still have to exit, so the timer below is the backstop.
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(code);
  });

  // Docker sends SIGKILL 10s after SIGTERM by default, so this has to fire
  // first to be worth anything.
  setTimeout(() => {
    console.error("[shutdown] did not close in time — forcing");
    process.exit(code || 1);
  }, 8000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));