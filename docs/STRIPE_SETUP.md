# Stripe Integration Setup Guide

This guide explains how to set up Stripe payment integration for the 0studio application.

## Prerequisites

1. **Stripe Account**: Create an account at https://stripe.com
2. **Stripe Products & Prices**: Create products and prices in your Stripe Dashboard

## Environment Variables

Add these to your `.env` file in the backend directory:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...  # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...  # Webhook signing secret (get from Stripe Dashboard)
```

For the frontend, add to your root `.env`:

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...  # Your Stripe publishable key
VITE_BACKEND_URL=http://localhost:3000  # Backend API URL
```

## Supabase Database Setup

Run this SQL in your Supabase SQL Editor to create the subscriptions table:

```sql
-- Create subscriptions table
create table subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  plan text not null check (plan in ('student', 'enterprise')),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due', 'trialing')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Enable Row Level Security
alter table subscriptions enable row level security;

-- Policy: Users can view their own subscriptions
create policy "Users can view their own subscriptions"
  on subscriptions for select
  using (auth.uid() = user_id);

-- Policy: Service role can manage all subscriptions (for webhooks)
create policy "Service role can manage subscriptions"
  on subscriptions for all
  using (true)
  with check (true);

-- Create index for faster lookups
create index subscriptions_user_id_idx on subscriptions(user_id);
create index subscriptions_stripe_customer_id_idx on subscriptions(stripe_customer_id);
```

## Stripe Dashboard Setup

1. **Create Products & Prices**:
   - Go to Products in Stripe Dashboard
   - Create a product: "0studio Frictionless - Student"
   - Set price to $10.00/month (recurring)
   - Note the `lookup_key` (e.g., `0studio_Fricionless_-_Student-a712856`)
   - Repeat for Enterprise plan if needed

2. **Set up Webhook**:
   - Go to Developers → Webhooks in Stripe Dashboard
   - **For Local Development (Testing)**:
     - Use Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
     - This will give you a webhook signing secret for local testing
   - **For Production**:
     - Add endpoint: `https://your-backend-domain.com/api/stripe/webhook`
     - Replace `your-backend-domain.com` with your actual deployed backend URL
     - Example: `https://api.0studio.com/api/stripe/webhook` or `https://0studio-backend.herokuapp.com/api/stripe/webhook`
   - **Select these events to listen for** (under "Subscriptions" or "Customers" section):
     - ✅ `customer.subscription.created` - When subscription is first created (REQUIRED)
     - ✅ `customer.subscription.updated` - When subscription status changes (REQUIRED)
     - ✅ `customer.subscription.deleted` - When subscription is canceled (REQUIRED)
   - Copy the webhook signing secret to your `.env` file

   **Why these events?**
   - `customer.subscription.created`: Creates subscription record when user subscribes
   - `customer.subscription.updated`: Keeps subscription status in sync (handles renewals, payment failures, etc.)
   - `customer.subscription.deleted`: Marks subscription as canceled
   
   **Note:** You don't need invoice events! Stripe automatically updates the subscription status when payments succeed or fail, and `customer.subscription.updated` will fire with the new status (active, past_due, etc.).

   **Note:** The webhook handler works with subscription events directly, so you don't need `checkout.session.completed` - `customer.subscription.created` will handle new subscriptions.

## Testing

1. Use Stripe test mode keys for development
2. Use test card numbers from: https://stripe.com/docs/testing
3. Test the checkout flow end-to-end

## Installation

Run these commands to install required packages:

```bash
# Backend
cd backend
npm install stripe

# Frontend
cd ..
npm install @stripe/stripe-js
```

## Subscription-Gated Features

The subscription system is integrated with feature access control. See:

- **`SUBSCRIPTION_GATING_SETUP.md`** - Complete setup guide for subscription-gated features
- **`SUBSCRIPTION_RLS_POLICY.sql`** - Database-level security policies
- **`src/lib/subscription-service.ts`** - Helper functions for checking subscription status

Features currently gated by subscription:
- ✅ 3D Model Import (requires active subscription)

The implementation includes three layers of protection:
1. Frontend UI checks (UX)
2. Backend API validation (security)
3. Database RLS policies (defense-in-depth)

## Production Deployment

For deploying the backend to production (required for Homebrew distribution), see:

- **`AWS_BACKEND_DEPLOYMENT.md`** - Complete guide for deploying to AWS App Runner

### Quick Checklist for Production

1. Deploy backend to AWS (see `AWS_BACKEND_DEPLOYMENT.md`)
2. Update `VITE_BACKEND_URL` to your AWS URL
3. Create production Stripe webhook pointing to AWS backend
4. Switch to live Stripe keys (`pk_live_`, `sk_live_`)
5. Rebuild app with `npm run build:all`

