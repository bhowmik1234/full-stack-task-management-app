import {
  FiActivity,
  FiBarChart2,
  FiBox,
  FiGrid,
  FiRotateCcw,
  FiShield,
  FiShoppingBag,
  FiTag,
  FiUsers,
} from "react-icons/fi";
import type { IconType } from "react-icons";
import type { Permission } from "./permissions";

export type NavItem = {
  to: string;
  label: string;
  Icon: IconType;
  end?: boolean;
  /** The permission this section needs. Root-only items use `root: true`. */
  permission?: Permission;
  root?: boolean;
};

/**
 * The console's sections, each carrying what it takes to see it.
 *
 * One list, used by the sidebar, by the router, and by `landingFor` — so a
 * section cannot end up visible in the nav but unreachable, or reachable but
 * invisible. Adding a page means adding a line here; forgetting the permission
 * is a type error, not a hole, because `NavItem` requires one of the two.
 */
export const NAV: NavItem[] = [
  { to: "/", label: "Overview", Icon: FiGrid, end: true, permission: "analytics_read" },
  { to: "/analytics", label: "Analytics", Icon: FiBarChart2, permission: "analytics_read" },
  { to: "/orders", label: "Orders", Icon: FiShoppingBag, permission: "orders_read" },
  // Reading the queue needs orders_read; every action on it needs orders_write,
  // which the page gates individually with `useCan`. An operator who can only
  // read gets a queue they can watch and a support answer they can give.
  { to: "/returns", label: "Returns", Icon: FiRotateCcw, permission: "orders_read" },
  { to: "/products", label: "Products", Icon: FiBox, permission: "products_read" },
  { to: "/customers", label: "Customers", Icon: FiUsers, permission: "customers_read" },
  { to: "/coupons", label: "Coupons", Icon: FiTag, permission: "coupons_read" },
  { to: "/activity", label: "Activity", Icon: FiActivity, permission: "activity_read" },
  { to: "/access", label: "Access", Icon: FiShield, root: true },
];

export const visibleNav = (permissions: Permission[], isRoot: boolean) =>
  NAV.filter((item) =>
    item.root ? isRoot : item.permission && permissions.includes(item.permission)
  );

/**
 * Where to send someone who has no business on the page they asked for.
 *
 * "/" is the overview, which needs `analytics_read` — an operator granted only
 * order access would land on a refusal every time they signed in. So the
 * landing page is the first section they can actually see, and null when there
 * is none at all.
 */
export const landingFor = (permissions: Permission[], isRoot = false) =>
  visibleNav(permissions, isRoot)[0]?.to ?? null;
