# Payment Redirect Fix

## Issue
After payment, users are being redirected to `localhost:3000/payment/success` instead of `localhost:3002/payment/success`.

## Solution
Make sure your backend `.env` file has the correct `FRONTEND_URL`:

```env
FRONTEND_URL=http://localhost:3002
```

**NOT:**
```env
FRONTEND_URL=http://localhost:3000  # ❌ Wrong - this is the backend URL
```

## How it works:
1. User completes payment on Paystack
2. Paystack redirects to: `http://localhost:3000/api/payment/callback?reference=xxx` (backend)
3. Backend callback endpoint verifies payment and redirects to: `http://localhost:3002/payment/success?reference=xxx` (frontend)
4. Frontend success page displays the beautiful success message

## After updating .env:
1. Restart your backend server
2. Test the payment flow again
