import express from "express";
import { connectdb } from "./utils/db.js";
import { errorMiddleware } from "./middlewares/error.js";
import NodeCache from "node-cache";
import { config } from "dotenv";
import morgan from "morgan";
import Stripe from "stripe";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
// routes
import userRoute from "./routes/user.js";
import productRoute from "./routes/product.js"
import orderRoute from "./routes/order.js"
import payementRoute from "./routes/payement.js"
import dashboardRoute from "./routes/stats.js"

const app = express();

config({
    path: "./.env",
})
// read after config() so a PORT in .env is picked up; in Docker the real env wins
const PORT = Number(process.env.PORT) || 3000;
const stripeKey = process.env.STRIPE_KEY || "";
// cloudinary.config({
//     cloud_name: "dv1vpvfkg",
//     api_key: "425872355748933",
//     api_secret: "XWXjfWfxjjPLKgtCFxxO0sXK0T8",
//   });

console.log(process.env.CLOUD_NAME)

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME ,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET,
});


export const stripe = new Stripe(stripeKey);
export const myCache = new NodeCache();
connectdb();
// falls back to allow-all when CLIENT_URL isn't set, so local/dev setups
// that predate this var keep working
const allowedOrigin = process.env.CLIENT_URL;
app.use(cors({ origin: allowedOrigin || true }))

app.use(express.json());
app.use(morgan("dev"));
app.get('/', (req, res)=>{
    res.send("hello")
})

app.use("/api/v1/user", userRoute);
app.use("/api/v1/product", productRoute);
app.use("/api/v1/order", orderRoute);
app.use("/api/v1/payement", payementRoute);
app.use("/api/v1/dashboard", dashboardRoute);



app.use('/uploads', express.static("uploads"));
// error middleware
app.use(errorMiddleware);

app.listen(PORT, ()=>{
    console.log(`running on port ${PORT}.`);
})