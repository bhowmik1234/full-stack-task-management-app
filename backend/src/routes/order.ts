import express from "express";
import { adminOnly, verifyUser } from "../middlewares/auth.js";
import { allOrders, deleteOrder, getSingleOrder, myOrders, newOrder, processOrder } from "../controllers/order.js";


const app = express.Router();

// // route - /api/v1/order/new
app.post("/new", verifyUser, newOrder);

// // route - /api/v1/order/my
app.get("/my", verifyUser, myOrders);

// // route - /api/v1/order/my
app.get("/all", adminOnly, allOrders);

app
  .route("/:id")
  .get(verifyUser, getSingleOrder)
  .put(adminOnly, processOrder)
  .delete(adminOnly, deleteOrder);

export default app;