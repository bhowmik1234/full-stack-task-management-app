import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { storeName, siteUrl } from "../utils/store";

/**
 * Per-page title, description and social tags.
 *
 * `index.html` carries one static `<title>` and one `<meta description>`, which
 * is all a server-rendered site would need per page and all a client-rendered
 * one gets for *every* page. The practical effect was that a product page, the
 * cart and the returns policy all shared the description "shop fashion, tech and
 * beauty" — and every link anyone pasted into a chat or a social post previewed
 * as the home page.
 *
 * This is deliberately not `react-helmet`: the whole job is four `document`
 * writes and a cleanup, and the storefront's critical path is measured in
 * kilobytes (see CLAUDE.md). A dependency here would cost more than the feature.
 *
 * It does not make the SPA crawlable on its own — a crawler that does not run
 * JavaScript still sees the empty shell. It makes the pages correct for the
 * crawlers that do (Google among them), and correct for every link preview,
 * which is the part users actually see.
 */

type SeoProps = {
  title: string;
  description?: string;
  /** Absolute or root-relative image for the link preview. */
  image?: string;
  /** "product" on a product page, "website" elsewhere. */
  type?: "website" | "product" | "article";
  /**
   * Keeps a page out of search results without hiding it from people. Used on
   * the account and checkout pages, which are per-customer and would only ever
   * be a sign-in redirect to anyone arriving from a search result.
   */
  noIndex?: boolean;
};

/** Creates the tag on first use and reuses it after, so pages don't stack up. */
const setMeta = (selector: string, attrs: Record<string, string>) => {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement("meta");
    document.head.appendChild(tag);
  }
  for (const [key, value] of Object.entries(attrs)) tag.setAttribute(key, value);
};

const setLink = (rel: string, href: string) => {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
};

const Seo = ({ title, description, image, type = "website", noIndex }: SeoProps) => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const site = storeName();
    // The store's name is appended rather than baked into every call site, so
    // one page cannot end up as "Cart" while its neighbour is "Cart — ebag".
    const fullTitle = title.includes(site) ? title : `${title} — ${site}`;
    document.title = fullTitle;

    const base = siteUrl();
    // Query strings are dropped from the canonical URL: /search?q=shoes and
    // /search?q=boots are the same page with different contents, and letting
    // each mint its own canonical is how a catalogue fills an index with
    // near-duplicates of itself.
    const canonical = base ? `${base}${pathname}` : "";
    const absoluteImage = image && base && image.startsWith("/") ? `${base}${image}` : image;

    if (description) setMeta('meta[name="description"]', { name: "description", content: description });

    setMeta('meta[property="og:title"]', { property: "og:title", content: fullTitle });
    setMeta('meta[property="og:type"]', { property: "og:type", content: type });
    setMeta('meta[property="og:site_name"]', { property: "og:site_name", content: site });
    if (description)
      setMeta('meta[property="og:description"]', { property: "og:description", content: description });
    if (canonical) setMeta('meta[property="og:url"]', { property: "og:url", content: canonical });
    if (absoluteImage)
      setMeta('meta[property="og:image"]', { property: "og:image", content: absoluteImage });

    // Twitter reads the og:* tags for everything except the card type, so this
    // is the only one that has to be stated twice.
    setMeta('meta[name="twitter:card"]', {
      name: "twitter:card",
      content: absoluteImage ? "summary_large_image" : "summary",
    });

    setMeta('meta[name="robots"]', {
      name: "robots",
      content: noIndex ? "noindex,nofollow" : "index,follow",
    });

    if (canonical) setLink("canonical", canonical);
  }, [title, description, image, type, noIndex, pathname, search]);

  return null;
};

export default Seo;
