import { Permission, StaffMember } from "../generated/prisma/index.js";

/**
 * The permission catalog, and the only place that decides what a permission
 * means.
 *
 * `Permission` itself is a Prisma enum, so the set is closed at compile time
 * and at the database — a grant can never name a capability no route enforces.
 * What lives here is everything *around* the enum: the order operators see it
 * in, the prose describing each one, and the preset bundles.
 */

/** Every permission, in the order the console lists them. */
export const ALL_PERMISSIONS: Permission[] = [
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
];

/**
 * Never granted through the API, only held by root.
 *
 * Access management is the permission that can grant every other permission,
 * so making it assignable would mean any operator who held it could quietly
 * promote themselves to everything — the privilege-escalation hole this whole
 * model exists to close.
 */
export const ROOT_ONLY_PERMISSIONS: Permission[] = ["access_manage"];

/** Permissions the access API will accept in a grant. */
export const GRANTABLE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !ROOT_ONLY_PERMISSIONS.includes(p)
);

export type PermissionMeta = {
  permission: Permission;
  group: string;
  label: string;
  /** Rendered under the checkbox; says what the holder can actually do. */
  description: string;
};

export const PERMISSION_META: PermissionMeta[] = [
  {
    permission: "analytics_read",
    group: "Insights",
    label: "View analytics",
    description: "Revenue, orders and trends on the overview and analytics pages.",
  },
  {
    permission: "activity_read",
    group: "Insights",
    label: "View activity log",
    description: "Read the trail of every admin action, including other operators'.",
  },
  {
    permission: "orders_read",
    group: "Orders",
    label: "View orders",
    description: "Open any order and see its items, totals and shipping address.",
  },
  {
    permission: "orders_write",
    group: "Orders",
    label: "Manage orders",
    description: "Advance fulfilment and delete orders. Implies viewing them.",
  },
  {
    permission: "products_read",
    group: "Catalogue",
    label: "View catalogue",
    description: "See the full product list with stock levels.",
  },
  {
    permission: "products_write",
    group: "Catalogue",
    label: "Manage catalogue",
    description: "Create, edit and delete products. Implies viewing them.",
  },
  {
    permission: "customers_read",
    group: "Customers",
    label: "View customers",
    description: "See customer records, including email and date of birth.",
  },
  {
    permission: "customers_write",
    group: "Customers",
    label: "Manage customers",
    description: "Delete customer accounts. Implies viewing them.",
  },
  {
    permission: "coupons_read",
    group: "Coupons",
    label: "View coupons",
    description: "See discount codes and what they are worth.",
  },
  {
    permission: "coupons_write",
    group: "Coupons",
    label: "Manage coupons",
    description: "Create and delete discount codes. Implies viewing them.",
  },
  {
    permission: "access_manage",
    group: "Console",
    label: "Manage access",
    description: "Grant and revoke console access. Held by the owner account only.",
  },
];

/**
 * A write permission is useless without its read: an operator who can advance
 * an order but cannot open one has a console with nothing on it. Rather than
 * ask everyone to remember the pairing, the grant path expands it.
 */
const IMPLIES: Partial<Record<Permission, Permission[]>> = {
  orders_write: ["orders_read"],
  products_write: ["products_read"],
  customers_write: ["customers_read"],
  coupons_write: ["coupons_read"],
};

/** Adds the read half of every granted write permission, de-duplicated. */
export const expandPermissions = (permissions: Permission[]): Permission[] => {
  const set = new Set<Permission>(permissions);
  for (const permission of permissions)
    for (const implied of IMPLIES[permission] ?? []) set.add(implied);

  // Emit in catalog order so two equal grants compare equal as arrays.
  return ALL_PERMISSIONS.filter((p) => set.has(p));
};

export type PresetName = "manager" | "support" | "catalogue" | "analyst";

/**
 * Starting points, not roles.
 *
 * A preset only fills the checkboxes; what is stored is the resulting
 * permission list. That means changing a preset next year cannot silently
 * change what someone granted last year is allowed to do — which is the failure
 * mode of storing a role name and resolving it at request time.
 */
export const PRESETS: Record<
  PresetName,
  { label: string; description: string; permissions: Permission[] }
> = {
  manager: {
    label: "Manager",
    description: "Everything except managing other operators.",
    permissions: GRANTABLE_PERMISSIONS,
  },
  support: {
    label: "Support",
    description: "Handles orders and looks customers up. Cannot touch the catalogue.",
    permissions: expandPermissions(["orders_write", "customers_read"]),
  },
  catalogue: {
    label: "Catalogue",
    description: "Products and coupons. No customer data, no orders.",
    permissions: expandPermissions(["products_write", "coupons_write"]),
  },
  analyst: {
    label: "Analyst",
    description: "Read-only: numbers and the activity trail, nothing to click.",
    permissions: expandPermissions(["analytics_read", "activity_read", "orders_read"]),
  },
};

/** The subset of the staff row that authorization actually depends on. */
export type StaffAuthority = Pick<
  StaffMember,
  "userId" | "isRoot" | "permissions" | "status"
>;

/**
 * The single authorization predicate.
 *
 * Root is resolved here rather than by storing every permission on the root
 * row, so a permission added in a later migration is covered without a
 * backfill. A suspended row fails before either check — suspension has to beat
 * everything, including root, or it is not a suspension.
 */
export const staffCan = (
  staff: StaffAuthority | null | undefined,
  permission: Permission
): boolean => {
  if (!staff || staff.status !== "active") return false;
  if (staff.isRoot) return true;
  return staff.permissions.includes(permission);
};

/** What the console is told it may do. Root sees the whole catalog. */
export const effectivePermissions = (staff: StaffAuthority): Permission[] =>
  staff.isRoot ? [...ALL_PERMISSIONS] : expandPermissions(staff.permissions);
