# Recurring Payment Implementation Guide

## Overview

This application uses Paystack's **Charge Authorization** API for recurring payments. After a user's first successful payment, we save their `authorization_code` and use it to automatically charge them monthly without requiring them to re-enter card details.

## How It Works

### 1. Initial Payment Flow
```
User pays → Paystack returns authorization_code → We save it → Subscription created
```

### 2. Recurring Charge Flow (Monthly)
```
Cron checks nextChargeAt → Finds due subscriptions → Charges using saved authorization_code → Adds credits → Updates nextChargeAt
```

## Critical Requirements & Gotchas

### ✅ 1. Authorization Code Must Be Reusable

**What's Saved:**
- `paystackAuthorizationCode` - Tokenized card authorization (e.g., `AUTH_xxxxx`)
- `paystackCustomerCode` - Paystack customer reference (optional)

**Critical Check:**
- Before saving, verify `authorization.reusable === true` in the verification response
- If `reusable: false`, recurring charges **will not work**
- Most cards support reusable authorization, but some bank transfers/USSD may not

**Implementation:**
```typescript
// In payment.controller.ts - we now check and log this
if (authorization.reusable === false) {
  logger.warn('Authorization code is not reusable - recurring payments will not work');
}
```

### ✅ 2. Email Must Match Exactly

**Critical:** The email passed to `chargeAuthorization` **must exactly match** the email used in the original payment.

**Why:** Paystack enforces strict email matching for security.

**Implementation:**
```typescript
// We use subscription.user.email which matches the user's account email
// This email was used in the initial payment initialization
await paymentService.chargeAuthorization({
  authorizationCode: subscription.paystackAuthorizationCode,
  email: subscription.user.email, // Must match original payment email
  amount: Number(subscription.amount),
});
```

**Gotcha:** If user changes their email in your system but Paystack still has the old email, charges will fail. Consider:
- Storing the original payment email separately
- Or updating Paystack customer email when user changes email

### ✅ 3. Amount Must Be in Kobo (Smallest Currency Unit)

**Conversion:**
- Amount stored: USD (e.g., `5.00`)
- Paystack expects: NGN kobo (smallest unit)
- Formula: `USD * USD_TO_NGN_RATE * 100`

**Example:**
- $5 USD × 1500 rate × 100 = 750,000 kobo = ₦7,500 NGN

**Implementation:**
```typescript
private convertUsdToNgnKobo(amount: number): number {
  const usdToNgnRate = parseFloat(process.env.USD_TO_NGN_RATE || '1500');
  return Math.round(amount * usdToNgnRate * 100); // Convert to kobo
}
```

### ✅ 4. Currency Consistency

- Paystack uses **NGN** as base currency
- We display **USD** to users
- Conversion happens automatically using `USD_TO_NGN_RATE` env variable
- Always pass `currency: 'NGN'` in charge requests

### ✅ 5. Error Handling

**Common Failure Reasons:**

1. **Card Expired**
   - Status: `past_due`
   - Action: Retry after 1 day (configurable)
   - User must update card manually

2. **Insufficient Funds**
   - Status: `past_due`
   - Action: Retry after 1 day
   - May succeed on retry if user adds funds

3. **Email Mismatch**
   - Error: "Email mismatch"
   - Action: Check that `subscription.user.email` matches original payment email

4. **Invalid Authorization Code**
   - Error: "Invalid authorization code"
   - Causes: Code expired, card deleted, or never reusable
   - Action: User must make a new payment

5. **Authorization Not Reusable**
   - Warning logged during initial payment
   - Recurring charges will fail
   - User must make manual payments

**Current Implementation:**
- Failed charges → Status set to `past_due`
- Retry scheduled for next day (`DEFAULT_RETRY_DAYS = 1`)
- Logs all errors for monitoring

### ✅ 6. Scheduled Processing

**How It Works:**
- Service checks every hour (configurable via `SUBSCRIPTION_CHECK_INTERVAL_MS`)
- Finds subscriptions where `nextChargeAt <= now()`
- Processes each due subscription
- Updates `nextChargeAt` to 1 month later on success

**Configuration:**
```env
SUBSCRIPTION_CHECK_INTERVAL_MS=3600000  # 1 hour (default)
```

**Manual Trigger (for testing):**
```typescript
await subscriptionService.processDueSubscriptions();
```

## Data Saved in Database

### `subscriptions` Table:
```sql
- paystack_authorization_code  ← Used for recurring charges (REQUIRED)
- paystack_customer_code        ← Paystack customer reference (optional)
- amount                        ← Amount in USD per month
- credits                       ← Credits to add per month
- next_charge_at                ← When to charge next (1 month from last charge)
- last_charged_at               ← Last successful charge timestamp
- status                        ← active | past_due | canceled
- user_id                       ← Links to user
```

## Testing

### Test Cards (Paystack Test Mode):
- Use Paystack test cards from their documentation
- Test successful charge
- Test card expiration
- Test insufficient funds
- Verify `reusable: true` in response

### Test Flow:
1. Make initial payment with test card
2. Verify `authorization.reusable === true` in logs
3. Manually trigger subscription processing
4. Verify credits added and `nextChargeAt` updated

## Monitoring & Webhooks (Recommended)

### Current: Polling-Based
- Cron checks every hour
- Processes due subscriptions
- Logs all results

### Recommended: Webhook-Based (Future Enhancement)
Paystack can send webhooks for:
- `charge.success` - Payment succeeded
- `charge.failed` - Payment failed
- `charge.dispute` - Chargeback/dispute

**Benefits:**
- Real-time updates (no 1-hour delay)
- More reliable than polling
- Better error handling

**Implementation (Future):**
```typescript
// POST /api/payment/webhook
// Verify webhook signature
// Update subscription status immediately
// Retry failed charges faster
```

## Environment Variables

```env
# Required
PAYSTACK_SECRET_KEY=sk_test_...          # For charge_authorization API
PAYSTACK_PUBLIC_KEY=pk_test_...          # For frontend initialization
USD_TO_NGN_RATE=1500                     # Conversion rate

# Optional
SUBSCRIPTION_CHECK_INTERVAL_MS=3600000   # How often to check (default: 1 hour)
PAYSTACK_CALLBACK_URL=...                # Callback URL for initial payments
```

## API Endpoints

### For Recurring Charges:
- **Internal:** `SubscriptionService.processDueSubscriptions()` (called by cron)
- **Paystack:** `POST /transaction/charge_authorization`

### For Initial Payments:
- `POST /api/payment/initialize` - Initialize payment
- `POST /api/payment/verify` - Verify payment (saves authorization_code)

## Best Practices

1. ✅ **Always check `reusable: true`** before saving authorization code
2. ✅ **Log authorization details** (card type, last4, reusable status)
3. ✅ **Handle email matching** - ensure email consistency
4. ✅ **Monitor failed charges** - check logs regularly
5. ✅ **Set up webhooks** (recommended for production)
6. ✅ **Test thoroughly** in test mode before going live
7. ✅ **Update `USD_TO_NGN_RATE`** regularly for accurate conversions
8. ✅ **Handle card expiration** - notify users before cards expire

## Troubleshooting

### Charge Fails with "Email mismatch"
- Check: `subscription.user.email` matches original payment email
- Solution: Store original payment email separately if needed

### Charge Fails with "Invalid authorization code"
- Check: Authorization code was saved correctly
- Check: Code hasn't expired (Paystack codes can expire)
- Solution: User must make a new payment

### Recurring charges not happening
- Check: `nextChargeAt` is set correctly
- Check: Cron job is running (`SUBSCRIPTION_CHECK_INTERVAL_MS`)
- Check: `paystackAuthorizationCode` exists and is not null
- Check: Subscription status is `active`

### Credits not added after charge
- Check: Charge was successful (`chargeResult.data.status === 'success'`)
- Check: Transaction completed successfully in database
- Check: User credits were incremented correctly

## References

- [Paystack Recurring Charges Docs](https://paystack.com/docs/payments/recurring-charges)
- [Paystack Charge Authorization API](https://paystack.com/docs/api/transaction/#charge-authorization)
- [Paystack Test Cards](https://paystack.com/docs/payments/test-payments)
