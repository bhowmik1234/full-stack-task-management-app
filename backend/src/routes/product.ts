import express from "express";
import { requirePermission, verifyUser } from "../middlewares/auth.js";
import {
  addToWishList,
  deleteProduct,
  deleteWishList,
  getAdminProducts,
  getAllCategories,
  getAllProducts,
  getRelatedProducts,
  getSingleProduct,
  getlatestProducts,
  myStockAlert,
  myWishList,
  newProduct,
  suggestProducts,
  unwatchStock,
  updateProduct,
  watchStock,
} from "../controllers/product.js";
import {
  canReview,
  deleteReview,
  getProductReviews,
  myReviews,
  newReview,
} from "../controllers/review.js";
import { productUpload } from "../middlewares/multer.js";
import { adminLimiter, suggestLimiter, writeLimiter } from "../middlewares/rateLimit.js";

const router = express.Router();

router.post("/new", adminLimiter, requirePermission("products_write"), writeLimiter, productUpload, newProduct);

router.get("/all", getAllProducts);
router.get("/latest", getlatestProducts);
router.get("/category", getAllCategories);
// Type-ahead for the header search box. Above "/:id" — a literal segment and a
// parameterised one at the same depth, so the parameter would swallow it.
router.get("/suggest", suggestLimiter, suggestProducts);
// admin-only: this returns the unpaginated catalogue used by the admin table
router.get("/admin-products", adminLimiter, requirePermission("products_read"), getAdminProducts);

router.get("/wishlist/my", verifyUser, myWishList);
router.get("/wishlist/:id", verifyUser, addToWishList);
router.delete("/wishlist/delete/:id", verifyUser, deleteWishList);

// Everything the caller has reviewed, for the account page. Registered *above*
// "/:id/reviews" deliberately: both are two-segment paths, so the parameterised
// one would otherwise match first with id="reviews".
router.get("/reviews/mine", verifyUser, myReviews);


// Reviews hang off a product. Listing is public; writing needs a known uid,
// and goes through writeLimiter like every other mutation.
router
  .route("/:id/reviews")
  .get(getProductReviews)
  .post(verifyUser, writeLimiter, newReview)
  .delete(verifyUser, writeLimiter, deleteReview);

router.get("/:id/reviews/mine", verifyUser, canReview);

// Back-in-stock requests. Not public: the whole point is to email a specific
// person, so there is nothing to record without a known uid.
router
  .route("/:id/stock-alert")
  .get(verifyUser, myStockAlert)
  .post(verifyUser, writeLimiter, watchStock)
  .delete(verifyUser, writeLimiter, unwatchStock);

// "You may also like" on the product page. Public, like the product itself.
router.get("/:id/related", getRelatedProducts);

router
  .route("/:id")
  .get(getSingleProduct)
  .put(adminLimiter, requirePermission("products_write"), writeLimiter, productUpload, updateProduct)
  .delete(adminLimiter, requirePermission("products_write"), writeLimiter, deleteProduct);


export default router;
