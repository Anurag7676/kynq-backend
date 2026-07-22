# Order API - Agent Code Documentation

## Endpoint

**POST** `/api/orders`

## Authentication

**Required:** Yes (Bearer Token)

Include the authentication token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Request Body

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `cartId` | String | MongoDB ObjectId of the cart |
| `shippingAddress` | Object | Shipping address object (see below) |
| `paymentMethod` | String | Payment method (e.g., "stripe") |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `billingAddress` | Object | Billing address (defaults to shippingAddress if not provided) |
| `customerNotes` | String | Additional notes from customer |

### Agent Code Details

- **NOT accepted in request body:** Agent code should be set in cart when adding products
- **Source:** Agent code is taken from the cart
- **Validation:** If cart has agent code, it is validated before order creation
- **Error:** If cart has invalid agent code, order creation will fail with 400 error
- **Storage:** If valid, agent code is stored in the order and used for commission tracking

### Shipping Address Object

```json
{
  "fullName": "John Doe",
  "street": "123 Main Street",
  "city": "San Francisco",
  "state": "CA",
  "zipCode": "94105",
  "country": "USA",
  "phoneNumber": "+1234567890",
  "deliveryInstructions": "Leave at door" // optional
}
```

## Example Request

### Without Agent Code

```json
{
  "cartId": "68aeebcf9181b9a1176e0cc4",
  "shippingAddress": {
    "fullName": "John Doe",
    "street": "123 Main Street",
    "city": "San Francisco",
    "state": "CA",
    "zipCode": "94105",
    "country": "USA",
    "phoneNumber": "+1234567890"
  },
  "paymentMethod": "stripe",
  "customerNotes": "Please handle with care"
}
```

### With Agent Code (Set in Cart)

**Step 1: Add product to cart with agent code**
```json
POST /api/cart
{
  "productId": "68aeebcf9181b9a1176e0cc4",
  "quantity": 1,
  "agentCode": "AGT-12345"
}
```

**Step 2: Create order (agent code from cart is used automatically)**
```json
{
  "cartId": "68aeebcf9181b9a1176e0cc4",
  "shippingAddress": {
    "fullName": "John Doe",
    "street": "123 Main Street",
    "city": "San Francisco",
    "state": "CA",
    "zipCode": "94105",
    "country": "USA",
    "phoneNumber": "+1234567890"
  },
  "paymentMethod": "stripe",
  "customerNotes": "Please handle with care"
}
```

## Response

### Success (201 Created)

```json
{
  "success": true,
  "message": "Order created successfully. Proceed to payment.",
  "order": {
    "_id": "692f43e611d714010c3360ff",
    "invoiceNumber": "HD2512030001",
    "user": "68409ff6a770bc9967c6e892",
    "agentCode": "AGT-12345", // Only present if provided
    "orderItems": [...],
    "totalPrice": 42.36,
    "paymentStatus": "pending",
    "orderStatus": "pending",
    ...
  },
  "paymentRequired": true,
  "taxDetails": {
    "totalTax": 3.36,
    "taxCalculationId": "taxcalc_1SZzeLE83GURWiW7FYadPBMJ",
    "jurisdiction": "California"
  }
}
```

### Error: Invalid Agent Code (400 Bad Request)

```json
{
  "success": false,
  "message": "Invalid agent code: AGT-INVALID. Agent not found in the system."
}
```

### Error: Missing Required Fields (400 Bad Request)

```json
{
  "success": false,
  "message": "Please provide all required fields"
}
```

### Error: Cart Not Found (404 Not Found)

```json
{
  "success": false,
  "message": "Cart not found"
}
```

### Error: Unauthorized (401 Unauthorized)

```json
{
  "success": false,
  "message": "User authentication required to create an order"
}
```

## Agent Code Validation Flow

1. **Agent code from cart:**
   - System checks if cart has an `agentCode` stored
   - If cart has `agentCode` → Validates it exists in Agent collection
   - If validation fails → **Order creation fails with 400 error**
   - If validation succeeds → Agent code is stored in order
   - Commission API will include `agent_id` in payload after payment

2. **No agent code in cart:**
   - Order is created without agent code
   - Commission API will not include `agent_id` in payload

**Note:** Agent code should be set in cart when adding products using `POST /api/cart` with `agentCode` field.

## Setting Agent Code in Cart

Agent code should be set when adding products to cart. This is the primary method.

### Endpoint

**POST** `/api/cart`

### Request Body

```json
{
  "productId": "68aeebcf9181b9a1176e0cc4",
  "quantity": 1,
  "agentCode": "AGT-12345"
}
```

### Example cURL

```bash
curl -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "productId": "68aeebcf9181b9a1176e0cc4",
    "quantity": 1,
    "agentCode": "AGT-12345"
  }'
```

**Note:** 
- Agent code is validated when adding product to cart
- Once set, agent code persists in cart for all subsequent products
- Agent code in cart is preserved when merging guest cart with user cart after login
- See [Cart Agent Code API Documentation](./CART_AGENT_CODE_API_DOCUMENTATION.md) for more details

## Commission API Integration

After payment is completed, the order is automatically synced to the commission API with:

- **If order has `agentCode`:** `agent_id` field is included in the payload
- **If order doesn't have `agentCode`:** `agent_id` field is omitted (optional field)

The commission API is called automatically via:
- Stripe webhook handler (when payment succeeds)
- Manual payment update endpoint

## Available Agent Codes

To check available agent codes, you can query the Agent collection or use the check script:

```bash
node check-agents.js
```

## Example cURL Request

```bash
# Step 1: Add product to cart with agent code
curl -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "productId": "68aeebcf9181b9a1176e0cc4",
    "quantity": 1,
    "agentCode": "AGT-12345"
  }'

# Step 2: Create order (agent code from cart is used automatically)
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "cartId": "68aeebcf9181b9a1176e0cc4",
    "shippingAddress": {
      "fullName": "John Doe",
      "street": "123 Main Street",
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94105",
      "country": "USA",
      "phoneNumber": "+1234567890"
    },
    "paymentMethod": "stripe"
  }'
```

## Notes

- **Agent code should be set in cart when adding products, not in order creation request**
- Agent code is case-sensitive
- Agent code must match exactly as stored in the Agent collection
- Agent code validation happens when adding products to cart and again during order creation
- If validation fails during order creation, the order is not created and an error is returned
- Once stored in the order, the agent code is used for commission tracking after payment
- See [Cart Agent Code API Documentation](./CART_AGENT_CODE_API_DOCUMENTATION.md) for details on setting agent code in cart

