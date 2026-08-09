import express from "express";
import { requirePermission } from "../middlewares/auth.js";
import { adminLimiter } from "../middlewares/rateLimit.js";
import { getActivity, getAnalytics } from "../controllers/stats.js";

const app = express.Router();

// Everything under /dashboard is the admin console and nothing else, so the
// admin cap is applied to the router rather than repeated per route — a new
// endpoint added here is limited by default instead of by remembering to.
app.use(adminLimiter);

// route - /api/v1/dashboard/analytics?range=7d|30d|90d|12m
// The console's single source of numbers. Replaces /stats, /pie, /bar and
// /line, which answered overlapping questions over hardcoded 6/12-month
// windows and could disagree with each other on the same screen.
app.get("/analytics", requirePermission("analytics_read"), getAnalytics);

// route - /api/v1/dashboard/activity
app.get("/activity", requirePermission("activity_read"), getActivity);

export default app;
