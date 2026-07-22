import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import adminRoutes from "./routes/adminRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import blogRoutes from "./routes/blogRoute.js";
import cartRoutes from "./routes/cartRoute.js";
import wishlistRoutes from "./routes/wishlistRoute.js";
import orderRoutes from "./routes/orderRoute.js";
import paymentRoutes from "./routes/paymentRoute.js";
import shippingRoutes from "./routes/shippingRoutes.js"; // ADD THIS LINE
import contentRoutes from "./routes/contentRoutes.js";
import homepageRoutes from "./routes/homepageRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import bulkUploadRoutes from "./routes/bulkUploadRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import quoteRoutes from "./routes/quoteRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import productExportRoutes from "./routes/productExportRoutes.js";
import mlmRoutes from "./routes/mlmRoutes.js";
import editorRoutes from "./routes/editorRoutes.js";
import rateLimit from "express-rate-limit";


dotenv.config();

const app = express();

// Regular body parsing middleware for most routes
// Skip body parsing for webhook route to preserve raw body for Stripe signature verification
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhook") {
    next();
    return;
  }
  express.json()(req, res, next); 
});

app.use((req, res, next) => {
  // Skip urlencoded parsing for webhook route to preserve raw body
  if (req.originalUrl === "/api/payments/webhook") {
    next();
    return;
  }
  express.urlencoded({ extended: false })(req, res, next);
});
app.use(cookieParser());
app.use(cors({ origin: "https://kynq.in", credentials: true }));
app.use(helmet());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many attempts, please try again later" },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: "Too many requests, please try again later" },
});

app.use(express.static(path.join(__dirname, "../public")));

// API Routes
app.use("/api/admin", authLimiter, adminRoutes);
app.use("/api/users", authLimiter, userRoutes);
app.use("/api/products", generalLimiter, productRoutes);
app.use("/api/categories", generalLimiter, categoryRoutes);
app.use("/api/blogs", generalLimiter, blogRoutes);
app.use("/api/cart", generalLimiter, cartRoutes);
app.use("/api/wishlist", generalLimiter, wishlistRoutes);
app.use("/api/orders", generalLimiter, orderRoutes);
app.use("/api/payments", authLimiter, paymentRoutes);
app.use("/api/shipping", generalLimiter, shippingRoutes);
app.use("/api/content", generalLimiter, contentRoutes);
app.use("/api/homepage", generalLimiter, homepageRoutes);
app.use("/api/contact", authLimiter, contactRoutes);
app.use("/api/bulk-upload", generalLimiter, bulkUploadRoutes);
app.use("/api/dashboard", generalLimiter, dashboardRoutes);
app.use("/api/quotes", generalLimiter, quoteRoutes);
app.use("/api/projects", generalLimiter, projectRoutes);
app.use("/api/products/export", generalLimiter, productExportRoutes);
app.use("/api/mlm", generalLimiter, mlmRoutes);
app.use("/api/editors", authLimiter, editorRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});


app.get("/", (req, res) => {
  res.json({
    message: "Welcome to Home Decor E-commerce API with ShipRocket Integration",
    status: "Server is running",
    features: [
      "Order Management",
      "Payment Processing", 
      "ShipRocket Shipping",
      "Real-time Tracking",
      "Admin Dashboard"
    ]
  });
});

app.get("/api", (req, res) => {
  res.json({
    message: "API is running...",
    version: "1.0.0",
    endpoints: {
      orders: "/api/orders",
      payments: "/api/payments", 
      shipping: "/api/shipping",
      products: "/api/products",
      users: "/api/users"
    }
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  res.json({
    success: false,
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
});

export default app;