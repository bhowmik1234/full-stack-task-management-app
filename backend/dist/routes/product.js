import express from "express";
import { adminOnly, verifyUser } from "../middlewares/auth.js";
import { addToWishList, deleteProduct, deleteWishList, getAdminProducts, getAllCategories, getAllProducts, getSingleProduct, getlatestProducts, myWishList, newProduct, updateProduct, } from "../controllers/product.js";
import { singleUpload } from "../middlewares/multer.js";
const router = express.Router();
router.post("/new", adminOnly, singleUpload, newProduct);
router.get("/all", getAllProducts);
router.get("/latest", getlatestProducts);
router.get("/category", getAllCategories);
router.get("/admin-products", getAdminProducts);
router.get("/wishlist/my", verifyUser, myWishList);
router.get("/wishlist/:id", verifyUser, addToWishList);
router.delete("/wishlist/delete/:id", verifyUser, deleteWishList);
router
    .route("/:id")
    .get(getSingleProduct)
    .put(adminOnly, singleUpload, updateProduct)
    .delete(adminOnly, deleteProduct);
export default router;
