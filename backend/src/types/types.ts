import { NextFunction, Response, Request } from "express";
import type { StaffMember, User } from "../generated/prisma/index.js";
import type { AdminToken } from "../utils/firebaseAuth.js";

// The auth middlewares already load the caller's row, and the staff row with
// it in the same query; hanging both off the request saves controllers a second
// lookup and guarantees a controller's permission check sees exactly what the
// guard saw.
//
// `staff` is null for an ordinary customer and undefined on a route with no
// guard at all — the difference matters, so it is not collapsed to one.
declare global {
  namespace Express {
    interface Request {
      appUser?: User;
      staff?: StaffMember | null;
      // The verified ID token, on admin routes only. Absent under the dev
      // bypass, which has no Firebase session to produce one.
      adminToken?: AdminToken;
    }
  }
}

// Google sign-in sends email + photo; phone sign-in sends phone and neither of
// those. The controller requires exactly one of email/phone.
export interface newUserRequestBody {
  name: string;
  email?: string;
  phone?: string;
  gender: string;
  _id: string;
  photo?: string;
  dob: Date;
}

export interface newProductRequestBody {
  name: string;
  category: string;
  price: number;
  stock: number;
  description?: string;
  brand?: string;
  // newline-separated bullet lists
  highlights?: string;
  inTheBox?: string;
  warranty?: string;
  // JSON array of { group, label, value } — multipart bodies are flat strings
  specs?: string;
  // JSON array of { name, values } — the axes a product varies along
  options?: string;
  // JSON array of { sku, optionValues, price, stock }, aligned to `options`
  variants?: string;
}

export interface newReviewRequestBody {
  rating: number;
  title?: string;
  comment: string;
}

export interface searchRequestQuery {
  search?: string;
  price?: string;
  category?: string;
  sort?: string;
  page?: string;
}

export type ControllerTypes = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response<any, Record<string, any>>>;

// BaseQuery is gone — product search now builds a Prisma.ProductWhereInput
// directly in controllers/product.ts instead of a Mongo query object.

export type InvalidateCacheProps = {
  product?: boolean;
  order?: boolean;
  admin?: boolean;
  userId?: string;
  orderId?: string;
  wishlist?: boolean;
  review?: boolean;
  productId?: string | string[];
};

export type OrderItemType = {
  name: string;
  photo: string;
  price: number;
  quantity: number;
  productId: string;
  // null for a product with no variants — which is every product that predates
  // them, and every one that never grows options.
  variantId: string | null;
  // "Blue / M", snapshotted at purchase like name and price
  variantLabel: string;
};

export type ShippingInfoType = {
  address: string;
  city: string;
  state: string;
  country: string;
  // string, not number: a numeric pinCode silently drops leading zeros
  pinCode: string;
};

/**
 * Body of POST /order/checkout.
 *
 * Note what is *not* here: no subtotal/tax/total, and no `user`. Every amount
 * is re-derived from the database by calculateOrderAmounts, and the owner is
 * taken from the authenticated `?id=` rather than the body — the old shape
 * accepted a `user` field and had to check it matched, which is one more way
 * to get it wrong.
 */
export interface CheckoutRequestBody {
  shippingInfo: ShippingInfoType;
  // variantId is required for a product that has options and refused for one
  // that does not — resolveVariant decides, never the client.
  orderItems: { productId: string; quantity: number; variantId?: string }[];
  couponCode?: string;
  // Defaults to Razorpay when absent, so an older client keeps working.
  paymentMethod?: "Razorpay" | "COD";
}

export interface newProductVariantInput {
  sku?: string;
  optionValues: string[];
  price: number;
  stock: number;
}