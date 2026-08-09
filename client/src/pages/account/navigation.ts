import { IconType } from "react-icons";
import {
  FiHeart,
  FiMapPin,
  FiPackage,
  FiRotateCcw,
  FiSettings,
  FiStar,
  FiUser,
} from "react-icons/fi";

/**
 * One list drives the account sidebar and nothing else declares a section.
 *
 * The paths are the ones the app already links to from the header, the footer,
 * the checkout success page and the order table — `/orders`, `/wishlist`,
 * `/profile`. They stay where they are and gain a shared shell around them
 * rather than moving under an `/account` prefix, because every one of those
 * links is a URL a customer may have bookmarked, and a redirect chain is a
 * worse answer than not moving.
 *
 * The console has the same arrangement for the same reason (src/admin/
 * navigation.ts) — a section cannot be visible in the nav but missing from the
 * router, because there is only one place that says a section exists.
 */
export type AccountSection = {
  to: string;
  label: string;
  Icon: IconType;
  /** Rendered on the overview's shortcut cards. */
  blurb: string;
  /** Match child routes too — `/orders/:id` keeps "Orders" highlighted. */
  matchNested?: boolean;
};

export const ACCOUNT_NAV: AccountSection[] = [
  {
    to: "/profile",
    label: "Overview",
    Icon: FiUser,
    blurb: "Your account at a glance",
  },
  {
    to: "/orders",
    label: "Orders",
    Icon: FiPackage,
    blurb: "Track, reorder and download invoices",
    matchNested: true,
  },
  {
    to: "/returns",
    label: "Returns",
    Icon: FiRotateCcw,
    blurb: "Items you have sent back, and their refunds",
  },
  {
    to: "/wishlist",
    label: "Wishlist",
    Icon: FiHeart,
    blurb: "Items you saved for later",
  },
  {
    to: "/addresses",
    label: "Addresses",
    Icon: FiMapPin,
    blurb: "Where your orders are delivered",
  },
  {
    to: "/reviews",
    label: "Reviews",
    Icon: FiStar,
    blurb: "Everything you have rated",
  },
  {
    to: "/settings",
    label: "Settings",
    Icon: FiSettings,
    blurb: "Profile, sign-in methods and account closure",
  },
];

/** Whether `pathname` is inside `section`. */
export const isActiveSection = (section: AccountSection, pathname: string) =>
  section.matchNested
    ? pathname === section.to || pathname.startsWith(`${section.to}/`)
    : pathname === section.to;
