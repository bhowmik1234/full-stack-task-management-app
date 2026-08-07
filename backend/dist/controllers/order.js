import { myCache } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import { calculateOrderAmounts, invalidateCache, reduceStock } from "../utils/features.js";
import { serializeOrder, serializeOrders } from "../utils/serialize.js";
import ErrorHandler from "../utils/utiliy-class.js";
// every read that gets serialized back to the client needs the items and the
// user's name, matching what .populate("user", "name") used to return
const orderInclude = {
    items: true,
    user: { select: { id: true, name: true } },
};
export const newOrder = TryCatch(async (req, res, next) => {
    const { id: requesterId } = req.query;
    const { shippingInfo, orderItems, user, couponCode } = req.body;
    if (!shippingInfo || !orderItems || !user)
        return next(new ErrorHandler("Please Enter All Fields", 400));
    // ?id= is the only proof of identity this app has; don't let one
    // logged-in user place an order attributed to someone else
    if (user !== requesterId)
        return next(new ErrorHandler("Not allowed to place order for another user", 401));
    let order;
    try {
        // Pricing, stock reservation and order creation all commit together or
        // not at all. This is what the Mongo version could not do: a crash
        // partway through used to leave stock debited with no order to show
        // for it, and no compensating logic could close that window.
        order = await prisma.$transaction(async (tx) => {
            // subtotal/tax/shippingCharges/discount/total/prices are re-derived
            // from the DB — never trust the client-supplied numbers for these
            const computed = await calculateOrderAmounts(orderItems, couponCode, tx);
            await reduceStock(tx, computed.orderItems);
            return tx.order.create({
                data: {
                    userId: user,
                    address: shippingInfo.address,
                    city: shippingInfo.city,
                    state: shippingInfo.state,
                    country: shippingInfo.country,
                    pinCode: String(shippingInfo.pinCode),
                    subtotal: computed.subtotal,
                    tax: computed.tax,
                    shippingCharges: computed.shippingCharges,
                    discount: computed.discount,
                    total: computed.total,
                    items: {
                        create: computed.orderItems.map((i) => ({
                            productId: i.productId,
                            name: i.name,
                            photo: i.photo,
                            price: i.price,
                            quantity: i.quantity,
                        })),
                    },
                },
                include: orderInclude,
            });
        });
    }
    catch (error) {
        const message = error.message;
        const status = message.startsWith("Insufficient stock") ? 409 : 400;
        return next(new ErrorHandler(message, status));
    }
    invalidateCache({
        product: true,
        order: true,
        admin: true,
        userId: user,
        productId: order.items.map((i) => i.productId),
    });
    return res.status(201).json({
        success: true,
        message: "Order Placed Successfully",
    });
});
export const myOrders = TryCatch(async (req, res, next) => {
    const { id: user } = req.query;
    const key = `my-orders-${user}`;
    let orders = [];
    if (myCache.has(key))
        orders = JSON.parse(myCache.get(key));
    else {
        const rows = await prisma.order.findMany({
            where: { userId: String(user) },
            include: orderInclude,
            orderBy: { createdAt: "desc" },
        });
        orders = serializeOrders(rows);
        myCache.set(key, JSON.stringify(orders));
    }
    return res.status(200).json({
        success: true,
        orders,
    });
});
export const allOrders = TryCatch(async (req, res, next) => {
    const key = `all-orders`;
    let orders = [];
    if (myCache.has(key))
        orders = JSON.parse(myCache.get(key));
    else {
        const rows = await prisma.order.findMany({
            include: orderInclude,
            orderBy: { createdAt: "desc" },
        });
        orders = serializeOrders(rows);
        myCache.set(key, JSON.stringify(orders));
    }
    return res.status(200).json({
        success: true,
        orders,
    });
});
export const getSingleOrder = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const { id: requesterId } = req.query;
    const key = `order-${id}`;
    let order;
    if (myCache.has(key))
        order = JSON.parse(myCache.get(key));
    else {
        const row = await prisma.order.findUnique({
            where: { id },
            include: orderInclude,
        });
        if (!row)
            return next(new ErrorHandler("Order Not Found", 404));
        order = serializeOrder(row);
        myCache.set(key, JSON.stringify(order));
    }
    // only the order's own user, or an admin, may view it
    const orderUserId = order.user?._id ?? order.user;
    if (String(orderUserId) !== String(requesterId)) {
        const requester = await prisma.user.findUnique({
            where: { id: String(requesterId) },
        });
        if (!requester || requester.role !== "admin")
            return next(new ErrorHandler("Not allowed to view this order", 401));
    }
    return res.status(200).json({
        success: true,
        order,
    });
});
export const processOrder = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order)
        return next(new ErrorHandler("Order Not Found", 404));
    const nextStatus = order.status === "Processing"
        ? "Shipped"
        : order.status === "Shipped"
            ? "Delivered"
            : "Delivered";
    await prisma.order.update({ where: { id }, data: { status: nextStatus } });
    invalidateCache({
        product: false,
        order: true,
        admin: true,
        userId: order.userId,
        orderId: String(order.id),
    });
    return res.status(200).json({
        success: true,
        message: "Order Processed Successfully",
    });
});
export const deleteOrder = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order)
        return next(new ErrorHandler("Order Not Found", 404));
    // OrderItem rows go with it via onDelete: Cascade
    await prisma.order.delete({ where: { id } });
    invalidateCache({
        product: false,
        order: true,
        admin: true,
        userId: order.userId,
        orderId: String(order.id),
    });
    return res.status(200).json({
        success: true,
        message: "Order Deleted Successfully",
    });
});
