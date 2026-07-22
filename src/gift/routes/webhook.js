import express from "express";
import { setOrderStatus, findOrderByStripeSession } from "../orders-store.js";
import { collection } from "../store.js";
import { ok, badRequest, wrap } from "../http.js";

const router = express.Router();
const carts = collection("carts");

// POST /api/webhooks/stripe — Stripe sends raw body here.
// Signature verification requires STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET.
router.post("/", wrap(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return badRequest(res, "Stripe not configured");
  }

  let event;
  try {
    const stripe = (await import("stripe")).default;
    const stripeInstance = new stripe(process.env.STRIPE_SECRET_KEY);
    event = stripeInstance.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err.message);
    return badRequest(res, `Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await setOrderStatus(orderId, "paid", `stripe session ${session.id}`);
      // Clear the cart for the scoped user
      const scopedId = session.metadata?.kynqScopedId;
      if (scopedId) {
        await carts.set(scopedId, {
          sessionId: scopedId, items: [], itemCount: 0, subtotal: 0,
          currency: "INR", updatedAt: Date.now(),
        });
      }
      console.log(`[webhook] order ${orderId} marked paid via Stripe`);
    }
  }

  ok(res, { received: true });
}));

export default router;
