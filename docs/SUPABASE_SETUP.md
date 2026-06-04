# Supabase & AWS S3 Setup Guide

This document outlines the setup steps for the new Supabase authentication and cloud storage integration.

## Prerequisites

1. **Install Supabase client** (if not already installed):
   ```bash
   npm install @supabase/supabase-js
   ```

2. **Supabase Project**: Create a project at https://supabase.com

3. **AWS S3 Bucket**: Set up an S3 bucket with versioning enabled (for later integration)

## Environment Variables

Create a `.env` file in the project root (or add to existing `.env`):

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_AWS_API_URL=http://localhost:3000/api/aws  # Optional, for backend API
```

## Supabase Database Setup

Run the following SQL in your Supabase SQL Editor:

```sql
-- ============================================================
-- CORE TABLES - Projects, Models, Model Versions
-- ============================================================

-- 1. Projects: Each row is ONE project/workspace
create table if not exists projects (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references auth.users(id) not null,
  org_id uuid null, -- For enterprise team projects
  name text not null,
  created_at timestamptz default now()
);

-- 2. Models: Each row is ONE model file within a project
create table if not exists models (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

-- 3. Model Versions: Explicit versioning (v1, v2, v3...)
-- Each version is stored as a separate S3 object
-- S3 key format: users/{user_id}/projects/{project_id}/models/{model_id}/versions/{version_name}-{original_file_name}
create table if not exists model_versions (
  id uuid default gen_random_uuid() primary key,
  model_id uuid references models(id) on delete cascade not null,
  s3_key text not null,
  version_name text not null, -- e.g., "v1", "v2", "v12"
  file_size bigint default 0,
  uploaded_by uuid references auth.users(id) not null,
  is_current boolean default true,
  created_at timestamptz default now()
);

-- 4. Project Members: Team-based access control (enterprise feature)
create table if not exists project_members (
  project_id uuid references projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  role text not null default 'viewer', -- 'owner', 'editor', 'viewer'
  created_at timestamptz default now(),
  primary key (project_id, user_id)
);

-- ============================================================
-- SUBSCRIPTIONS TABLE (for Stripe payment integration)
-- ============================================================

-- 5. Subscriptions: User payment subscriptions (managed by Stripe webhooks)
create table if not exists subscriptions (
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

-- Enable Row Level Security on subscriptions
alter table subscriptions enable row level security;

-- Policy: Users can view their own subscriptions
create policy "Users can view their own subscriptions"
  on subscriptions for select
  using (auth.uid() = user_id);

-- Policy: Service role can manage all subscriptions (for webhooks)
-- Note: This requires using service_role key in backend
create policy "Service role can manage subscriptions"
  on subscriptions for all
  using (true)
  with check (true);

-- Create indexes for faster lookups
create index if not exists subscriptions_user_id_idx on subscriptions(user_id);
create index if not exists subscriptions_stripe_customer_id_idx on subscriptions(stripe_customer_id);

-- ============================================================
-- LEGACY TABLES - Commits and Branches (for local version control)
-- ============================================================

-- 6. Commits: Each row is ONE file version (legacy, for local VC)
create table if not exists commits (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  parent_commit_id uuid references commits(id),
  message text,
  author_id uuid references auth.users(id),
  s3_version_id text not null, -- The AWS Version ID (legacy)
  created_at timestamptz default now()
);

-- 6. Branches: Pointers to specific commits
create table if not exists branches (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  head_commit_id uuid references commits(id),
  unique (project_id, name)
);

-- ============================================================
-- INDEXES for better query performance
-- ============================================================
create index if not exists idx_models_project_id on models(project_id);
create index if not exists idx_model_versions_model_id on model_versions(model_id);
create index if not exists idx_model_versions_is_current on model_versions(is_current);
create index if not exists idx_project_members_user_id on project_members(user_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table projects enable row level security;
alter table models enable row level security;
alter table model_versions enable row level security;
alter table project_members enable row level security;
alter table commits enable row level security;
alter table branches enable row level security;

-- ============================================================
-- POLICIES: Projects
-- Users can access their own projects OR projects they are members of
-- ============================================================

create policy "Users can view their own projects"
  on projects for select
  using (
    auth.uid() = owner_id 
    OR exists (
      select 1 from project_members
      where project_members.project_id = projects.id
      and project_members.user_id = auth.uid()
    )
  );

create policy "Users can create their own projects"
  on projects for insert
  with check (auth.uid() = owner_id);

create policy "Users can update their own projects"
  on projects for update
  using (auth.uid() = owner_id);

create policy "Users can delete their own projects"
  on projects for delete
  using (auth.uid() = owner_id);

-- ============================================================
-- POLICIES: Models
-- Users can access models for projects they have access to
-- ============================================================

create policy "Users can view models for their projects"
  on models for select
  using (
    exists (
      select 1 from projects
      where projects.id = models.project_id
      and (
        projects.owner_id = auth.uid()
        OR exists (
          select 1 from project_members
          where project_members.project_id = projects.id
          and project_members.user_id = auth.uid()
        )
      )
    )
  );

create policy "Users can create models for their projects"
  on models for insert
  with check (
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
  );

create policy "Users can update models for their projects"
  on models for update
  using (
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
  );

create policy "Users can delete models for their projects"
  on models for delete
  using (
    exists (
      select 1 from projects
      where projects.id = models.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- ============================================================
-- POLICIES: Model Versions
-- Users can access versions for models they have access to
-- ============================================================

create policy "Users can view versions for their models"
  on model_versions for select
  using (
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
        )
      )
    )
  );

create policy "Users can create versions for their models"
  on model_versions for insert
  with check (
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
  );

create policy "Users can update versions for their models"
  on model_versions for update
  using (
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
  );

-- ============================================================
-- POLICIES: Project Members (Enterprise feature)
-- Only project owners can manage members
-- ============================================================

create policy "Users can view members for their projects"
  on project_members for select
  using (
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and (
        projects.owner_id = auth.uid()
        OR project_members.user_id = auth.uid()
      )
    )
  );

create policy "Owners can add members to their projects"
  on project_members for insert
  with check (
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Owners can update members in their projects"
  on project_members for update
  using (
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Owners can remove members from their projects"
  on project_members for delete
  using (
    exists (
      select 1 from projects
      where projects.id = project_members.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- ============================================================
-- POLICIES: Commits (Legacy)
-- ============================================================

create policy "Users can view commits for their projects"
  on commits for select
  using (
    exists (
      select 1 from projects
      where projects.id = commits.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Users can create commits for their projects"
  on commits for insert
  with check (
    exists (
      select 1 from projects
      where projects.id = commits.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- ============================================================
-- POLICIES: Branches (Legacy)
-- ============================================================

create policy "Users can view branches for their projects"
  on branches for select
  using (
    exists (
      select 1 from projects
      where projects.id = branches.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Users can create branches for their projects"
  on branches for insert
  with check (
    exists (
      select 1 from projects
      where projects.id = branches.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Users can update branches for their projects"
  on branches for update
  using (
    exists (
      select 1 from projects
      where projects.id = branches.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Users can delete branches for their projects"
  on branches for delete
  using (
    exists (
      select 1 from projects
      where projects.id = branches.project_id
      and projects.owner_id = auth.uid()
    )
  );
```

## Features Implemented

### ✅ Authentication
- **AuthContext**: Manages user session state
- **Auth Components**: Login, Signup, Password Reset dialogs
- **UserMenu**: Display user email and sign out button in TitleBar
- **Session Management**: Auto-refresh tokens, persist sessions

### ✅ Supabase API Service
- **Projects**: CRUD operations for projects
- **Commits**: Create, read, and query commits with parent relationships
- **Branches**: Create, read, update, and delete branches
- **Error Handling**: Toast notifications for errors

### ✅ AWS S3 API Service (Dummy)
- **Presigned URLs**: Methods for upload/download URLs
- **File Upload**: Upload with version ID tracking
- **File Download**: Download specific versions
- **S3 Key Generation**: Helper for generating S3 paths

## Next Steps

### 1. Backend API for AWS S3
The `aws-api.ts` service currently has dummy implementations. You need to create a backend API that:

- Generates presigned URLs for S3 uploads/downloads
- Handles file uploads and captures `x-amz-version-id` headers
- Generates presigned URLs with `VersionId` parameter for downloads
- Lists file versions
- Deletes specific file versions

**Example Backend Endpoint** (Node.js/Express):
```javascript
// GET /api/aws/presigned-upload?key=...
app.get('/api/aws/presigned-upload', async (req, res) => {
  const { key } = req.query;
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  res.json({ url, expiresIn: 3600 });
});
```

### 2. Enable S3 Versioning
In your AWS S3 bucket settings, enable versioning:
```bash
aws s3api put-bucket-versioning \
  --bucket your-bucket-name \
  --versioning-configuration Status=Enabled
```

### 3. Integration with VersionControlContext
Update `VersionControlContext` to:
- Create projects in Supabase when opening a file
- Store commits in Supabase with S3 version IDs
- Fetch commit history from Supabase
- Restore commits by downloading from S3

### 4. Project Management
Add UI for:
- Listing user's projects
- Creating new projects
- Switching between projects
- Project settings

## Testing

1. **Test Authentication**:
   - Sign up with a new email
   - Check email for verification link
   - Sign in with credentials
   - Verify UserMenu shows email
   - Test sign out

2. **Test Supabase API**:
   - Create a project via `supabaseAPI.createProject()`
   - Create commits via `supabaseAPI.createCommit()`
   - Query commits via `supabaseAPI.getCommits()`
   - Create branches via `supabaseAPI.createBranch()`

3. **Test AWS API** (after backend is set up):
   - Get presigned upload URL
   - Upload a file and capture version ID
   - Get presigned download URL for specific version
   - Download file from S3

## Architecture Notes

- **S3 Storage**: Files are stored with versioning enabled. Each commit stores the S3 version ID.
- **Delta Commits**: When creating a new commit, only changed files get new S3 versions. Unchanged files reference the same version ID.
- **Database as Commit Log**: Supabase acts as the "commit log" tracking which S3 version ID belongs to each commit.
- **Row Level Security**: All tables have RLS enabled so users can only access their own data.

