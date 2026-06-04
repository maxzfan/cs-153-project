-- ============================================================
-- SUBSCRIPTION-GATED RLS POLICIES
-- Run this SQL in your Supabase SQL Editor to enforce 
-- subscription requirements at the database level
-- ============================================================

-- IMPORTANT: This is for FUTURE cloud storage integration.
-- Currently, 0studio stores models locally in the 0studio_{filename}/ folder.
-- These policies will take effect when cloud sync is implemented.

-- ============================================================
-- NOTE ON RLS POLICY LOGIC
-- ============================================================
-- PostgreSQL RLS uses OR logic for multiple policies of the same
-- command type. If you ADD a new policy, it won't block users who
-- pass existing policies. Therefore, we need to REPLACE existing
-- policies with ones that combine ownership AND subscription checks.

-- ============================================================
-- STEP 1: DROP EXISTING POLICIES (if they exist)
-- ============================================================

-- Models table
drop policy if exists "Users can create models for their projects" on models;
drop policy if exists "Only active subscribers can create models" on models;

-- Model versions table  
drop policy if exists "Users can create versions for their models" on model_versions;
drop policy if exists "Only active subscribers can upload versions" on model_versions;

-- ============================================================
-- STEP 2: CREATE NEW COMBINED POLICIES
-- These policies require BOTH:
--   1. User has access to the project (owner or editor member)
--   2. User has an active subscription
-- ============================================================

-- Policy for models: Requires project access AND active subscription
create policy "Users can create models for their projects"
  on models for insert
  with check (
    -- Check 1: User has access to the project
    exists (
      select 1 from projects
      where projects.id = models.project_id
      and (
        projects.owner_id = auth.uid()
        OR exists (
          select 1 from project_members
          where project_members.project_id = projects.id
          and project_members.user_id = auth.uid()
          and project_members.role in ('owner', 'editor')
        )
      )
    )
    -- Check 2: User has an active subscription
    AND exists (
      select 1 from subscriptions
      where subscriptions.user_id = auth.uid() 
      and subscriptions.status = 'active'
    )
  );

-- Policy for model_versions: Requires model access AND active subscription
create policy "Users can create versions for their models"
  on model_versions for insert
  with check (
    -- Check 1: User has access to the model's project
    exists (
      select 1 from models
      join projects on projects.id = models.project_id
      where models.id = model_versions.model_id
      and (
        projects.owner_id = auth.uid()
        OR exists (
          select 1 from project_members
          where project_members.project_id = projects.id
          and project_members.user_id = auth.uid()
          and project_members.role in ('owner', 'editor')
        )
      )
    )
    -- Check 2: User has an active subscription
    AND exists (
      select 1 from subscriptions
      where subscriptions.user_id = auth.uid() 
      and subscriptions.status = 'active'
    )
  );

-- ============================================================
-- OPTIONAL: Storage bucket policy (if using Supabase Storage)
-- Uncomment if you're storing 3D models in Supabase Storage
-- ============================================================

-- drop policy if exists "Only active subscribers can upload to storage" on storage.objects;
-- 
-- create policy "Authenticated users can upload to their folder with subscription"
--   on storage.objects for insert
--   to authenticated
--   with check (
--     bucket_id = 'models' 
--     -- User can only upload to their own folder
--     and (storage.foldername(name))[1] = auth.uid()::text
--     -- User has an active subscription
--     and exists (
--       select 1 from subscriptions
--       where user_id = auth.uid() 
--       and status = 'active'
--     )
--   );

-- ============================================================
-- VERIFICATION QUERIES
-- Run these to verify your policies are working correctly
-- ============================================================

-- Check all policies on models table
-- select * from pg_policies where tablename = 'models';

-- Check all policies on model_versions table
-- select * from pg_policies where tablename = 'model_versions';

-- Check if a specific user has an active subscription
-- select * from subscriptions where user_id = 'YOUR_USER_ID_HERE';

-- Test if subscription check would pass for current user
-- select exists (
--   select 1 from subscriptions 
--   where user_id = auth.uid() 
--   and status = 'active'
-- ) as has_active_subscription;

-- ============================================================
-- SUBSCRIPTIONS TABLE REFERENCE (from STRIPE_SETUP.md)
-- ============================================================
-- The subscriptions table should already exist with this schema:
--
-- create table subscriptions (
--   id uuid default gen_random_uuid() primary key,
--   user_id uuid references auth.users(id) on delete cascade not null,
--   plan text not null check (plan in ('student', 'enterprise')),
--   stripe_customer_id text,
--   stripe_subscription_id text,
--   status text not null default 'active' 
--     check (status in ('active', 'canceled', 'past_due', 'trialing')),
--   created_at timestamptz default now(),
--   updated_at timestamptz default now(),
--   unique(user_id)
-- );
--
-- If it doesn't exist, run the SQL from STRIPE_SETUP.md first.

-- ============================================================
-- NOTES
-- ============================================================

-- 1. CURRENT STATUS: These policies are for FUTURE use.
--    0studio currently stores everything locally, not in Supabase.
--    When cloud sync is implemented, these policies will be active.

-- 2. FRONTEND CHECK: The primary protection is the frontend check
--    in ModelContext.tsx which calls checkSubscriptionStatus()
--    before allowing imports. This works for local storage.

-- 3. DEFENSE IN DEPTH: When cloud sync is added:
--    - Frontend check provides good UX (shows error message)
--    - Backend API validates JWT token
--    - RLS policies enforce at database level (can't be bypassed)

-- 4. SUBSCRIPTION STATUS VALUES:
--    - 'active': Full access (recurring payment successful)
--    - 'trialing': Could allow access if you want trial periods
--    - 'past_due': Payment failed, might want grace period
--    - 'canceled': No access

-- 5. To test (after cloud sync is implemented):
--    a. Sign up without subscribing - try to sync (should fail at RLS)
--    b. Subscribe via Stripe - try to sync (should work)
--    c. Cancel subscription - try to sync (should fail at RLS)
