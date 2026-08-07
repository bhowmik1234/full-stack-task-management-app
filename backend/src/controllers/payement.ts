import { stripe } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { calculateOrderAmounts } from "../utils/features.js";
import { serializeCoupon, serializeCoupons } from "../utils/serialize.js";

export const createPaymentIntent = TryCatch(async (req, res, next) => {
  const { cartItems, couponCode } = req.body;

  if (!Array.isArray(cartItems) || cartItems.length === 0)
    return next(new ErrorHandler("Please provide cart items", 400));

  let total;
  try {
    ({ total } = await calculateOrderAmounts(cartItems, couponCode));
  } catch (error) {
    return next(new ErrorHandler((error as Error).message, 400));
  }

  if (total <= 0) return next(new ErrorHandler("Invalid order amount", 400));

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: "inr",
  });

  return res.status(201).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
  });
});

export const newCoupon = TryCatch(async (req, res, next) => {
  const { code, amount } = req.body;

  if (!code || !amount)
    return next(new ErrorHandler("Please enter both coupon and amount", 400));

  if (Number(amount) < 0)
    return next(new ErrorHandler("Amount must not be negative", 400));

  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing)
    return next(new ErrorHandler("Coupon code already exists", 400));

  await prisma.coupon.create({ data: { code, amount: Number(amount) } });

  return res.status(201).json({
    success: true,
    message: `Coupon ${code} Created Successfully`,
  });
});

export const applyDiscount = TryCatch(async (req, res, next) => {
  const { coupon } = req.query;

  const discount = await prisma.coupon.findUnique({
    where: { code: String(coupon) },
  });

  if (!discount) return next(new ErrorHandler("Invalid Coupon Code", 400));

  return res.status(200).json({
    success: true,
    discount: Number(discount.amount),
  });
});

export const allCoupons = TryCatch(async (req, res, next) => {
  const coupons = await prisma.coupon.findMany();

  return res.status(200).json({
    success: true,
    coupons: serializeCoupons(coupons),
  });
});

export const getCoupon = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const coupon = await prisma.coupon.findUnique({ where: { id } });

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  return res.status(200).json({
    success: true,
    coupon: serializeCoupon(coupon),
  });
});

export const updateCoupon = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const { code, amount } = req.body;

  const coupon = await prisma.coupon.findUnique({ where: { id } });

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  if (amount != null && Number(amount) < 0)
    return next(new ErrorHandler("Amount must not be negative", 400));

  const updated = await prisma.coupon.update({
    where: { id },
    data: {
      ...(code ? { code } : {}),
      ...(amount ? { amount: Number(amount) } : {}),
    },
  });

  return res.status(200).json({
    success: true,
    message: `Coupon ${updated.code} Updated Successfully`,
  });
});

export const deleteCoupon = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const coupon = await prisma.coupon.findUnique({ where: { id } });

  if (!coupon) return next(new ErrorHandler("Invalid Coupon ID", 400));

  await prisma.coupon.delete({ where: { id } });

  return res.status(200).json({
    success: true,
    message: `Coupon ${coupon.code} Deleted Successfully`,
  });
});
