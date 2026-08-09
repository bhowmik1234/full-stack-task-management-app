import type { Request, Response } from "express";
import { prisma } from "./db.js";

/**
 * `sitemap.xml` and `robots.txt`.
 *
 * They live on the API rather than as files in the client bundle because a
 * sitemap has to list the catalogue, and the catalogue is a table. A static file
 * in `client/public` would be a snapshot that is wrong the moment a product is
 * added — which for a store is roughly daily — and nobody notices a stale
 * sitemap, they only notice that new products never appear in search results.
 *
 * Served from the *storefront's* origin: nginx proxies both paths to the
 * backend, so the URLs a crawler fetches are on the domain whose pages they
 * describe. A sitemap served from a different host is ignored by every crawler
 * that reads it, which is the failure this arrangement exists to avoid.
 */

/** Canonical storefront origin — the first CLIENT_URL, as the mailer uses. */
const siteUrl = () =>
  (process.env.CLIENT_URL || "").split(",")[0].trim().replace(/\/$/, "");

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const url = (loc: string, lastmod?: Date, changefreq = "weekly", priority = "0.6") =>
  `  <url>
    <loc>${esc(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

/**
 * Products are capped rather than paginated into a sitemap index. A single
 * sitemap may hold 50,000 URLs, which is far past the size this store will
 * reach; going beyond it needs an index file, and building one now would be
 * machinery with nothing to index.
 */
const MAX_PRODUCTS = 5000;

export const serveSitemap = async (_req: Request, res: Response) => {
  const base = siteUrl();

  // Without a configured origin there are no absolute URLs to emit, and a
  // sitemap of relative paths is invalid. Answering 404 says so plainly instead
  // of serving a document every crawler will reject.
  if (!base) {
    res.status(404).type("text/plain").send("sitemap unavailable: CLIENT_URL is not set");
    return;
  }

  try {
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        select: { id: true, updatedAt: true },
        orderBy: { createdAt: "desc" },
        take: MAX_PRODUCTS,
      }),
      prisma.product.findMany({
        select: { category: true },
        distinct: ["category"],
      }),
    ]);

    const entries = [
      url(`${base}/`, undefined, "daily", "1.0"),
      url(`${base}/search`, undefined, "daily", "0.8"),
      // The policy pages: rarely changed, but they are what a crawler (and a
      // payment provider's review) looks for to decide the store is real.
      // These match the routes in client/src/App.tsx exactly. The two "-policy"
      // suffixes are not decoration: /shipping is the checkout address step and
      // /returns is the customer's list of their own returns, so the policy
      // pages cannot have the bare names.
      ...["about", "contact", "shipping-policy", "returns-policy", "privacy", "terms"].map((slug) =>
        url(`${base}/${slug}`, undefined, "yearly", "0.3")
      ),
      ...categories.map((c) =>
        url(`${base}/search?category=${encodeURIComponent(c.category)}`, undefined, "weekly", "0.5")
      ),
      ...products.map((p) => url(`${base}/product/${p.id}`, p.updatedAt, "weekly", "0.7")),
    ];

    res
      .status(200)
      .type("application/xml")
      // A crawler re-fetching this every few minutes would run two catalogue
      // queries each time for a document that changes when the catalogue does.
      .set("Cache-Control", "public, max-age=3600")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join(
          "\n"
        )}\n</urlset>`
      );
  } catch (error) {
    console.error("[sitemap] could not build sitemap", error);
    res.status(500).type("text/plain").send("sitemap unavailable");
  }
};

/**
 * `robots.txt`.
 *
 * The account and checkout paths are disallowed because they are per-customer
 * and require a session — a crawler following them gets a sign-in redirect and
 * spends its budget on pages that will never be results. `/admin` is listed for
 * the same reason and not as a security measure: the console lives on its own
 * hostname and is not reachable from this origin at all.
 */
export const serveRobots = (_req: Request, res: Response) => {
  const base = siteUrl();

  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /cart",
    "Disallow: /shipping",
    "Disallow: /pay/",
    "Disallow: /profile",
    "Disallow: /orders",
    "Disallow: /wishlist",
    "Disallow: /addresses",
    "Disallow: /reviews",
    "Disallow: /settings",
    "Disallow: /login",
    "Disallow: /admin",
    ...(base ? ["", `Sitemap: ${base}/sitemap.xml`] : []),
  ];

  res
    .status(200)
    .type("text/plain")
    .set("Cache-Control", "public, max-age=86400")
    .send(lines.join("\n") + "\n");
};
