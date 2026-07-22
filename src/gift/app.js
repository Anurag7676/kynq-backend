// kynq gift API — clean Express app that replaces the Next.js /api/* routes.
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import products from "./routes/products.js";
import reviews from "./routes/reviews.js";
import drops from "./routes/drops.js";
import bundles from "./routes/bundles.js";
import journal from "./routes/journal.js";
import posts from "./routes/posts.js";
import contact from "./routes/contact.js";
import newsletter from "./routes/newsletter.js";
import cart from "./routes/cart.js";
import wishlist from "./routes/wishlist.js";
import auth from "./routes/auth.js";
import orders from "./routes/orders.js";
import checkout from "./routes/checkout.js";
import wishes from "./routes/wishes.js";
import pairings from "./routes/pairings.js";
import webhook from "./routes/webhook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: "https://kynq.in", credentials: true }));
app.use(helmet());
app.use(cookieParser());
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// Stripe webhook needs the raw body — mount before json parser.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), webhook);
app.use(express.json({ limit: "12mb" }));

// Posts/wishes media uploaded via API — served by the Backend.
app.use("/media", express.static(path.join(__dirname, "../../public/media")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/products", reviews);
app.use("/api/products", products);
app.use("/api/drops", drops);
app.use("/api/bundles", bundles);
app.use("/api/journal", journal);
app.use("/api/posts", posts);
app.use("/api/contact", contact);
app.use("/api/newsletter", newsletter);
app.use("/api/cart", cart);
app.use("/api/wishlist", wishlist);
app.use("/api/auth", auth);
app.use("/api/orders", orders);
app.use("/api/checkout", checkout);
app.use("/api/wishes", wishes);
app.use("/api/pairings", pairings);

app.use((_req, res) => res.status(404).json({ error: "not_found", message: "no such route" }));

export default app;
