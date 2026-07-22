#!/usr/bin/env bash
# Test script for admin.neha.infiniteerp.in API
# Generates valid X-Timestamp and X-Signature for the given body, then runs curl.

API_KEY="SBX_KEY_c31ec1e0d4b9498d9a1e2a2e9b6c09ba"
SECRET_KEY="SBX_SECRET_5ee6b2fdb96849619bc9e9d4aa7c02d4c4b6a0f2f6c6be83530e7d65a4c8ff3d"
API_URL="https://admin.neha.infiniteerp.in/api/ecommerce/orders"

# Sample body (must be single line / no extra spaces for signature to match)
BODY='{"customer_name":"Test User","customer_email":"test@example.com","customer_id":"507f1f77bcf86cd799439011","order_id":"INV-001","order_amount":99.99,"currency":"USD","order_date":"2025-01-30T12:00:00.000Z","payment_status":"paid","meta":{"items":[{"product_id":"507f191e810c19729de860ea","name":"Test Product","quantity":2,"unit_price":49.99,"total":99.98}]}}'

TIMESTAMP=$(date +%s)
MESSAGE="${TIMESTAMP}.${BODY}"
SIGNATURE=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$SECRET_KEY" | awk '{print $2}')

echo "Timestamp: $TIMESTAMP"
echo "Signature: $SIGNATURE"
echo "---"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Signature: $SIGNATURE" \
  -d "$BODY" | jq .
