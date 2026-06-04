# Local Development Setup Guide

This guide walks you through setting up 0studio for local development with full Stripe payment testing.

## Overview

```
┌─────────────────────────────────────┐
│   Frontend (Vite)                   │
│   http://localhost:5173             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Backend (Express)                 │
│   http://localhost:3000             │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌───────────┐   ┌───────────┐
│  Supabase │   │  Stripe   │
│  (Cloud)  │   │  (Test)   │
└───────────┘   └───────────┘
```

## Prerequisites

- Node.js 20+ (`node --version`)
- npm (`npm --version`)
- Stripe CLI (`brew install stripe/stripe-cli/stripe`)
- A Supabase project
- A Stripe account (test mode)

## Step 1: Clone and Install

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

## Step 2: Configure Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` key (for backend)

3. Run the database setup SQL from `SUPABASE_SETUP.md` in the SQL Editor

## Step 3: Configure Environment Variables

### Frontend `.env`

Create `.env` in the project root:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Backend (local)
VITE_BACKEND_URL=http://localhost:3000

# Stripe (test mode)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Backend `.env`

Create `backend/.env`:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # Get this from Step 5

# Server
PORT=3000
FRONTEND_URL=http://localhost:5173

# AWS (optional - only needed for cloud storage features)
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_REGION=us-east-1
# S3_BUCKET_NAME=...
```

## Step 4: Create Stripe Product

1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/test/products)
2. Click **Add product**
3. Fill in:
   - Name: `0studio Subscription`
   - Price: `$5.00` / month (recurring)
4. Click **Save product**
5. Copy the **Price ID** (starts with `price_`)

## Step 5: Start Stripe Webhook Forwarding

Open a new terminal and run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

This will output something like:
```
Ready! Your webhook signing secret is whsec_1234567890abcdef...
```

**Copy this `whsec_...` value** and add it to `backend/.env` as `STRIPE_WEBHOOK_SECRET`.

> ⚠️ Keep this terminal running while developing!

## Step 6: Start the Servers

### Terminal 1: Backend

```bash
cd backend
npm start
```

You should see:
```
✅ Supabase client initialized
✅ Stripe client initialized
🚀 Backend API running on http://localhost:3000
```

### Terminal 2: Frontend

```bash
npm run dev
```

You should see:
```
VITE v5.x.x ready in xxx ms
➜ Local: http://localhost:5173/
```

### Terminal 3: Stripe CLI (from Step 5)

Keep the `stripe listen` command running.

## Step 7: Test the Full Flow

### 7.1 Create an Account

1. Open http://localhost:5173
2. Click on the user icon in the title bar
3. Sign up with a test email
4. Check your email for verification (or disable email confirmation in Supabase)

### 7.2 Test Import Without Subscription

1. Sign in to your account
2. Try to import a .3dm file (drag & drop or click "Choose File")
3. You should see: **"Subscription Required"** toast

### 7.3 Subscribe via Stripe

1. Click on your email in the title bar → **Dashboard**
2. Click **Subscribe** on the Student plan
3. You'll be redirected to Stripe Checkout
4. Use test card: `4242 4242 4242 4242`
   - Any future expiry date (e.g., 12/34)
   - Any CVC (e.g., 123)
   - Any billing details
5. Complete the payment
6. You'll be redirected back to the app

### 7.4 Verify Webhook Processed

In your Stripe CLI terminal, you should see:
```
2026-01-28 ... customer.subscription.created [200 OK]
```

In your backend terminal:
```
💰 Processing subscription created for customer cus_...
```

### 7.5 Test Import With Subscription

1. Try to import a .3dm file again
2. It should now work! You'll see: **"Model imported successfully"**

## Useful Commands

### Check Subscription Status Manually

```bash
# Get your JWT token from browser dev tools (Application → Local Storage → sb-xxx-auth-token)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/stripe/payment-status
```

Expected response:
```json
{"hasActivePlan":true,"plan":"student","status":"active"}
```

### Trigger Test Webhook Events

```bash
# Test subscription created
stripe trigger customer.subscription.created

# Test subscription canceled
stripe trigger customer.subscription.deleted

# Test payment failed
stripe trigger invoice.payment_failed
```

### Check Database Directly

In Supabase SQL Editor:
```sql
-- View all subscriptions
SELECT * FROM subscriptions;

-- Check specific user
SELECT * FROM subscriptions WHERE user_id = 'your-user-id';
```

## Stripe Test Cards

| Card Number | Description |
|-------------|-------------|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0027 6000 3184` | Requires authentication |

[Full list of test cards](https://stripe.com/docs/testing#cards)

## Troubleshooting

### "Subscription Required" even after paying

**Cause**: Webhook didn't process

**Fix**:
1. Check Stripe CLI terminal for errors
2. Check backend terminal for errors
3. Verify `STRIPE_WEBHOOK_SECRET` matches the CLI output
4. Restart backend after changing `.env`

### "Invalid or expired token"

**Cause**: JWT token expired or invalid

**Fix**:
1. Sign out and sign back in
2. Check `SUPABASE_SERVICE_ROLE_KEY` is correct in backend

### Backend won't start

**Cause**: Missing environment variables

**Fix**:
1. Check all required vars are in `backend/.env`
2. Make sure no trailing spaces in values
3. Restart with `npm start`

### Webhook signature verification failed

**Cause**: Wrong webhook secret

**Fix**:
1. Stop and restart `stripe listen`
2. Copy the new `whsec_...` value
3. Update `backend/.env`
4. Restart backend

### CORS errors

**Cause**: Backend not running or wrong URL

**Fix**:
1. Make sure backend is running on port 3000
2. Check `VITE_BACKEND_URL=http://localhost:3000` in frontend `.env`

## Project Structure

```
0studio/
├── .env                    # Frontend env vars
├── src/                    # React frontend
│   ├── contexts/
│   │   └── ModelContext.tsx    # Import gating logic here
│   └── lib/
│       └── subscription-service.ts  # Subscription helper
├── backend/
│   ├── .env               # Backend env vars
│   └── server.js          # Express server with Stripe
└── ...
```

## Next Steps

Once local development is working:

1. **Deploy to production**: See `AWS_BACKEND_DEPLOYMENT.md`
2. **Switch to live keys**: Replace `pk_test_`/`sk_test_` with `pk_live_`/`sk_live_`
3. **Create production webhook**: In Stripe Dashboard, not CLI
4. **Build for distribution**: `npm run build:all`

## Quick Reference

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:3000 |
| Backend Health | http://localhost:3000/health |
| Stripe Dashboard | https://dashboard.stripe.com/test |
| Supabase Dashboard | https://supabase.com/dashboard |
