/**
 * The permission vocabulary, mirrored from the backend's Prisma enum.
 *
 * Hand-copied like the rest of `types/` — the two sides are kept in step by
 * review, not by codegen. The safe direction of drift is this one: a permission
 * the console does not know about simply never gates anything, while the server
 * still enforces it. The reverse — the console inventing a permission — is a
 * compile error the moment it is used against this union.
 *
 * What the console must never do is *decide* anything from this list. The
 * server sends the caller's effective permissions on every session load; these
 * names exist so a nav item can say which one it needs.
 */
export const PERMISSIONS = [
  "analytics_read",
  "orders_read",
  "orders_write",
  "products_read",
  "products_write",
  "customers_read",
  "customers_write",
  "coupons_read",
  "coupons_write",
  "activity_read",
  "access_manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Groups the catalog for the access editor, in the order it renders. */
export const PERMISSION_GROUPS = [
  "Insights",
  "Orders",
  "Catalogue",
  "Customers",
  "Coupons",
  "Console",
] as const;
