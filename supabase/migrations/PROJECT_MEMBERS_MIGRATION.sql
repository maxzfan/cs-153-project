-- ============================================================
-- PROJECT MEMBERS TABLE & RLS POLICIES
-- Run this SQL in your Supabase SQL Editor to create the
-- project_members table for team collaboration features
-- ============================================================

-- ============================================================
-- STEP 1: CREATE THE PROJECT_MEMBERS TABLE
-- ============================================================

create table if not exists project_members (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  role text not null default 'viewer'
    check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'removed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast lookups
create index if not exists idx_project_members_project_id 
  on project_members(project_id);
create index if not exists idx_project_members_user_id 
  on project_members(user_id);
create index if not exists idx_project_members_email 
  on project_members(email);

-- Unique constraint: one membership per email per project (excluding removed)
-- Note: Supabase doesn't support partial unique indexes via SQL editor easily,
-- so the backend enforces uniqueness in the API layer.

-- ============================================================
-- STEP 2: ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table project_members enable row level security;

-- ============================================================
-- STEP 3: CREATE RLS POLICIES
-- ============================================================

-- Policy: Users can view members of projects they belong to
create policy "Users can view project members"
  on project_members for select
  using (
    -- User is a member of this project (active)
    exists (
      select 1 from project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
      and pm.status = 'active'
    )
    OR
    -- User owns the project
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- Policy: Project owners and editors can invite members
create policy "Owners and editors can invite members"
  on project_members for insert
  with check (
    -- User is project owner
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
    OR
    -- User is an editor on this project
    exists (
      select 1 from project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'editor')
      and pm.status = 'active'
    )
  );

-- Policy: Project owners can update member roles
create policy "Owners can update member roles"
  on project_members for update
  using (
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
    OR
    exists (
      select 1 from project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
      and pm.role = 'owner'
      and pm.status = 'active'
    )
  );

-- Policy: Project owners can remove members
create policy "Owners can remove members"
  on project_members for delete
  using (
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- ============================================================
-- STEP 4: ALSO ENSURE PROJECTS TABLE HAS RLS
-- ============================================================

-- Make sure projects table has RLS enabled
alter table projects enable row level security;

-- Drop existing policies if they exist (to avoid conflicts)
drop policy if exists "Users can view their own projects" on projects;
drop policy if exists "Users can view projects they are members of" on projects;
drop policy if exists "Users can create projects" on projects;
drop policy if exists "Owners can update projects" on projects;
drop policy if exists "Owners can delete projects" on projects;

-- Users can see their own projects or projects they are members of
create policy "Users can view their own projects"
  on projects for select
  using (
    owner_id = auth.uid()
    OR exists (
      select 1 from project_members
      where project_members.project_id = projects.id
      and project_members.user_id = auth.uid()
      and project_members.status = 'active'
    )
  );

-- Users can create projects (they become the owner)
create policy "Users can create projects"
  on projects for insert
  with check (owner_id = auth.uid());

-- Only owners can update their projects
create policy "Owners can update projects"
  on projects for update
  using (owner_id = auth.uid());

-- Only owners can delete their projects
create policy "Owners can delete projects"
  on projects for delete
  using (owner_id = auth.uid());

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check the project_members table exists
-- select * from project_members limit 5;

-- Check all policies on project_members
-- select * from pg_policies where tablename = 'project_members';

-- Check all policies on projects
-- select * from pg_policies where tablename = 'projects';

-- ============================================================
-- NOTES
-- ============================================================

-- 1. ROLE HIERARCHY:
--    owner  (3) - Full access: manage members, change roles, delete project
--    editor (2) - Can commit, create branches, pull versions, invite members
--    viewer (1) - Read-only: browse commits and branches
--
-- 2. STATUS VALUES:
--    pending  - Invited but hasn't signed in with matching email yet
--    active   - Full member with active access
--    removed  - Soft-deleted (keeps audit trail)
--
-- 3. AUTO-ACTIVATION: When a user signs up with an email that has
--    pending invitations, the backend should update status to 'active'.
--    This is handled in the backend API layer.
--
-- 4. The backend uses the service_role key to bypass RLS for
--    administrative operations. The RLS policies above protect
--    direct database access from the frontend.
