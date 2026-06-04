---
title: "feat: Weekly Founder Digest"
type: feat
status: active
date: 2026-04-28
origin: docs/brainstorms/2026-04-28-weekly-founder-digest-requirements.md
---

# feat: Weekly Founder Digest

## Overview

A weekly Sunday-evening backend job that reads existing 0studio data (Supabase rows + S3 commit-blob metadata + Supabase auth users), writes one row per active user to a new `usage_pulse` Supabase table, and delivers a Markdown digest to a private Slack channel and a founder email allowlist. The digest combines three lenses (HEALTH, RISK, ROADMAP) and the underlying table is queryable in the Supabase SQL editor for ad-hoc exploration. Spans 6 phases from schema setup through GitHub-Actions cron wiring + a final backfill.

Carries forward all 8 requirements (R1–R8), success criteria, and scope boundaries from the origin requirements doc. Resolves the 10 deferred-to-planning questions and the 8 BLOCKING gaps surfaced by spec-flow analysis as explicit Key Decisions (KD1–KD12 below).

## Problem Statement

The 0studio founder team has no recurring view of how users use the product. The only persisted user-behavior data is Stripe payment events (`subscriptions` Supabase table) and S3 commit blobs (per-project `tree.json` and commit files). Roadmap and outreach decisions are made on anecdotes. There is no defined North Star metric, no churn early-warning, and no view of which features get used. (See origin: `docs/brainstorms/2026-04-28-weekly-founder-digest-requirements.md`.)

## Proposed Solution

A two-layer feature:

1. **Data layer** — a Sunday cron writes one `usage_pulse` row per active user per week with per-user metrics granular enough to reconstruct any digest section via SQL. Supports the "easily accessible user data for the builder" requirement.
2. **Delivery layer** — the same job formats a Markdown digest from `usage_pulse` rows + ad-hoc joins, posts to Slack via webhook, and emails a founder allowlist via the existing SES integration.

**Cron host:** GitHub Actions `schedule:` workflow that POSTs to a new shared-secret-protected backend route. This avoids the App Runner autoscaling problem (which would fire `node-cron` N times) and reuses GitHub Secrets infrastructure already used by `release.yml`. (See KD1.)

## Technical Considerations

### Architecture

```
GitHub Actions cron (Mondays 04:00 UTC = Sundays 21:00 PT)
        │ POST {"week_start":"2026-04-27"}, Authorization: Bearer ${DIGEST_SHARED_SECRET}
        ▼
backend/routes/admin-digest.js       (new)
   ├── verifyDigestSecret middleware (constant-time compare on header)
   ├── acquireWeekLock(week_start)   INSERT INTO digest_runs ON CONFLICT DO NOTHING
   ├── invoke scripts/weekly-digest.js
   │     ├── readUsageInputs(week)
   │     │     ├── supabase.auth.admin.listUsers (paginated)
   │     │     ├── SELECT subscriptions, projects, project_members
   │     │     ├── ListObjectVersionsCommand per project (Prefix=projects/<id>/commits/)
   │     │     └── GetObjectCommand on projects/<id>/tree.json (per project with commits)
   │     ├── computePulses (pure)    → usage_pulse rows
   │     ├── upsertPulses            → UPSERT on (user_id, week_start)
   │     ├── computeDerivatives (pure) → cohort %, project-silence list, conversion candidates, top projects
   │     ├── renderMarkdown (pure)
   │     └── deliver
   │           ├── sendSlack         (FIRST — fails fast if webhook is dead)
   │           └── sendEmail (SES, per-recipient, partial-failure-tolerant)
   ├── recordRunStatus               UPDATE digest_runs SET status, errors_jsonb, recipients_sent
   └── 200 { week_start, status, slack_ok, email_count }
```

### Files touched

**New:**
- `backend/scripts/weekly-digest.js` — orchestrator (read → compute → write → render → deliver → record)
- `backend/scripts/digest-metrics.js` — pure metric functions (testable without I/O)
- `backend/scripts/render-digest.js` — Markdown renderer (Slack mrkdwn-friendly + email HTML/text)
- `backend/routes/admin-digest.js` — route factory + `verifyDigestSecret` middleware
- `USAGE_PULSE_MIGRATION.sql` — repo-root SQL: `usage_pulse`, `digest_runs`, `digest_recipients` tables; RLS enabled with zero policies (deny-all to anon/authed; service-role bypasses)
- `.github/workflows/weekly-digest.yml` — cron schedule + curl POST to backend
- `docs/DIGEST_OPS.md` — manual ops runbook (backfill, retry, recipient management)

**Updated:**
- `backend/server.js` — wire `createAdminDigestRoutes` into the app; ensure mount happens *after* `express.json()` and *before* the catch-all error handler. Pass `s3Client`, `BUCKET_NAME`, `supabase`, `sesClient`, `DIGEST_SHARED_SECRET`, `SLACK_WEBHOOK_URL` (all already constructed at lines 32–47 except the two new env vars)
- `backend/.env.example` — add `DIGEST_SHARED_SECRET`, `SLACK_WEBHOOK_URL`
- `backend/package.json` — add `date-fns ^3.6.0` (for ISO-week math; matches root version)
- `docs/AWS_BACKEND_DEPLOYMENT.md` — note the new `/api/admin/digest/*` routes and SES sandbox prerequisite

**Read but not modified:**
- `backend/server.js:32` — reuse the existing service-role `supabase` client
- `backend/server.js:42-47` — reuse the existing `sesClient`
- `backend/middleware/auth.js` — reference pattern for new `verifyDigestSecret`
- `backend/lib/utils.js:49-76` — `sendProjectInviteEmail` is the SES pattern to mirror (with the silently-swallowed-error semantics fixed for the digest path; see KD10)
- `backend/routes/sync.js:144-158` — `ListObjectVersionsCommand` pattern for S3 metadata
- `backend/routes/stripe.js:108-275` — precedent for "server-side process writes to Supabase"
- `src/contexts/VersionControlContext.tsx:12-32` — `Commit` type definition (informs tree.json parser)

### Edge cases (mostly from spec-flow analysis)

- **WAU-by-commit attribution** uses `authorId` from each commit in `tree.json`, not the project owner. (KD8.) A commit by user A on user B's project counts user A as active.
- **Project-silence ownership** attributes silent projects to current `projects.owner_id`; if owner has no `auth.users.last_sign_in_at` in the last 30 days, fall back to the most recent commit's `authorId` for the outreach name in the risk list.
- **`cloudSyncedCommitIds` vs S3 drift** — treat S3 `ListObjectVersionsCommand` as canonical for "is this commit actually in the cloud." `tree.json` is descriptive, not authoritative. (KD9.)
- **Empty-tree projects** (`commits: []` or no S3 commit blobs) — exclude from project-silence denominator. Require ≥3 prior weeks of commits before a project becomes eligible for silence detection.
- **Sunday-night timezone** — pin to UTC. Cron fires Mondays 04:00 UTC = Sundays 21:00 PT. Document the founder-facing semantic ("you'll see it Monday morning PT"). (KD3.)
- **`week_start` definition** — ISO week, Monday 00:00 UTC. Stored as `DATE`. `usage_pulse` PK is `(user_id, week_start)`. Never use rolling 7-day windows for SQL — kills cohort math. (KD3.)
- **North Star "different calendar week"** — `floor(epoch/7d)` on first commit vs second commit; strictly-greater means "they returned." A user who first-commits Sunday 23:59 UTC and second-commits Monday 00:01 UTC still counts as "same week, didn't return" (correct: the intent is "did they come back").
- **Recent-signup cohort exclusion** — exclude signups whose `created_at` is within the last 14 days from the North Star denominator. They cannot have a 2nd-week commit yet; including them artificially deflates %. (KD7.)
- **NSM denominator** — only users whose first commit is recorded in any project's tree.json. Tracks "users who started using the product," not "users who registered." (KD6.)
- **S3 `LastModified` vs commit `timestamp`** — prefer the `timestamp` field from `tree.json` when available (it's authored client-side at commit time); fall back to `LastModified` only for project-silence detection (where "did the cloud see fresh activity" is the actual question). (KD9.)
- **Stripe webhook lag** — a Saturday upgrade may not be in `subscriptions.status` by Sunday's run. The job snapshots `plan_status` into `usage_pulse` weekly; the next week's diff catches the transition. Explicitly acceptable.
- **Empty `digest_recipients` table** — fail the run loudly with a Slack message rather than silently producing nothing.
- **`tree.json` schema drift** — version field is `'1.1'` (bumped 2026-04-22). On unknown version, log a warning and process best-effort with optional-chaining; never abort the entire run for one bad project's tree.

### System-Wide Impact

#### Interaction graph

```
GitHub Actions
  → backend/routes/admin-digest.js
    → verifyDigestSecret (constant-time header check)
    → acquireWeekLock → digest_runs INSERT
    → scripts/weekly-digest.js
      → supabase (auth.admin + 4 table SELECTs)
      → s3 (1 ListObjectVersionsCommand + N GetObjectCommands)
      → digest-metrics (pure)
      → supabase usage_pulse UPSERTs
      → render-digest (pure)
      → fetch SLACK_WEBHOOK_URL (POST)
      → ses SendEmailCommand (per recipient)
    → recordRunStatus → digest_runs UPDATE
```

#### Error & failure propagation

- **Slack first.** Validate the Slack webhook before any heavy work. If unreachable, abort with a process exit (so the GitHub Actions step shows red) — there's no point producing a digest no one will see, and Slack is needed even for failure notifications. (KD10.)
- **Top-level catch** in the route handler. Any thrown error attempts to send `"⚠️ digest job failed at <step>: <message>"` to Slack before re-raising as a 500.
- **Per-recipient SES errors** are collected (not fatal). Slack still gets the digest. `digest_runs.errors.email[<recipient>]` records each failure.
- **Per-user `usage_pulse` upsert errors** are collected (not fatal). The digest still renders from the rows that succeeded; the run is marked `partial`.
- **Top-level catch within `verifyDigestSecret`** returns 401 (wrong/missing secret) or 403 (rate-limited). No leak of timing info via `===` — use `crypto.timingSafeEqual`.

#### State lifecycle risks

- **Lease lock via `digest_runs.week_start`** prevents duplicate digests on cron retries or autoscaling double-fires. `INSERT ... ON CONFLICT DO NOTHING`; if no row inserted, the call returns `200 { status: 'noop_already_ran' }` immediately.
- **`usage_pulse` UPSERT on `(user_id, week_start)`** keeps re-runs idempotent at the row level. If a manual re-run is needed: `DELETE FROM digest_runs WHERE week_start = '...'; DELETE FROM usage_pulse WHERE week_start = '...';` then re-POST.
- **No orphan rows possible** — the lease lock is the only state created before any other writes; if the lock is acquired but the run crashes, the next run sees the lock and no-ops. Manual cleanup is documented in `docs/DIGEST_OPS.md`.

#### API surface parity

- One new mounted path: `/api/admin/digest/*`. No existing route is modified. Mount happens after `express.json()` and before the catch-all 500 handler. Stripe webhook continues to use raw body — that ordering is preserved.
- The new admin route is rate-limited at 10 req/hour per source IP (matches the rate-limit pattern from `/api/aws` but stricter).

#### Integration test scenarios

Manual verification checklist (no automated test harness in this codebase):

1. **Idempotency** — POST `/api/admin/digest/run` twice within the same minute → first returns full digest body; second returns `{ status: 'noop_already_ran' }`. Slack channel receives exactly one message.
2. **Slack-only outage** — block `SLACK_WEBHOOK_URL` (or set to invalid URL) → run aborts with non-zero exit; GitHub Actions step shows red; no email sent. (Slack-first design.)
3. **SES partial failure** — invalidate one recipient in `digest_recipients` → other recipients still get email; `digest_runs.errors.email` records the bad address; Slack message still appears.
4. **Backfill** — `POST /api/admin/digest/backfill?weeks=8` after a fresh deploy → sequentially fills 8 weeks; resuming partway is safe (each week leases independently).
5. **Manual re-run** — `DELETE FROM digest_runs WHERE week_start = '2026-04-27';` then re-POST → produces a fresh digest for that week.
6. **Schema drift** — corrupt one project's `tree.json` (e.g., `version: '99.0'`) → that project is skipped with a warning, others process; digest is partial but produced.

## Phases

### Phase 0 — Schema & infrastructure foundation (no behavior, no scheduling)

**Goal:** Tables and env scaffolding exist; no runtime behavior yet.

- Author `USAGE_PULSE_MIGRATION.sql` at repo root. Three tables:
  - `usage_pulse (id uuid pk, user_id uuid, user_email text, week_start date, logged_in bool, last_sign_in_at timestamptz, commits_made int, active_projects int, active_branches int, used_cloud_sync bool, plan_status text, signup_week date, weeks_since_signup int, silent_paying_user bool, projects_silenced_count int, conversion_candidate bool, computed_at timestamptz default now(), unique(user_id, week_start))`
  - `digest_runs (week_start date pk, started_at timestamptz, finished_at timestamptz, status text check (status in ('running','ok','partial','failed','noop_already_ran')), errors jsonb, recipients_sent int, slack_sent bool)`
  - `digest_recipients (id uuid pk, email text not null unique, role text check (role in ('founder','observer')) default 'founder', added_at timestamptz default now(), active bool default true)`
  - All three: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` with no policies (deny-all to anon/authed; service-role bypasses). (KD11.)
- Add `date-fns ^3.6.0` to `backend/package.json` (matches the root frontend version for consistency).
- Append to `backend/.env.example`:
  ```
  # Weekly digest
  DIGEST_SHARED_SECRET=  # random 64-char hex; same value in GitHub Actions secret
  SLACK_WEBHOOK_URL=     # private founder channel webhook
  ```
- Document SES sandbox prerequisite + adding founder emails to `digest_recipients` in a new `docs/DIGEST_OPS.md`.

**Acceptance:**
- Migration SQL pasted into Supabase SQL Editor runs without error.
- Service-role `SELECT` from each new table returns empty rows.
- Anon-key client `SELECT` from each new table returns no rows / 401 (RLS deny-all working).
- `backend/.env.example` documents the two new vars.

### Phase 1 — Pure metric functions (unit-testable, no I/O)

**Goal:** All metric math lives in pure functions that take typed inputs and return typed outputs. No Supabase, no S3, no SES, no fetch.

Implement in `backend/scripts/digest-metrics.js`:
- `weekStartUtc(date) → Date` — returns the ISO Monday 00:00 UTC for any input
- `inWeek(timestamp, weekStart)` — boolean: is the timestamp within the week starting at `weekStart`?
- `computeReturnCommitCohort(allFirstCommits, weekStart) → { numerator, denominator, percent }` — denominator is users whose first commit was 14+ days before `weekStart`; numerator is those who also have a commit in any week strictly later than the week of their first commit.
- `detectProjectSilence(perProjectCommitTimes, weekStart, opts) → ProjectId[]` — projects with ≥`opts.minPriorWeeks` of ≥`opts.minPriorCommitsPerWeek` commits AND zero commits in the week of `weekStart`. Defaults: `{ minPriorWeeks: 3, minPriorCommitsPerWeek: 1 }`.
- `detectSilentPayingUsers(plans, lastCommitTimes, weekStart) → UserId[]` — `plan_status === 'active'` AND `lastCommitTime < weekStart - 14d`.
- `detectConversionCandidates(plans, perUserCommits, perUserProjects, weekStart) → UserId[]` — `plan_status` is free AND ≥3 commits this week AND ≥2 distinct projects. Skip users already flagged in any of the prior 4 weeks (lookup in `usage_pulse.conversion_candidate`).
- `topProjectsByVolume(perProjectCommitCounts, n=5) → Project[]` — top N by count this week, tiebreak by recency of most recent commit.
- `freeToPayConversions(thisWeekPulses, lastWeekPulses) → UserId[]` — users whose `plan_status` transitioned from a free state to `'active'` between the two snapshots.

**Acceptance:**
- Each function has at least one happy path + one boundary case manually verified with hand-built fixtures under `backend/test-fixtures/digest/`.
- No `import` from `@aws-sdk/*`, `@supabase/*`, or anything I/O-bound in this file.
- `node -e "console.log(require('./backend/scripts/digest-metrics.js').weekStartUtc(new Date('2026-04-30T15:30:00Z')))"` prints `2026-04-27T00:00:00.000Z`.

### Phase 2 — Read pipeline (no writes, no scheduling)

**Goal:** Given a `weekStart`, the orchestrator can fetch all needed inputs and print them to stdout. No writes anywhere, no Slack, no email.

In `backend/scripts/weekly-digest.js`, implement `readUsageInputs(weekStart, deps)`:
- Paginate `supabase.auth.admin.listUsers({ perPage: 1000 })` until exhausted; collect `{ id, email, last_sign_in_at, created_at }`. (Same pattern as `backend/routes/projects.js:236`.)
- `supabase.from('subscriptions').select('user_id, plan, status, created_at, updated_at')`.
- `supabase.from('projects').select('id, owner_id, name, created_at')`.
- `supabase.from('project_members').select('project_id, user_id, role, status')`.
- For each project from the previous step:
  - `s3Client.send(new ListObjectVersionsCommand({ Bucket, Prefix: 'projects/<id>/commits/' }))` — extract per-blob `Key` + `LastModified` for `IsLatest` versions where Key ends in `.3dm` or `.delta`.
  - `s3Client.send(new GetObjectCommand({ Bucket, Key: 'projects/<id>/tree.json' }))` — parse JSON; extract `commits[]` with `{ id, authorId, authorEmail, timestamp, branchId, parentCommitId }`.
- Collate into a single `UsageInputs` shape and `console.log(JSON.stringify(inputs, null, 2))`.

**Acceptance:**
- `node backend/scripts/weekly-digest.js --read-only --week=2026-04-27` prints structured JSON for the current week without writing to Supabase, sending Slack, or sending email.
- Per-project tree fetch failures (NoSuchKey, parse error) are logged but do not abort; that project is skipped with a warning in the output.
- Returns within 60 seconds for the production-sized data set (verify against current S3 bucket).

### Phase 3 — Write + render pipeline

**Goal:** Given inputs, write `usage_pulse` rows and render the Markdown digest. Still no Slack, no email.

- `computePulses(inputs, weekStart) → UsagePulse[]` — composes the Phase 1 pure functions.
- `upsertPulses(pulses, supabase)` — batches of 100, `upsert` keyed on `(user_id, week_start)`.
- `computeDerivatives(pulses, inputs, weekStart) → DigestDerivatives` — top projects, return-commit cohort, silent paying users, conversion candidates, free→Pro transitions (using last week's `usage_pulse` rows).
- `renderMarkdown(pulses, derivatives, weekStart) → { slackMrkdwn, emailHtml, emailText }`:
  - **Top callout block:** 6 numbers — WAU-by-login, WAU-by-commit, ratio, return-commit %, week-over-week active delta, free→Pro count
  - **Section ordering:** Health → Risk → Roadmap (matches origin R3a/R3b/R3c lens order)
  - **Project names:** verbatim. Footer: `_internal — contains client project names; do not forward outside the founder team._` (KD per origin scope-boundaries)
  - **Slack mrkdwn quirks:** no GFM tables; render lists as bullets; bold via `*…*` not `**…**`
  - **Email:** simple HTML wrapper around the Markdown (or use a tiny `escapeHtml` + `<pre>` block for V1; keep it scrappy)

**Acceptance:**
- `node backend/scripts/weekly-digest.js --dry-run --week=2026-04-27` writes `usage_pulse` rows AND prints both Slack-mrkdwn and HTML-email to stdout. Sends nothing.
- Re-running the same command produces the same `usage_pulse` row count (idempotent).
- Manually copying the Slack mrkdwn into a Slack message renders cleanly (no broken tables).

### Phase 4 — Delivery + lease lock + failure paths

**Goal:** Full job runs end-to-end, with idempotency and graceful degradation.

- Add `acquireWeekLock(weekStart, supabase) → boolean` — `INSERT INTO digest_runs (week_start, started_at, status) VALUES (..., 'running') ON CONFLICT (week_start) DO NOTHING RETURNING week_start;` returns `true` if row was inserted.
- Add `sendSlack(slackMrkdwn) → { ok: boolean, status?: number, error?: string }` — POST to `SLACK_WEBHOOK_URL`. Validate Slack first in the run sequence: read `digest_recipients` AND probe Slack with a tiny payload; if Slack is unreachable, abort the run with non-zero exit.
- Add `sendEmail(html, text, recipients, sesClient) → { sent: number, errors: { [email]: string } }` — copy the SES `SendEmailCommand` pattern from `backend/lib/utils.js:49-76` BUT do not swallow errors per-recipient; collect them.
- Add `recordRunStatus(weekStart, status, supabase, extras)` — `UPDATE digest_runs SET status=$2, finished_at=now(), errors=$3, recipients_sent=$4, slack_sent=$5 WHERE week_start=$1`.
- **Top-level error handler** in `backend/scripts/weekly-digest.js`:
  ```js
  try { /* run */ } catch (err) {
    await sendSlack(`⚠️ digest job failed at ${stage}: ${err.message}`);
    await recordRunStatus(weekStart, 'failed', supabase, { errors: { fatal: err.message } });
    throw err;  // surface as 500 in route
  }
  ```

**Acceptance:**
- POST `/api/admin/digest/run` twice within one minute → second returns `{ status: 'noop_already_ran' }` and Slack receives exactly one message.
- Set `SLACK_WEBHOOK_URL` to a 404 URL → job aborts before writing `usage_pulse`; route returns 500; GitHub Actions step shows red.
- Inject a malformed recipient in `digest_recipients` → other recipients receive email; `digest_runs.errors.email` records the bad address.
- Throw a synthetic exception inside `computePulses` → Slack receives `"⚠️ digest job failed at compute: ..."`; `digest_runs.status = 'failed'`.

### Phase 5 — HTTP endpoint + GitHub Actions schedule

**Goal:** Production wiring complete. Cron triggers digests automatically.

- `backend/routes/admin-digest.js`:
  ```js
  export function createAdminDigestRoutes({
    supabase, sesClient, s3Client, BUCKET_NAME,
    DIGEST_SHARED_SECRET, SLACK_WEBHOOK_URL,
  }) {
    const router = Router();
    router.use(verifyDigestSecret(DIGEST_SHARED_SECRET));
    router.use(rateLimit({ windowMs: 60*60*1000, max: 10 }));

    router.post('/run', async (req, res) => { /* invoke weekly-digest with week_start = body.week_start || currentISOWeek() */ });
    router.post('/backfill', async (req, res) => { /* loop weeks: max(body.weeks||8, 26) sequentially */ });

    return router;
  }
  ```
- `verifyDigestSecret(secret)` → middleware using `crypto.timingSafeEqual(...)`. 401 on missing/wrong; never logs the actual header.
- Wire into `backend/server.js`: import + mount under `/api/admin/digest`. Confirm mount order: after `express.json()`, before the catch-all 500 handler.
- `.github/workflows/weekly-digest.yml`:
  ```yaml
  name: Weekly Founder Digest
  on:
    schedule:
      - cron: '0 4 * * 1'  # Mondays 04:00 UTC = Sundays 21:00 PT
    workflow_dispatch: {}
  jobs:
    run:
      runs-on: ubuntu-latest
      steps:
        - run: |
            curl -fsSL -X POST \
              -H "Authorization: Bearer ${{ secrets.DIGEST_SHARED_SECRET }}" \
              -H "Content-Type: application/json" \
              -d '{}' \
              "${{ secrets.BACKEND_URL }}/api/admin/digest/run"
  ```

**Acceptance:**
- `gh workflow run weekly-digest.yml` fires the digest end-to-end against production.
- `curl -H "Authorization: Bearer wrong-secret"` returns 401 with no timing leak.
- A first scheduled run produces a Slack message + email visible to founders.
- `digest_runs` has a row with `status = 'ok'`, non-null `finished_at`, `recipients_sent > 0`.

### Phase 6 — Backfill (one-time, manual)

**Goal:** Populate prior weeks so the 8-week trend chart in R7 has data.

- After Phase 5 deploys successfully and one live run completes, manually invoke:
  ```
  curl -X POST -H "Authorization: Bearer $DIGEST_SHARED_SECRET" \
    -d '{"weeks":8}' \
    "$BACKEND_URL/api/admin/digest/backfill"
  ```
- Loop processes 8 prior weeks sequentially, each independently leased in `digest_runs`.
- Document the steps in `docs/DIGEST_OPS.md`.

**Acceptance:**
- `SELECT week_start, count(*) FROM usage_pulse GROUP BY week_start ORDER BY week_start;` shows 9 distinct weeks (8 backfill + 1 current).
- The next live Sunday digest renders the return-commit cohort % with an 8-week trend section populated.
- Re-running backfill is safe (each week is its own lease; existing weeks return `noop_already_ran`).

## Acceptance Criteria

Mapped to origin requirements:

- [ ] **R1 (cadence + audience)** — GitHub Actions cron fires Mondays 04:00 UTC; one digest per week visible to the founder team
- [ ] **R2a (Markdown delivery)** — Slack receives mrkdwn-rendered digest in the configured channel; SES sends to all `digest_recipients` rows
- [ ] **R2b (Supabase table)** — `usage_pulse` exists with one row per `(user_id, week_start)`; founder can run `SELECT * FROM usage_pulse WHERE week_start = '2026-04-27' ORDER BY commits_made DESC` in the Supabase SQL editor
- [ ] **R3a (health lens)** — top callout block contains WAU-by-login, WAU-by-commit, ratio, return-commit cohort %, week-over-week delta
- [ ] **R3b (risk lens)** — named lists for paying-but-silent (14d), project-silence, free→Pro conversions, conversion candidates
- [ ] **R3c (roadmap lens)** — % using cloud sync, branching activity (distinct branchIds in week), top 5 projects by commit count. **Note: "restore frequency" from origin R3c is dropped** (KD5) and replaced with "branches per active user."
- [ ] **R4 (active-architect definition)** — two numbers reported side-by-side; ratio displayed prominently
- [ ] **R5 (project-silence)** — silent project list appears in Risk lens with current owner attribution
- [ ] **R6 (cloud-only scope)** — zero new client-side code in `src/` or `electron/`; no new outbound domains contacted from the renderer
- [ ] **R7 (NSM)** — return-commit cohort % shown with 8-week trend after Phase 6 backfill
- [ ] **R8 (ad-hoc accessibility)** — founder can answer arbitrary user-behavior questions via plain SQL against `usage_pulse` without code changes

## Key Decisions

Each KD resolves a deferred-to-planning question from the origin requirements doc and/or a BLOCKING gap from spec-flow analysis.

| ID | Decision | Rationale |
|---|---|---|
| **KD1** | **Cron host: GitHub Actions cron → backend HTTP endpoint with shared secret** | App Runner autoscaling makes in-process `node-cron` fire N times. GitHub Actions guarantees exactly-once execution and uses existing GitHub Secrets infrastructure already proven by `release.yml`. No new AWS service. |
| **KD2** | **Lease lock via `digest_runs.week_start` UNIQUE constraint** | INSERT ON CONFLICT DO NOTHING prevents duplicate digests if cron retries or two runs collide. Manual re-run = DELETE + re-POST. Clean idempotency without distributed-lock infrastructure. |
| **KD3** | **All times UTC; ISO week boundary (Monday 00:00 UTC); `week_start` is `DATE`** | Founder semantic: digest visible Monday morning PT. Engineering: no DST math, clean cohort SQL. Avoids the spec-flow-flagged ambiguity around "Sunday-night." |
| **KD4** | **Recipient list lives in Supabase `digest_recipients` table, not env var** | Adding/removing a founder mid-flight without redeploy. Hot-reloaded each run. Resolves spec-flow §6.1 BLOCKING. |
| **KD5** | **R3c "restore frequency" dropped; substituted with "branches per active user"** | `restoreToCommit` is in-memory only and leaves no S3/Supabase trace. Mirrors the lost-work-signal fix from origin (origin R5). The local restore-frequency signal — if ever needed — belongs in ideation Survivor #4 territory, not the cloud-only digest. |
| **KD6** | **NSM denominator: users whose first commit is recorded (not all signups)** | Tracks "users who started using the product," not "users who registered." Materially changes the percentage upward; matches founder mental model of "did our active users come back." |
| **KD7** | **Recent-signup exclusion: signups <14 days from `weekStart` excluded from NSM denominator** | A user who signed up 3 days ago cannot have a 2nd-week commit yet; including deflates % artificially. |
| **KD8** | **WAU-by-commit attribution: `authorId` from each commit, not project owner** | "Active architect" means "person who actually committed," not "person paying for the workspace." Multi-user projects work correctly. |
| **KD9** | **Project-silence uses S3 `LastModified`; everything else uses commit `timestamp` from `tree.json`** | `LastModified` is upload-completion time (sometimes lagged); commit `timestamp` is author-intent time. Project-silence is about "did the cloud see fresh activity"; everything else is about author behavior. |
| **KD10** | **Validate Slack webhook FIRST in the run; abort if unreachable** | Slack is needed even for failure notifications. If Slack is dead, no point producing a digest no one will see. |
| **KD11** | **`usage_pulse`, `digest_runs`, `digest_recipients` have RLS enabled with zero policies** | Service-role bypasses RLS (already used by backend). Anon/authed clients deny-all. Founder ad-hoc queries via Supabase SQL editor (uses service-role) work cleanly. |
| **KD12** | **Backfill is a separate manual `/backfill` endpoint, NOT part of run #1** | First-run scope stays small (one week). Backfill is operationally explicit (`POST /api/admin/digest/backfill?weeks=8`). Per-week leasing means partial backfills are safe to resume. |

## Dependencies & Risks

- **AWS SES sandbox status** — must be verified before Phase 5. The existing `sendProjectInviteEmail` already runs against SES, so production SES should already be out of sandbox; but adding new founder addresses to `digest_recipients` requires they be SES-verified. Block Phase 5 deploy on this check.
- **GitHub Actions runner IP** — IP allowlisting is not used in V1 (shared secret only). If we want IP allowlist later, the GitHub `meta` API publishes runner IPs but they change. V1 ships secret-only; V2 may layer in IP allowlist.
- **App Runner cold start** — if the backend container scales to 0 between weekends, the first GitHub Actions HTTP call may take 30+ seconds. Use `curl -fsSL --max-time 120` to allow the cold start. Document expected latency in `docs/DIGEST_OPS.md`.
- **`tree.json` schema drift** — version field is currently `'1.1'` (bumped 2026-04-22). The job parses with optional chaining and skips projects on parse error rather than failing the run. Tests should include an "unknown version" fixture.
- **Stripe webhook lag** — accepted: a Saturday upgrade may surface in the next week's digest. Documented behavior, not a defect.
- **Supabase `auth.users.last_sign_in_at` semantics** — `supabase.auth.admin.listUsers` returns this field (already used at `backend/routes/projects.js:236-242`). Verified during Phase 1 implementation that the value updates on each refresh, not just on full re-auth.
- **No automated test harness** — backend has no test suite. Phases 1–4 acceptance is via manual command-line invocation against a dev database. This is consistent with the rest of the codebase (no test scripts exist) but is a quality risk worth flagging.

## Success Metrics

- A founder reads the Monday-morning Slack digest and identifies ≥1 actionable user-outreach item per week (paying user gone silent, conversion candidate, project went silent).
- After 4 weeks of digests, the team has a defined North Star number with an 8-week trend line, replacing anecdotes in roadmap discussions.
- Adding a new metric to the digest is a single change to `digest-metrics.js` + one column on `usage_pulse` — total <30 minutes.
- Digest job reliability ≥95% over a 12-week window. Each failure produces a Slack notification within 5 minutes of the scheduled trigger.
- Builder can answer an ad-hoc user-behavior question via Supabase SQL editor in <5 minutes (no code, no script changes, no redeploy).

## Sources & References

### Origin

- **`docs/brainstorms/2026-04-28-weekly-founder-digest-requirements.md`** — origin doc. Carries forward all 8 requirements, success criteria, scope boundaries. Key decisions surfaced here: combined three-lens digest, Sunday cadence, two-layer output (Slack+email + `usage_pulse`), two-number active-architect definition, project-silence substitute, NSM = return-commit cohort %, cloud-only data scope.
- **`docs/ideation/2026-04-28-user-observability-ideation.md`** — ideation parent. The Weekly Founder Digest is Survivor #1 (highest leverage, fastest time-to-value, no privacy surface).

### Internal references

- Backend route precedent (server-side process writes Supabase row): `backend/routes/stripe.js:108-275`
- SES email pattern to mirror (with fixed error semantics per KD10): `backend/lib/utils.js:49-76`
- S3 `LastModified` access pattern: `backend/routes/sync.js:144-158`
- Supabase admin user listing precedent: `backend/routes/projects.js:236-242`
- `auth` middleware pattern (for new `verifyDigestSecret`): `backend/middleware/auth.js`
- tree.json `Commit` type: `src/contexts/VersionControlContext.tsx:12-32`
- tree.json top-level shape: `electron/services/file-storage-service.ts:261-289`, `src/lib/cloud-sync-service.ts:30-35`
- Existing SQL conventions (raw files at repo root, hand-run): `PROJECT_MEMBERS_MIGRATION.sql`, `SUBSCRIPTION_RLS_POLICY.sql`
- Supabase service-role client construction: `backend/server.js:32`
- SES client construction: `backend/server.js:42-47`

### External references

- Slack incoming webhooks: standard mrkdwn format, no GFM tables, simple POST with JSON `{ text }` or block kit
- AWS SES `SendEmailCommand`: same pattern as `backend/lib/utils.js:49-76` (no new docs needed)
- `date-fns` ISO-week helpers: `startOfWeek(date, { weekStartsOn: 1 })`, `formatISO(d, { representation: 'date' })`

### Related work

- Recently merged plans for shape reference: `docs/plans/2026-04-22-001-feat-dual-artifact-commit-model-plan.md`, `docs/plans/2026-04-09-001-feat-multi-format-cad-file-support-plan.md`
- Adversarial review precedent (worth running on the implementation): two recent commits with "address adversarial review findings" messages

---

**Spec-flow analysis (2026-04-28) was run on the origin requirements** and surfaced 8 BLOCKING + 7 SHOULD-RESOLVE + 4 NICE-TO-HAVE gaps. All 8 BLOCKING items are resolved by KD1–KD12 above (cron host, lease lock, time semantics, recipient management, restore-frequency drop, NSM denominator, recent-signup exclusion, attribution, S3-vs-timestamp source-of-truth, Slack-first failure semantics, RLS posture, backfill as separate endpoint). Remaining SHOULD-RESOLVE items are folded into the edge-cases list above; NICE-TO-HAVE items are deferred.
