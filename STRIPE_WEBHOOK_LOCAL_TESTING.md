# Stripe Webhook Local Testing Guide

This guide will help you test Stripe webhooks locally using the Stripe CLI.

## Prerequisites

1. **Install Stripe CLI**
   - macOS: `brew install stripe/stripe-cli/stripe`
   - Windows: Download from https://stripe.com/docs/stripe-cli
   - Linux: See https://stripe.com/docs/stripe-cli

2. **Verify Installation**
   ```bash
   stripe --version
   ```

## Setup Steps

### Step 1: Login to Stripe CLI

```bash
stripe login
```

This will open your browser to authenticate with your Stripe account.

### Step 2: Start Your Backend Server

Make sure your backend server is running:

```bash
npm run dev
# or
node src/server.js
```

Your server should be running on port 3001 (check your `.env` file - current setting is `PORT=3001`).

### Step 3: Forward Webhook Events to Local Server

In a **new terminal window**, run:

```bash
stripe listen --forward-to localhost:3001/api/payments/webhook
```

**Note:** Your server runs on port 3001 (check your `.env` file). Adjust if your port is different.

This will:
- Start listening for Stripe events
- Forward them to your local webhook endpoint
- Display a webhook signing secret (you'll need this)

### Step 4: Copy the Webhook Signing Secret

When you run `stripe listen`, you'll see output like:

```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx (^C to quit)
```

**Copy this secret** and add it to your `.env` file:

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

**Note:** This secret is different from your production webhook secret. It's only for local testing.

### Step 5: Restart Your Server

After adding the webhook secret, restart your server to load the new environment variable.

## Testing Webhooks

### Test Payment Intent Succeeded Event

```bash
stripe trigger payment_intent.succeeded
```

This will:
1. Create a test payment intent
2. Mark it as succeeded
3. Send the `payment_intent.succeeded` event to your local webhook endpoint

### Test Other Events

```bash
# Payment intent created
stripe trigger payment_intent.created

# Payment intent payment_failed
stripe trigger payment_intent.payment_failed

# Charge succeeded
stripe trigger charge.succeeded
```

## What to Expect

When you trigger an event, you should see:

1. **In Stripe CLI terminal:**
   ```
   payment_intent.succeeded [200] POST http://localhost:3001/api/payments/webhook
   ```

2. **In your server logs:**
   ```
   [WEBHOOK] Processing event: payment_intent.succeeded, Status: succeeded
   [WEBHOOK] Payment succeeded for order: ...
   [WEBHOOK] Order ... updated successfully
   [WEBHOOK] Payment confirmation emails sent for order ...
   ```

## Troubleshooting

### Webhook Not Receiving Events

1. **Check server is running:**
   ```bash
   curl http://localhost:3001/api/payments/webhook
   ```

2. **Check webhook secret:**
   - Make sure `STRIPE_WEBHOOK_SECRET` in `.env` matches the secret from `stripe listen`
   - Restart server after updating `.env`

3. **Check port number:**
   - Verify your server port matches the port in `stripe listen --forward-to`
   - Default is 3000, but check your `.env` or `server.js`

### Webhook Signature Verification Failing

- Make sure you're using the webhook secret from `stripe listen` (starts with `whsec_`)
- Don't use your production webhook secret for local testing
- Restart server after updating the secret

### Events Not Processing

- Check server logs for errors
- Verify the webhook handler is receiving the event
- Check that order IDs in metadata match actual orders in your database

## Testing with Real Order Data

To test with a specific order:

1. Create an order in your system
2. Create a payment intent for that order
3. Note the payment intent ID
4. Use Stripe CLI to trigger events with metadata:

```bash
stripe trigger payment_intent.succeeded \
  --override payment_intent:metadata[orderId]=YOUR_ORDER_ID \
  --override payment_intent:metadata[userId]=YOUR_USER_ID
```

## Useful Commands

```bash
# List all available events to trigger
stripe trigger --help

# Forward to different endpoint
stripe listen --forward-to localhost:3001/api/payments/webhook

# See webhook events in real-time
stripe listen --print-json

# Forward and print events
stripe listen --forward-to localhost:3001/api/payments/webhook --print-json
```

## Next Steps

Once local testing works:
1. Test all payment-related events
2. Verify order status updates
3. Check email notifications are sent
4. Verify e-commerce sync is working
5. Test error handling scenarios

