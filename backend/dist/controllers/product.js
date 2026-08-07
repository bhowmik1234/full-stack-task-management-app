import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { rm } from "fs";
import { myCache } from "../app.js";
import { invalidateCache } from "../utils/features.js";
import { serializeProduct, serializeProducts } from "../utils/serialize.js";
export const newProduct = TryCatch(async (req, res, next) => {
    const { name, category, price, stock } = req.body;
    const photo = req.file;
    if (!photo)
        return next(new ErrorHandler("Please add photo", 400));
    if (!name || !category || !price || !stock) {
        rm(photo.path, () => {
            console.log("photo deleted.");
        });
        return next(new ErrorHandler("please enter all details", 400));
    }
    if (Number(price) < 0 || Number(stock) < 0) {
        rm(photo.path, () => {
            console.log("photo deleted.");
        });
        return next(new ErrorHandler("Price and stock must not be negative", 400));
    }
    await prisma.product.create({
        data: {
            name,
            category: category.toLocaleLowerCase(),
            price: Number(price),
            stock: Number(stock),
            photo: photo.path,
        },
    });
    invalidateCache({ product: true, admin: true });
    return res.status(201).json({
        success: true,
        message: "Product created successfully.",
    });
});
export const getlatestProducts = TryCatch(async (req, res, next) => {
    let products;
    if (myCache.has("latest-products")) {
        products = JSON.parse(myCache.get("latest-products"));
    }
    else {
        const rows = await prisma.product.findMany({
            orderBy: { createdAt: "desc" },
            take: 5,
        });
        products = serializeProducts(rows);
        myCache.set("latest-products", JSON.stringify(products));
    }
    return res.status(200).json({
        success: true,
        products,
    });
});
export const getAllCategories = TryCatch(async (req, res, next) => {
    let categories;
    if (myCache.has("categories"))
        categories = JSON.parse(myCache.get("categories"));
    else {
        const rows = await prisma.product.findMany({
            distinct: ["category"],
            select: { category: true },
            orderBy: { category: "asc" },
        });
        categories = rows.map((r) => r.category);
        myCache.set("categories", JSON.stringify(categories));
    }
    return res.status(200).json({
        success: true,
        categories,
    });
});
export const getAdminProducts = TryCatch(async (req, res, next) => {
    let products;
    if (myCache.has("all-products"))
        products = JSON.parse(myCache.get("all-products"));
    else {
        const rows = await prisma.product.findMany();
        products = serializeProducts(rows);
        myCache.set("all-products", JSON.stringify(products));
    }
    return res.status(200).json({
        success: true,
        products,
    });
});
export const getSingleProduct = TryCatch(async (req, res, next) => {
    let product;
    const id = String(req.params.id);
    if (myCache.has(`product-${id}`))
        product = JSON.parse(myCache.get(`product-${id}`));
    else {
        const row = await prisma.product.findUnique({ where: { id } });
        if (!row)
            return next(new ErrorHandler("Product Not Found", 404));
        product = serializeProduct(row);
        myCache.set(`product-${id}`, JSON.stringify(product));
    }
    return res.status(200).json({
        success: true,
        product,
    });
});
export const updateProduct = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const { name, price, stock, category } = req.body;
    const photo = req.file;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product)
        return next(new ErrorHandler("Product Not Found", 404));
    if (price != null && Number(price) < 0)
        return next(new ErrorHandler("Price must not be negative", 400));
    if (stock != null && Number(stock) < 0)
        return next(new ErrorHandler("Stock must not be negative", 400));
    const data = {};
    if (photo) {
        rm(product.photo, () => {
            console.log("Old Photo Deleted");
        });
        data.photo = photo.path;
    }
    if (name)
        data.name = name;
    if (price)
        data.price = Number(price);
    if (stock)
        data.stock = Number(stock);
    if (category)
        data.category = category.toLocaleLowerCase();
    await prisma.product.update({ where: { id }, data });
    invalidateCache({
        product: true,
        productId: product.id,
        admin: true,
    });
    return res.status(200).json({
        success: true,
        message: "Product Updated Successfully",
    });
});
export const deleteProduct = TryCatch(async (req, res, next) => {
    const product = await prisma.product.findUnique({
        where: { id: String(req.params.id) },
    });
    if (!product)
        return next(new ErrorHandler("Product Not Found", 404));
    // OrderItem holds an FK with onDelete: Restrict so order history can't be
    // orphaned. Under Mongo this deleted the product and left past orders
    // pointing at nothing.
    const ordered = await prisma.orderItem.count({
        where: { productId: product.id },
    });
    if (ordered > 0)
        return next(new ErrorHandler("Cannot delete a product that appears in existing orders", 400));
    rm(product.photo, () => {
        console.log("Product Photo Deleted");
    });
    await prisma.product.delete({ where: { id: product.id } });
    invalidateCache({
        product: true,
        productId: product.id,
        admin: true,
    });
    return res.status(200).json({
        success: true,
        message: "Product Deleted Successfully",
    });
});
export const getAllProducts = TryCatch(async (req, res, next) => {
    const { search, sort, category, price } = req.query;
    const page = Number(req.query.page) || 1;
    const limit = Number(process.env.PRODUCT_PER_PAGE) || 8;
    const skip = (page - 1) * limit;
    const where = {};
    // mode: "insensitive" is the Postgres equivalent of $options: "i"
    if (search)
        where.name = { contains: search, mode: "insensitive" };
    if (price)
        where.price = { lte: Number(price) };
    if (category)
        where.category = category;
    const [rows, filteredCount] = await Promise.all([
        prisma.product.findMany({
            where,
            orderBy: sort ? { price: sort === "asc" ? "asc" : "desc" } : undefined,
            take: limit,
            skip,
        }),
        // COUNT in the database instead of fetching every matching row to
        // measure the length of the result
        prisma.product.count({ where }),
    ]);
    const totalPage = Math.ceil(filteredCount / limit);
    return res.status(200).json({
        success: true,
        products: serializeProducts(rows),
        totalPage,
    });
});
export const addToWishList = TryCatch(async (req, res, next) => {
    const { id: userId } = req.query;
    const productId = String(req.params.id);
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product)
        return next(new ErrorHandler("Product Not Found", 404));
    // One row per (user, product) with a composite primary key. The old model
    // pushed onto an array in a single document, which meant read-modify-write
    // and a lost-update race between two tabs; upsert here is a single statement
    // and duplicates are impossible by construction.
    await prisma.wishlistItem.upsert({
        where: {
            userId_productId: { userId: String(userId), productId },
        },
        create: { userId: String(userId), productId },
        update: {},
    });
    invalidateCache({ wishlist: true, userId: String(userId) });
    return res.status(200).json({
        success: true,
        message: "Added to wishList.",
    });
});
export const myWishList = TryCatch(async (req, res, next) => {
    const { id } = req.query;
    const key = `wishlist-${id}`;
    let products;
    if (myCache.has(key)) {
        products = JSON.parse(myCache.get(key));
    }
    else {
        // one join instead of N findById round-trips; the FK guarantees the
        // product still exists, so no null-filtering is needed
        const rows = await prisma.wishlistItem.findMany({
            where: { userId: String(id) },
            include: { product: true },
            orderBy: { createdAt: "desc" },
        });
        products = serializeProducts(rows.map((r) => r.product));
        myCache.set(key, JSON.stringify(products));
    }
    return res.status(200).json({
        success: true,
        message: "your wishlist",
        WishList: products
    });
});
export const deleteWishList = TryCatch(async (req, res, next) => {
    const { id: userId } = req.query;
    const productId = String(req.params.id);
    const { count } = await prisma.wishlistItem.deleteMany({
        where: { userId: String(userId), productId },
    });
    if (count === 0) {
        return res.status(404).json({
            success: false,
            message: 'Wishlist not found or product not in wishlist',
        });
    }
    invalidateCache({ wishlist: true, userId: String(userId) });
    return res.status(200).json({
        success: true,
        message: "Removed from wishlist",
    });
});
