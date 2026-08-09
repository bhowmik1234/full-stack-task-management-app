import express from "express";
import {
  deleteAddress,
  myAddresses,
  newAddress,
  setDefaultAddress,
  updateAddress,
} from "../controllers/address.js";
import { verifyUser } from "../middlewares/auth.js";
import { writeLimiter } from "../middlewares/rateLimit.js";

const router = express.Router();

// Every route is the caller's own address book, so `verifyUser` is the whole
// authorization story: the owner comes from the authenticated uid and each
// query is scoped by it. There is no admin view of this table — an operator
// who needs a customer's address reads it off the order it shipped to.

// route ~ /api/v1/address/my
router.get("/my", verifyUser, myAddresses);

// route ~ /api/v1/address/new
router.post("/new", verifyUser, writeLimiter, newAddress);

// route ~ /api/v1/address/:id/default
router.put("/:id/default", verifyUser, writeLimiter, setDefaultAddress);

// route ~ /api/v1/address/:id
router
  .route("/:id")
  .put(verifyUser, writeLimiter, updateAddress)
  .delete(verifyUser, writeLimiter, deleteAddress);

export default router;
