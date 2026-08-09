import { Order, Product, ReturnRequest, User } from "../types/types";
import { Permission } from "./permissions";

/** One bucket of the trend series. `bucket` is an ISO timestamp. */
export type SeriesPoint = {
  bucket: string;
  revenue: number;
  orders: number;
};

/** A measure with the same measure over the preceding window of equal length. */
export type Kpi = {
  value: number;
  previous: number;
  /** percent change vs `previous`; 100 when there was no prior activity */
  change: number;
};

export type AnalyticsRange = "7d" | "30d" | "90d" | "12m";

export type Analytics = {
  range: AnalyticsRange;
  granularity: "day" | "month";
  window: { start: string; end: string };
  kpis: {
    revenue: Kpi;
    orders: Kpi;
    aov: Kpi;
    conversion: Kpi;
    customers: Kpi;
    units: Kpi;
  };
  series: SeriesPoint[];
  topProducts: {
    _id: string;
    name: string;
    photo: string;
    units: number;
    revenue: number;
  }[];
  topCategories: { category: string; units: number; revenue: number }[];
  fulfilment: {
    processing: number;
    shipped: number;
    delivered: number;
    cancelled: number;
  };
  checkouts: {
    started: number;
    paid: number;
    abandoned: number;
    abandonRate: number;
  };
  customers: {
    buyers: number;
    repeatBuyers: number;
    repeatRate: number;
    newInRange: number;
  };
  inventory: {
    products: number;
    units: number;
    /**
     * The threshold the server actually used, so the panel can label itself
     * with the real number rather than hardcoding "5" and being wrong on any
     * deploy that configured something else.
     */
    lowStockThreshold: number;
    /**
     * Totals behind the capped `lowStock` list below. Without them the panel
     * can only ever say "8 products are low", whether the true figure is 8 or
     * 800 — and the operator has no way to tell which.
     *
     * Out-of-stock is counted separately because it is a different job: low
     * stock is something to reorder, zero stock is a product the shop is
     * currently advertising and cannot sell.
     */
    lowStockCount: number;
    outOfStockCount: number;
    lowStock: {
      _id: string;
      name: string;
      photo: string;
      stock: number;
      price: number;
    }[];
  };
  recentOrders: {
    _id: string;
    customer: string;
    items: number;
    total: number;
    status: string;
    paymentStatus: string;
    createdAt: string;
  }[];
};

export type AnalyticsResponse = { success: boolean } & Analytics;

/** One line of the admin action trail (backend: AdminAuditLog). */
export type AuditEntry = {
  _id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetId: string | null;
  summary: string;
  ip: string | null;
  createdAt: string;
};

export type ActivityResponse = {
  success: boolean;
  total: number;
  entries: AuditEntry[];
};

/**
 * The customer list carries the two numbers the console acts on, so the page
 * does not fire a request per row to learn them.
 */
export type AdminUser = User & {
  orders: number;
  spent: number;
  /** Row creation time. Present on every user; the storefront just never reads it. */
  createdAt?: string;
};

export type AdminUsersResponse = { success: boolean; users: AdminUser[] };
export type AdminProductsResponse = { success: boolean; products: Product[] };
export type AdminProductResponse = { success: boolean; product: Product };
export type AdminOrdersResponse = { success: boolean; orders: Order[] };
export type AdminOrderResponse = { success: boolean; order: Order };
export type AdminMessageResponse = { success: boolean; message: string };

/**
 * The returns queue.
 *
 * `ReturnRequest` is shared with the storefront (src/types/types.ts) — the two
 * apps share types and utils and nothing else, and a return is the same object
 * on both sides. The console's list joins the customer and the order onto it,
 * which the customer's own view has no need for.
 */
export type AdminReturnsResponse = { success: boolean; returns: ReturnRequest[] };

// -------------------------------------------------------------- coupons ---

/**
 * A discount code and its conditions. Every limit is nullable and null means
 * "no limit", matching the column — an unconditional code is the default and a
 * campaign that needs a ceiling states it.
 */
export type AdminCoupon = {
  _id: string;
  id: string;
  code: string;
  amount: number;
  isActive: boolean;
  /** ISO timestamp, or null to never expire. */
  expiresAt: string | null;
  /** Cart subtotal before tax and shipping. */
  minOrderValue: number | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  createdAt: string;
  /**
   * Paid redemptions so far. Counted server-side from orders rather than
   * stored on the coupon, so it is a derived figure and read-only here.
   */
  redeemed: number;
};

export type AdminCouponsResponse = { success: boolean; coupons: AdminCoupon[] };

/**
 * The write shape. `null` clears a limit; omitting a key leaves it unchanged,
 * which is what lets the edit form send a partial update.
 */
export type CouponInput = {
  code?: string;
  amount?: number;
  isActive?: boolean;
  expiresAt?: string | null;
  minOrderValue?: number | null;
  maxRedemptions?: number | null;
  perUserLimit?: number | null;
};

// --------------------------------------------------------------- access ---

/** What GET /access/me answers: who you are, and what you may do. */
export type SessionPayload = {
  user: User;
  /** null for a signed-in customer who is not staff at all. */
  staff: {
    isRoot: boolean;
    status: "active" | "suspended";
    /** Server-computed and complete; the console never expands a role name. */
    permissions: Permission[];
    grantedAt: string;
  } | null;
};

/** One row of the staff list on the Access page. */
export type StaffRow = {
  _id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  photo?: string | null;
  isRoot: boolean;
  status: "active" | "suspended";
  permissions: Permission[];
  note: string | null;
  grantedAt: string;
  grantedById: string | null;
  /** Name of whoever granted it; null for rows the migration backfilled. */
  grantedBy: string | null;
  /** Last audited action by this operator — "granted but never used" is a row worth finding. */
  lastActiveAt: string | null;
};

/** An account that could be granted access; comes from the candidate search. */
export type Candidate = Pick<StaffRow, "_id" | "name" | "email" | "phone" | "photo">;

export type PermissionMeta = {
  permission: Permission;
  group: string;
  label: string;
  description: string;
};

export type AccessPreset = {
  name: string;
  label: string;
  description: string;
  permissions: Permission[];
};

export type AccessCatalogResponse = {
  success: boolean;
  permissions: PermissionMeta[];
  /** Everything root may hand out — excludes access_manage. */
  grantable: Permission[];
  presets: AccessPreset[];
};

export type StaffListResponse = { success: boolean; staff: StaffRow[] };
export type CandidatesResponse = { success: boolean; users: Candidate[] };
