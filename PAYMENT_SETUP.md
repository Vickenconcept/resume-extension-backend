# Payment System Setup Guide

## Overview
This application uses Paystack for payment processing with a credit-based system. Users get free trial credits and can purchase additional credits.

## Environment Variables

Add these to your `.env` file:

```env
# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here
PAYSTACK_CALLBACK_URL=https://your-domain.com/api/payment/callback

# Currency Conversion (USD to NGN)
# Paystack uses NGN as base currency, but we display USD to users
USD_TO_NGN_RATE=1500

# Payment Plans
# Format: amount:credits,amount:credits
# Example: $5 for 20 credits, $10 for 50 credits, $20 for 120 credits, $50 for 350 credits
PAYMENT_PLANS=5:20,10:50,20:120,50:350

# Free Trial
# Number of free generations/regenerations users get
FREE_TRIAL_LIMIT=3
```

## Database Migration

Run the migration to add payment tables:

```bash
cd backend2
npx prisma migrate dev --name add_payment_system
```

Or manually run the SQL migration:
```bash
npx prisma db push
```

## Payment Flow

1. **User clicks "Buy Credits"** → Opens payment modal
2. **User selects a plan** → Initializes Paystack payment
3. **User completes payment** → Paystack redirects (or opens in new tab)
4. **Backend verifies payment** → Credits are added to user account
5. **User can now generate/regenerate** → Credits are deducted

## Credit System

- **Free Trial**: Users get `FREE_TRIAL_LIMIT` free generations (default: 3)
- **Paid Credits**: Each generation/regeneration costs 1 credit
- **Credit Balance**: Displayed in header, updates after payment

## API Endpoints

### Payment Endpoints
- `POST /api/payment/initialize` - Initialize a payment
- `POST /api/payment/verify` - Verify a payment status
- `GET /api/payment/plans` - Get available payment plans
- `GET /api/payment/credits` - Get user's credit balance

### Protected Endpoints (Require Credits)
- `POST /api/tailor-resume` - Requires 1 credit (or free trial)
- `POST /api/regenerate-resume` - Requires 1 credit (or free trial)

## Admin Panel (Future)

The admin panel will allow you to:
- View all users and their credit balances
- Adjust payment plans (amount:credits ratio)
- View payment history
- Manage free trial limits per user
- View usage statistics

## Testing

1. Use Paystack test keys for development
2. Test payment flow with test cards from Paystack documentation
3. Verify credits are added correctly after payment
4. Test free trial limit enforcement
5. Test credit deduction on generation

## Notes

- Paystack processes payments in NGN, but we display USD to users
- Currency conversion rate should be updated regularly
- Payment plans can be configured via environment variable
- Free trial limit is configurable via environment variable
