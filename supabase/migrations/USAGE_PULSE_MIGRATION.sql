-- ============================================================
-- USAGE PULSE / WEEKLY FOUNDER DIGEST TABLES
-- Run this SQL in your Supabase SQL Editor to create the
-- usage_pulse, digest_runs, and digest_recipients tables that
-- back the Weekly Founder Digest job.
--
-- See docs/plans/2026-04-28-001-feat-weekly-founder-digest-plan.md
-- and docs/brainstorms/2026-04-28-weekly-founder-digest-requirements.md
-- ============================================================

-- ============================================================
-- STEP 1: USAGE_PULSE TABLE
-- One row per (user, week_start). Snapshot of per-user metrics
-- written by the Sunday digest job, queryable for ad-hoc analysis.
-- ============================================================

create table if not exists usage_pulse (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  user_email text,
  week_start date not null,                          -- ISO Monday 00:00 UTC
  -- Activity
  logged_in boolean default false,                   -- last_sign_in_at within week
  last_sign_in_at timestamptz,
  commits_made integer default 0 not null,
  active_projects integer default 0 not null,
  active_branches integer default 0 not null,
  used_cloud_sync boolean default false,             -- any S3 commit blob this week
  -- Plan snapshot (enables week-over-week diff for free->Pro detection)
  plan_status text default 'free' not null
    check (plan_status in ('free', 'active', 'canceled', 'past_due', 'trialing')),
  -- Cohort
  signup_week date,                                  -- ISO week of auth.users.created_at
  weeks_since_signup integer,
  -- Risk markers (computed from this row's data + lookback)
  silent_paying_user boolean default false,          -- plan='active' AND no commits 14d
  projects_silenced_count integer default 0 not null,
  conversion_candidate boolean default false,       -- free + >=3 commits + >=2 projects
  -- Audit
  computed_at timestamptz default now() not null,
  unique (user_id, week_start)
);

-- Indexes for common digest + ad-hoc query patterns
create index if not exists idx_usage_pulse_week_start
  on usage_pulse(week_start);
create index if not exists idx_usage_pulse_user_id
  on usage_pulse(user_id);
create index if not exists idx_usage_pulse_plan_week
  on usage_pulse(plan_status, week_start);

-- ============================================================
-- STEP 2: DIGEST_RUNS TABLE
-- Lease lock for idempotency. INSERT ON CONFLICT DO NOTHING on
-- the week_start primary key prevents duplicate digests when
-- cron retries or autoscaling double-fires.
-- ============================================================

create table if not exists digest_runs (
  week_start date primary key,                       -- one run per week, period
  started_at timestamptz default now() not null,
  finished_at timestamptz,
  status text default 'running' not null
    check (status in ('running', 'ok', 'partial', 'failed', 'noop_already_ran')),
  errors jsonb,                                      -- { fatal, slack, email: { addr: msg } }
  recipients_sent integer default 0,
  slack_sent boolean default false
);

-- ============================================================
-- STEP 3: DIGEST_RECIPIENTS TABLE
-- Founder allowlist for digest emails. Hot-reloaded each run so
-- adding/removing a founder does not require a redeploy.
-- ============================================================

create table if not exists digest_recipients (
  id uuid default gen_random_uuid() primary key,
  email text not null unique,
  role text default 'founder' not null
    check (role in ('founder', 'observer')),
  added_at timestamptz default now() not null,
  active boolean default true not null
);

-- ============================================================
-- STEP 4: ENABLE ROW LEVEL SECURITY
-- All three tables are admin-only. The backend uses the
-- service-role key (which bypasses RLS) for both writes and the
-- Supabase SQL editor's ad-hoc reads. Anon and authed clients
-- get deny-all because no policies are defined.
-- ============================================================

alter table usage_pulse enable row level security;
alter table digest_runs enable row level security;
alter table digest_recipients enable row level security;

-- (Intentionally no policies. Service role bypasses RLS; anon
-- and authed roles get implicit deny-all.)

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Confirm tables exist (service role)
-- select table_name from information_schema.tables
--   where table_schema = 'public'
--   and table_name in ('usage_pulse', 'digest_runs', 'digest_recipients');

-- Confirm RLS is enabled on all three
-- select tablename, rowsecurity from pg_tables
--   where tablename in ('usage_pulse', 'digest_runs', 'digest_recipients');

-- Confirm zero policies (deny-all for anon/authed)
-- select tablename, count(*) as policy_count from pg_policies
--   where tablename in ('usage_pulse', 'digest_runs', 'digest_recipients')
--   group by tablename;

-- Spot check: latest digest run
-- select * from digest_runs order by started_at desc limit 5;

-- Spot check: who's a recipient?
-- select email, role, active from digest_recipients order by added_at;

-- ============================================================
-- ADDING FOUNDERS TO THE RECIPIENTS LIST (one-time, post-deploy)
-- Replace the email values with real founder addresses. Each
-- address must be SES-verified before the digest job will mail
-- them (see docs/DIGEST_OPS.md).
-- ============================================================

-- insert into digest_recipients (email, role) values
--   ('founder1@example.com', 'founder'),
--   ('founder2@example.com', 'founder')
-- on conflict (email) do nothing;

-- ============================================================
-- NOTES
-- ============================================================

-- 1. PRIMARY KEYS:
--    - usage_pulse: surrogate uuid id; uniqueness on (user_id, week_start) for upserts
--    - digest_runs: week_start IS the primary key (one row per week, the lease lock)
--    - digest_recipients: surrogate uuid id; email is uniquely indexed
--
-- 2. WEEK SEMANTICS:
--    week_start is always Monday 00:00 UTC (ISO week start). Stored as DATE
--    (no time/timezone). The digest job computes this via
--    `date-fns startOfWeek(d, { weekStartsOn: 1 })`.
--
-- 3. plan_status VALUES:
--    'free'     - User exists in auth.users but has no subscription row
--    'active'   - Stripe webhook reported an active subscription
--    'canceled' - Subscription canceled (pending end-of-period for some)
--    'past_due' - Payment failed
--    'trialing' - Stripe trial period
--
--    The 'free' value extends the existing subscriptions.status enum so the
--    digest can do free-vs-paid splits without left-joining.
--
-- 4. RLS POSTURE (KD11):
--    Service role bypasses RLS. Anon/authed clients get implicit deny-all
--    because no policies are defined on these tables. The Supabase SQL
--    Editor uses the service role, so ad-hoc founder queries work cleanly.
--
-- 5. RE-RUN A FAILED WEEK (manual):
--    delete from usage_pulse where week_start = 'YYYY-MM-DD';
--    delete from digest_runs where week_start = 'YYYY-MM-DD';
--    Then POST /api/admin/digest/run with body { "week_start": "YYYY-MM-DD" }.
