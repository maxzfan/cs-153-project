# Subscription-Gated 3D Model Import Setup Guide

This guide walks you through implementing a complete subscription-based gating system for the 3D model import feature in 0studio.

## Overview

The implementation includes three layers of protection:

1. **Frontend UI Check** - Validates auth and subscription before import ✅ **ACTIVE**
2. **Backend API Check** - Verifies subscription status via `/api/stripe/payment-status` ✅ **ACTIVE**
3. **Database RLS Policy** - Enforces subscription requirement at the database level ⏳ **FOR FUTURE USE**

> **Note**: Currently, 0studio stores all version control data locally in the `0studio_{filename}/` folder. 
> The RLS policies are prepared for when cloud sync is implemented. The frontend check is the 
> primary protection mechanism for now.

## Prerequisites

- ✅ Supabase project set up with authentication
- ✅ Stripe account with a $5/month subscription plan
- ✅ Backend server running with Stripe webhook integration
- ✅ `subscriptions` table created in Supabase (from STRIPE_SETUP.md)

## Step 1: Verify Stripe Setup

### 1.1 Check Your Stripe Product

1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Verify your subscription product exists (e.g., "$5/month plan")
3. Copy the **Price ID** (starts with `price_`)

### 1.2 Set Up Stripe Webhooks

For **local development**:
```bash
# Terminal 1: Start your backend
cd backend
npm start

# Terminal 2: Start Stripe CLI webhook forwarding
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

The Stripe CLI will output a webhook signing secret (starts with `whsec_`). Add it to your `backend/.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

For **production**:
1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://your-backend-url.com/api/stripe/webhook`
3. Select these events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret and add to your production backend env vars

## Step 2: Set Up Database RLS Policies

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Open the file `SUBSCRIPTION_RLS_POLICY.sql` in this repository
4. Copy and paste the entire SQL script
5. Click **Run** to execute

This will create policies that enforce:
- Only users with `status = 'active'` in the `subscriptions` table can create models
- Only active subscribers can upload model versions

## Step 3: Update Environment Variables

Make sure your `.env` file has:

```env
# Frontend (.env in root)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_BACKEND_URL=http://localhost:3000
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here

# Backend (backend/.env)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

## Step 4: Testing the Implementation

### 4.1 Test Without Authentication

1. Make sure you're signed out
2. Try to import a 3D model (drag & drop or click "Choose File")
3. **Expected Result**: Toast message "Authentication Required - Please sign in to import 3D models"

### 4.2 Test Without Subscription

1. Sign up for a new account (or sign in)
2. Do NOT subscribe yet
3. Try to import a 3D model
4. **Expected Result**: Toast message "Subscription Required - An active subscription is required to import 3D models"

### 4.3 Test With Active Subscription

1. While signed in, go through the Stripe checkout flow
2. Use Stripe test card: `4242 4242 4242 4242` (any future expiry, any CVC)
3. Complete the payment
4. **Wait 2-5 seconds** for the webhook to process
5. Try to import a 3D model
6. **Expected Result**: Model imports successfully with "Model imported successfully" toast

### 4.4 Test Subscription Status Query

You can manually test the subscription check in your browser console:

```javascript
// Open browser console on your app
const response = await fetch('http://localhost:3000/api/stripe/payment-status', {
  headers: {
    'Authorization': `Bearer ${supabase.auth.getSession().then(s => s.data.session.access_token)}`
  }
});
const data = await response.json();
console.log(data);
// Should show: { hasActivePlan: true, plan: 'student', status: 'active' }
```

### 4.5 Test Database-Level Protection (Advanced)

This tests that even if someone bypasses the UI, the database still blocks them:

1. Sign in without a subscription
2. Open browser console
3. Try to directly insert into the database:
   ```javascript
   const { error } = await supabase
     .from('models')
     .insert({ name: 'Test Model', project_id: 'some-project-id' });
   console.log(error); // Should show RLS policy error
   ```
4. **Expected Result**: Error message about RLS policy violation

## Step 5: Monitoring Webhook Events

To see webhook events being processed:

```bash
# In your backend terminal, watch for these logs:
# ✅ customer.subscription.created - when user subscribes
# ✅ customer.subscription.updated - when payment succeeds/fails
# ✅ customer.subscription.deleted - when user cancels
```

Check the `subscriptions` table in Supabase to see the records:

```sql
select * from subscriptions order by created_at desc;
```

## Step 6: Handle Edge Cases

### What if webhook fails?

If the webhook fails to process, the subscription won't be recorded. Options:

1. **Automatic retry**: Stripe retries webhooks automatically
2. **Manual sync**: Create a backend endpoint to sync subscription status:
   ```javascript
   // GET /api/stripe/sync-subscription
   // Fetches subscription from Stripe and updates Supabase
   ```

### What if user cancels?

When a user cancels their subscription:
1. Stripe sends `customer.subscription.deleted` webhook
2. Backend updates `status` to `'canceled'` in Supabase
3. User can no longer import models
4. Existing models remain accessible (read-only)

### What if payment fails?

When a payment fails:
1. Stripe sends `customer.subscription.updated` with `status = 'past_due'`
2. Backend updates status in Supabase
3. User loses import access until payment succeeds

## Implementation Details

### Files Modified

1. **`src/lib/subscription-service.ts`** (NEW)
   - `checkSubscriptionStatus()` - Main validation function
   - `getSubscriptionDetails()` - Detailed subscription info

2. **`src/contexts/ModelContext.tsx`** (MODIFIED)
   - Added auth check in `importFile()`
   - Added subscription check in `importFile()`
   - Added same checks to Electron file dialog handler

3. **`backend/server.js`** (ALREADY EXISTS)
   - `/api/stripe/create-checkout-session` - Creates Stripe checkout
   - `/api/stripe/webhook` - Processes subscription events
   - `/api/stripe/payment-status` - Returns user's subscription status

4. **`SUBSCRIPTION_RLS_POLICY.sql`** (NEW)
   - RLS policies for `models` table
   - RLS policies for `model_versions` table

### User Flow Diagram

```
User clicks "Import Model"
  ↓
Frontend: Check if user is authenticated
  ├─ NO → Show "Authentication Required" toast
  └─ YES → Continue
      ↓
Frontend: Call checkSubscriptionStatus()
  ├─ Returns false → Show "Subscription Required" toast
  └─ Returns true → Continue
      ↓
Frontend: Load and import model
  ↓
(If uploading to Supabase) Database: Check RLS policy
  ├─ No active subscription → REJECT insert
  └─ Active subscription → ALLOW insert
      ↓
Success! Model imported
```

## Troubleshooting

### Issue: "Subscription Required" shown even after subscribing

**Cause**: Webhook hasn't processed yet or failed

**Solution**:
1. Check backend logs for webhook errors
2. Check Stripe Dashboard → Webhooks → Events
3. Query subscriptions table: `select * from subscriptions where user_id = 'YOUR_USER_ID';`
4. If missing, manually trigger a sync or re-subscribe

### Issue: Webhook signature verification fails

**Cause**: Wrong `STRIPE_WEBHOOK_SECRET` in backend

**Solution**:
1. For local dev: Use secret from `stripe listen` command
2. For production: Use secret from Stripe Dashboard → Webhooks
3. Restart backend after updating `.env`

### Issue: Database still allows inserts without subscription

**Cause**: RLS policies not applied correctly

**Solution**:
1. Run `select * from pg_policies where tablename = 'models';` to verify policies exist
2. Re-run the `SUBSCRIPTION_RLS_POLICY.sql` script
3. Check that the `subscriptions` table has correct data

### Issue: Frontend shows success but backend rejects

**Cause**: Frontend and backend out of sync

**Solution**:
1. Clear browser cache and reload
2. Sign out and sign back in
3. Call `/api/stripe/payment-status` to verify backend sees subscription

## Next Steps

### Optional Enhancements

1. **Grace Period**: Allow users to keep importing for X days after payment fails
   ```sql
   -- Modify RLS policy to check subscription end date
   and (status = 'active' OR (status = 'past_due' and updated_at > now() - interval '7 days'))
   ```

2. **Usage Limits**: Track number of imports per month
   ```sql
   -- Add import_count column to subscriptions table
   -- Increment on each import
   -- Reset monthly via cron job
   ```

3. **Trial Period**: Give new users 3 free imports
   ```sql
   -- Add trial_imports_remaining column
   -- Check in RLS policy
   ```

4. **Team Plans**: Allow multiple users to share a subscription
   ```sql
   -- Add team_id column to subscriptions
   -- Allow all team members to import
   ```

## Support

If you encounter issues:

1. Check backend logs: `cd backend && npm start`
2. Check browser console for errors
3. Check Stripe Dashboard → Events for webhook delivery
4. Check Supabase Dashboard → Table Editor → subscriptions

## Security Notes

🔒 **Defense in Depth**: This implementation uses three layers:
- UI check (can be bypassed by advanced users)
- Backend API check (requires valid JWT token)
- Database RLS policy (enforced by PostgreSQL)

Even if a user bypasses the UI, the backend and database will still enforce the subscription requirement.

🔑 **Never expose service_role key**: Always use `SUPABASE_ANON_KEY` in frontend, and `SUPABASE_SERVICE_ROLE_KEY` only in backend.

📊 **Audit Trail**: All subscription events are logged in Stripe Dashboard → Events for compliance and debugging.
