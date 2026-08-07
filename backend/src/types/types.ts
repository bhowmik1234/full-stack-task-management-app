import { NextFunction, Response, Request } from "express";

export interface newUserRequestBody {
  name: string;
  email: string;
  gender: string;
  _id: string;
  photo: string;
  dob: Date;
}

export interface newProductRequestBody {
  name: string;
  category: string;
  price: number;
  stock: number;
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
  productId?: string | string[];
};

export type OrderItemType = {
  name: string;
  photo: string;
  price: number;
  quantity: number;
  productId: string;
};

export type ShippingInfoType = {
  address: string;
  city: string;
  state: string;
  country: string;
  // string, not number: a numeric pinCode silently drops leading zeros
  pinCode: string;
};

export interface NewOrderRequestBody {
  shippingInfo: ShippingInfoType;
  user: string;
  orderItems: OrderItemType[];
  couponCode?: string;
}