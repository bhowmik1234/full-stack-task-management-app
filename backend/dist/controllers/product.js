import { TryCatch } from "../middlewares/error.js";
import { Product } from "../models/product.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { rm } from "fs";
import { myCache } from "../app.js";
import { invalidateCache } from "../utils/features.js";
import { WishList } from "../models/wishlist.js";
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
    await Product.create({
        name,
        category: category.toLocaleLowerCase(),
        price,
        stock,
        photo: photo?.path,
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
        products = await Product.find({}).sort({ createdAt: -1 }).limit(5);
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
        categories = await Product.distinct("category");
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
        products = await Product.find({});
        myCache.set("all-products", JSON.stringify(products));
    }
    return res.status(200).json({
        success: true,
        products,
    });
});
export const getSingleProduct = TryCatch(async (req, res, next) => {
    let product;
    const id = req.params.id;
    if (myCache.has(`product-${id}`))
        product = JSON.parse(myCache.get(`product-${id}`));
    else {
        product = await Product.findById(id);
        if (!product)
            return next(new ErrorHandler("Product Not Found", 404));
        myCache.set(`product-${id}`, JSON.stringify(product));
    }
    return res.status(200).json({
        success: true,
        product,
    });
});
export const updateProduct = TryCatch(async (req, res, next) => {
    const { id } = req.params;
    const { name, price, stock, category } = req.body;
    const photo = req.file;
    const product = await Product.findById(id);
    if (!product)
        return next(new ErrorHandler("Product Not Found", 404));
    if (photo) {
        rm(product.photo, () => {
            console.log("Old Photo Deleted");
        });
        product.photo = photo.path;
    }
    if (name)
        product.name = name;
    if (price)
        product.price = price;
    if (stock)
        product.stock = stock;
    if (category)
        product.category = category;
    await product.save();
    invalidateCache({
        product: true,
        productId: String(product._id),
        admin: true,
    });
    return res.status(200).json({
        success: true,
        message: "Product Updated Successfully",
    });
});
export const deleteProduct = TryCatch(async (req, res, next) => {
    const product = await Product.findById(req.params.id);
    if (!product)
        return next(new ErrorHandler("Product Not Found", 404));
    rm(product.photo, () => {
        console.log("Product Photo Deleted");
    });
    await product.deleteOne();
    invalidateCache({
        product: true,
        productId: String(product._id),
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
    // 1,2,3,4,5,6,7,8
    // 9,10,11,12,13,14,15,16
    // 17,18,19,20,21,22,23,24
    const limit = Number(process.env.PRODUCT_PER_PAGE) || 8;
    const skip = (page - 1) * limit;
    const baseQuery = {};
    if (search)
        baseQuery.name = {
            $regex: search,
            $options: "i",
        };
    if (price)
        baseQuery.price = {
            $lte: Number(price),
        };
    if (category)
        baseQuery.category = category;
    const productsPromise = Product.find(baseQuery)
        .sort(sort && { price: sort === "asc" ? 1 : -1 })
        .limit(limit)
        .skip(skip);
    const [products, filteredOnlyProduct] = await Promise.all([
        productsPromise,
        Product.find(baseQuery),
    ]);
    const totalPage = Math.ceil(filteredOnlyProduct.length / limit);
    return res.status(200).json({
        success: true,
        products,
        totalPage,
    });
});
export const addToWishList = TryCatch(async (req, res, next) => {
    const { id: userId } = req.query;
    const productId = req.params.id;
    // const productObjectId = new mongoose.Types.ObjectId(productId);
    const product = await Product.findById(productId);
    if (!product)
        return next(new ErrorHandler("Product Not Found", 404));
    const wish = await WishList.findOne({ userId });
    if (!wish) {
        await WishList.create({ userId, productId: [productId] });
    }
    else {
        const productIds = wish.productId.map(id => id.toString());
        if (!productIds.includes(productId.toString())) {
            wish.productId.push(product._id);
            await wish.save();
            invalidateCache({ wishlist: true });
        }
    }
    return res.status(200).json({
        success: true,
        message: "Added to wishList.",
    });
});
export const myWishList = TryCatch(async (req, res, next) => {
    const { id } = req.query;
    let products;
    if (myCache.has("wishlist")) {
        products = JSON.parse(myCache.get("wishlist"));
    }
    else {
        const wish = await WishList.findOne({ userId: id });
        if (!wish) {
            return res.status(404).json({
                success: false,
                message: 'Wishlist not found',
            });
        }
        const productPromises = wish.productId.map(async (productId) => {
            return await Product.findById(productId);
        });
        products = await Promise.all(productPromises);
        myCache.set("wishlist", JSON.stringify(products));
    }
    return res.status(200).json({
        success: true,
        message: "your wishlist",
        WishList: products
    });
});
export const deleteWishList = TryCatch(async (req, res, next) => {
    const { id: userId } = req.query;
    const { id: productId } = req.params;
    const wish = await WishList.findOneAndUpdate({ userId }, { $pull: { productId: productId } }, { new: true } // Return the updated document
    );
    if (!wish) {
        return res.status(404).json({
            success: false,
            message: 'Wishlist not found or product not in wishlist',
        });
    }
    invalidateCache({ wishlist: true });
    return res.status(200).json({
        success: true,
        message: "Removed from wishlist",
    });
});
