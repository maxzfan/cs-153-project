# Weekly Founder Digest — Operations Runbook

Operational guide for the Weekly Founder Digest (see `docs/plans/2026-04-28-001-feat-weekly-founder-digest-plan.md` and `docs/brainstorms/2026-04-28-weekly-founder-digest-requirements.md`).

The digest runs on a **GitHub Actions cron schedule** (Mondays 04:00 UTC = Sundays 21:00 PT) that POSTs to `POST /api/admin/digest/run` on the deployed backend. The job is idempotent (lease-locked on `digest_runs.week_start`), and reads only data users have already pushed to cloud (Supabase + S3).

---

## One-time setup (after Phase 0 ships)

### 1. Run the SQL migration

Open the Supabase SQL Editor and paste the contents of `USAGE_PULSE_MIGRATION.sql` (at the repo root). Execute. Verify with:

```sql
select tablename, rowsecurity from pg_tables
  where tablename in ('usage_pulse', 'digest_runs', 'digest_recipients');
-- expect: 3 rows, all rowsecurity = true

select tablename, count(*) as policy_count from pg_policies
  where tablename in ('usage_pulse', 'digest_runs', 'digest_recipients')
  group by tablename;
-- expect: 0 rows (no policies = deny-all to anon/authed; service role bypasses)
```

### 2. Generate and provision the shared secret

```bash
openssl rand -hex 32
```

Add the value to:
- The deployed backend's environment as `DIGEST_SHARED_SECRET`
- GitHub repo secrets as `DIGEST_SHARED_SECRET`
- (Local dev) `backend/.env`

### 3. Provision a Slack webhook

In Slack: **Apps → Incoming Webhooks → Add to Slack** for the founder channel. Copy the webhook URL.

Add as `SLACK_WEBHOOK_URL` to the backend env and to GitHub repo secrets.

### 4. SES setup

The digest reuses the existing SES integration. Verify:

- AWS account is **out of SES sandbox** (check the SES console). Sandbox-mode SES can only mail verified addresses.
- Each founder address in `digest_recipients` is SES-verified, OR the AWS account is in production SES (which doesn't require per-recipient verification).
- The `From` address (`INVITE_FROM_EMAIL` or `DIGEST_FROM_EMAIL` override) is SES-verified.

### 5. Add founders to the recipients list

```sql
insert into digest_recipients (email, role) values
  ('founder1@example.com', 'founder'),
  ('founder2@example.com', 'founder')
on conflict (email) do nothing;
```

### 6. Provision GitHub Actions secrets

The workflow at `.github/workflows/weekly-digest.yml` (Phase 5) needs:

- `DIGEST_SHARED_SECRET` — the value generated in step 2
- `BACKEND_URL` — base URL of the deployed backend (e.g. `https://api.0studio.example.com`)

### 7. First run + backfill

After Phase 5 deploys and a live Sunday run completes successfully:

```bash
curl -X POST \
  -H "Authorization: Bearer $DIGEST_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"weeks": 8}' \
  "$BACKEND_URL/api/admin/digest/backfill"
```

Verify:

```sql
select week_start, count(*) from usage_pulse
  group by week_start order by week_start;
-- expect: 9 distinct weeks (8 backfill + 1 live)
```

---

## Weekly verification (every Monday)

Each Monday morning:

1. Slack channel received a digest message overnight → ✅
2. Each founder received an email → ✅
3. `digest_runs` shows `status = 'ok'` for the week:
   ```sql
   select week_start, status, finished_at, recipients_sent, slack_sent, errors
     from digest_runs order by week_start desc limit 4;
   ```

If `status = 'partial'` or `'failed'`: see "Re-run a failed week" below.
If no Slack message arrived: check GitHub Actions runs for the workflow; check `digest_runs.errors`.

---

## Re-run a failed week

1. Inspect the failure:
   ```sql
   select * from digest_runs where week_start = 'YYYY-MM-DD';
   ```

2. Clear the lease lock and any partial pulse rows:
   ```sql
   delete from usage_pulse where week_start = 'YYYY-MM-DD';
   delete from digest_runs where week_start = 'YYYY-MM-DD';
   ```

3. Re-trigger:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $DIGEST_SHARED_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"week_start": "YYYY-MM-DD"}' \
     "$BACKEND_URL/api/admin/digest/run"
   ```

   Or, if you want to re-run the *current* week, omit the body:
   ```bash
   curl -X POST -H "Authorization: Bearer $DIGEST_SHARED_SECRET" \
     -d '{}' "$BACKEND_URL/api/admin/digest/run"
   ```

---

## Manual trigger (between Sundays)

To run a digest now (e.g., for testing or emergency outreach):

```bash
gh workflow run weekly-digest.yml
```

Or directly:

```bash
curl -X POST -H "Authorization: Bearer $DIGEST_SHARED_SECRET" \
  -d '{}' "$BACKEND_URL/api/admin/digest/run"
```

The lease lock means a manual run during the week is fine — the second run on the same `week_start` returns `noop_already_ran`.

---

## Adding / removing recipients

Add:
```sql
insert into digest_recipients (email, role) values ('new@example.com', 'founder')
on conflict (email) do nothing;
```

Pause without removing (audit-friendly):
```sql
update digest_recipients set active = false where email = 'old@example.com';
```

The next digest run reads the table fresh — no redeploy needed.

---

## Ad-hoc analysis (the whole point of `usage_pulse`)

Examples the founder team can run in the Supabase SQL editor without changing code:

```sql
-- Top users by commit volume this week
select user_email, commits_made, plan_status
  from usage_pulse where week_start = '2026-04-27'
  order by commits_made desc limit 20;

-- Free users with the highest weekly activity (conversion candidates)
select user_email, commits_made, active_projects
  from usage_pulse
  where week_start = '2026-04-27' and plan_status = 'free'
  order by commits_made desc limit 20;

-- Paying users who went silent for 2+ weeks
select user_email, last_sign_in_at, plan_status
  from usage_pulse
  where plan_status = 'active' and silent_paying_user
  and week_start = (select max(week_start) from usage_pulse);

-- Return-commit cohort, week by week
select week_start,
  count(*) filter (where commits_made > 0) as committed,
  count(*) as total,
  round(100.0 * count(*) filter (where commits_made > 0) / nullif(count(*), 0), 1) as pct
  from usage_pulse
  where weeks_since_signup is not null and weeks_since_signup >= 2
  group by week_start order by week_start;
```

---

## Failure modes and recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| No Slack message Monday morning | Job aborted before Slack send | Check `digest_runs.status` and `digest_runs.errors`; check GitHub Actions run logs |
| Slack OK but no email | SES failure | `digest_runs.errors.email` lists per-recipient errors; verify SES sandbox status; verify recipient addresses |
| `noop_already_ran` on manual retry | Lease lock still held from a prior run | `delete from digest_runs where week_start = '...'` then re-trigger |
| GitHub Actions step times out | App Runner cold start (>2 min) | Increase `--max-time` in workflow; check App Runner min-instance setting |
| Runs but recipients_sent = 0 | `digest_recipients` table empty or all rows have `active = false` | `select * from digest_recipients;` and fix |
| `digest_runs.status = 'partial'` | Per-user upsert failures or per-recipient SES failures | Inspect `digest_runs.errors`; re-run if a critical user was missed |

---

## Privacy posture

The digest contains user emails and project names. Per the brainstorm scope:

- Recipients are the founder team only — they already have Supabase admin access via service role
- The digest footer reads: *"internal — contains client project names; do not forward outside the founder team"*
- The `digest_recipients` table is the single source of truth for who can receive — no env var bypass

If a digest is accidentally forwarded outside the founder team, treat it as a confidentiality incident: the project names of architects' confidential client work are in that document.
