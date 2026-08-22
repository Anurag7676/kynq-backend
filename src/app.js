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
import orderRoutes from "./routes/orderRoute.js";
import paymentRoutes from "./routes/paymentRoute.js";
import shippingRoutes from "./routes/shippingRoutes.js";
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

// kynq gift routes (drops, bundles, journal, posts, pairings, wishes, etc.)
import giftReviews from "./gift/routes/reviews.js";
import giftDrops from "./gift/routes/drops.js";
import giftBundles from "./gift/routes/bundles.js";
import giftJournal from "./gift/routes/journal.js";
import giftPosts from "./gift/routes/posts.js";
import giftNewsletter from "./gift/routes/newsletter.js";
import giftWishes from "./gift/routes/wishes.js";
import giftPairings from "./gift/routes/pairings.js";
import giftCheckout from "./gift/routes/checkout.js";
import giftWebhook from "./gift/routes/webhook.js";
import giftWebhookCashfree from "./gift/routes/webhook-cashfree.js";
// kynq gift cart/wishlist/auth — session-cookie-scoped, match the frontend's
// cart-context/auth-context contract exactly (POST /items, PATCH /items/:id,
// magic-link auth). These supersede the legacy Mongo cartRoutes/wishlistRoutes
// below, which were never wired up to the shape the frontend expects.
import giftCart from "./gift/routes/cart.js";
import giftWishlist from "./gift/routes/wishlist.js";
import giftAuth from "./gift/routes/auth.js";
import giftContact from "./gift/routes/contact.js";
import giftOrders from "./gift/routes/orders.js";


dotenv.config();

const app = express();

// Regular body parsing middleware for most routes
// Skip body parsing for webhook routes to preserve raw body for signature verification
const RAW_BODY_ROUTES = ["/api/payments/webhook", "/api/webhooks/stripe", "/api/webhooks/cashfree"];
app.use((req, res, next) => {
  if (RAW_BODY_ROUTES.includes(req.originalUrl)) {
    next();
    return;
  }
  express.json({ limit: "12mb" })(req, res, next);
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
// Allowed browser origins — override with comma-separated CORS_ORIGINS env.
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["https://kynq.in", "https://www.kynq.in", "http://localhost:3007", "http://localhost:3000"];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
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

// Media served from public/media (used by posts, wishes uploads)
app.use("/media", express.static(path.join(__dirname, "../public/media")));

// Payment webhooks from gift API — need raw body, mounted before json parser
// is applied. Since we already skipped json for these URLs above, mount them
// here directly.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), giftWebhook);
app.use("/api/webhooks/cashfree", express.raw({ type: "application/json" }), giftWebhookCashfree);

// API Routes
app.use("/api/admin", authLimiter, adminRoutes);
app.use("/api/users", authLimiter, userRoutes);
app.use("/api/products", generalLimiter, productRoutes);
app.use("/api/categories", generalLimiter, categoryRoutes);
app.use("/api/blogs", generalLimiter, blogRoutes);
// /api/orders is shared: kynq (gift, cookie-scoped) and StylenHomes/admin
// (legacy, Bearer-JWT-scoped, incl. stats/deliver/refund/invoice) both live
// here. Bearer-authenticated requests fall through untouched to the legacy
// router; everything else (kynq's cookie-based checkout/account/order pages)
// is handled by the gift router.
app.use("/api/orders", generalLimiter, (req, res, next) => {
  const isBearerAuthed = req.headers.authorization?.startsWith("Bearer ");
  if (isBearerAuthed) return next();
  giftOrders(req, res, next);
});
app.use("/api/orders", generalLimiter, orderRoutes);
app.use("/api/payments", authLimiter, paymentRoutes);
app.use("/api/shipping", generalLimiter, shippingRoutes);
app.use("/api/content", generalLimiter, contentRoutes);
app.use("/api/homepage", generalLimiter, homepageRoutes);
// kynq's contact form (POST /) is handled by the gift router; legacy admin
// routes (GET/PUT/DELETE, Bearer-JWT-scoped) fall through untouched.
app.use("/api/contact", authLimiter, giftContact);
app.use("/api/contact", authLimiter, contactRoutes);
app.use("/api/bulk-upload", generalLimiter, bulkUploadRoutes);
app.use("/api/dashboard", generalLimiter, dashboardRoutes);
app.use("/api/quotes", generalLimiter, quoteRoutes);
app.use("/api/projects", generalLimiter, projectRoutes);
app.use("/api/products/export", generalLimiter, productExportRoutes);
app.use("/api/mlm", generalLimiter, mlmRoutes);
app.use("/api/editors", authLimiter, editorRoutes);

// ─── kynq gift routes ───
// These use the same MONGO_URI connection but access different collections.
// Mounted AFTER the main routes above so they don't conflict.
app.use("/api/products", generalLimiter, giftReviews);
app.use("/api/drops", generalLimiter, giftDrops);
app.use("/api/bundles", generalLimiter, giftBundles);
app.use("/api/journal", generalLimiter, giftJournal);
app.use("/api/posts", generalLimiter, giftPosts);
app.use("/api/newsletter", generalLimiter, giftNewsletter);
app.use("/api/wishes", generalLimiter, giftWishes);
app.use("/api/pairings", generalLimiter, giftPairings);
app.use("/api/checkout", generalLimiter, giftCheckout);
// Session-cookie-scoped cart/wishlist/auth — this is what the frontend's
// cart-context.tsx / auth-context.tsx actually calls.
app.use("/api/cart", generalLimiter, giftCart);
app.use("/api/wishlist", generalLimiter, giftWishlist);
// generalLimiter, not authLimiter — GET /api/auth/me is polled on every
// page mount (AuthProvider), so it needs the same headroom as any other
// read endpoint. The actual sensitive routes (request-otp/verify-otp) carry
// their own dedicated limiter inside gift/routes/auth.js.
app.use("/api/auth", generalLimiter, giftAuth);

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