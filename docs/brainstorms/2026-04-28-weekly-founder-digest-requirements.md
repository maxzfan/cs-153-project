---
date: 2026-04-28
topic: weekly-founder-digest
---

# Weekly Founder Digest

## Problem Frame

The 0studio founder team currently has **no recurring view of how users are using the product**. The only persisted user-behavior data is Stripe payment events (in the `subscriptions` Supabase table) and S3 commit blobs (per-project `tree.json` and commit files). Roadmap and outreach decisions are made on anecdotal data. There is no defined North Star metric, no churn early-warning, no view of which features get used. This gap blocks confident iteration.

This brainstorm seeds a weekly digest that combines three lenses (health check, churn/risk, roadmap signal) into one Sunday-night artifact, backed by a queryable Supabase table the builder can slice ad-hoc.

## Requirements

### R1. Cadence and audience
The digest runs once per week on Sunday (~end of UTC Sunday). Recipients: the founder team only. The digest is the sole automated touchpoint — no immediate mid-week alerts in V1.

### R2. Two-layer output
- **R2a.** A Markdown digest delivered to a private Slack channel and emailed to the founder allowlist
- **R2b.** A Supabase `usage_pulse` table refreshed each Sunday with one row per (user, week) capturing the underlying metrics, queryable via the Supabase SQL editor for ad-hoc exploration

### R3. Three lenses in one digest
The Markdown digest combines:
- **R3a. Health lens:** weekly active architects (two numbers: `WAU-by-login` and `WAU-by-commit`), return-commit cohort %, week-over-week deltas
- **R3b. Risk lens:** named action list — paying users with no commits in 14 days, projects whose commit cadence dropped from non-zero to zero, free→Pro conversions
- **R3c. Roadmap lens:** feature-usage signals — % of WAU-by-login who used cloud sync, branching activity, restore frequency, top projects by commit volume

### R4. Active-architect definition
"Active this week" is reported as **two numbers, side by side**:
- `WAU-by-login` = users whose Supabase session refreshed in the last 7 days (visible: free + paid + local-only users)
- `WAU-by-commit` = users with at least one S3 commit blob `LastModified` in the last 7 days (visible: cloud-using users only)
- The **ratio** between them (e.g., "57% of logged-in users actually pushed a commit") is itself a primary metric

### R5. Project-silence detection (substituting the original lost-work signal)
The original ideation-seed metric "saves vs commits ratio" requires local file-watcher data that does not reach the cloud. It is replaced with project-silence detection: projects that had ≥1 commit/week for ≥3 prior weeks and 0 commits this week appear in the risk list. The local saves-vs-commits signal lives in ideation Survivor #4 (FileWatcher Lost-Work Nudge), not in this digest.

### R6. Cloud-only data scope
The digest reads exclusively from data users have explicitly pushed to cloud (Supabase tables and S3 blobs). It does not reach into local-only project data. Free local-only users are visible in `WAU-by-login` only; their commit behavior is invisible by design.

### R7. North Star metric: return-commit cohort %
The single headline metric is **the percent of new signups who made a 2nd commit in a different calendar week than their first**, computed weekly over a rolling cohort. Reported alongside an 8-week trend line in the digest.

### R8. Ad-hoc accessibility
The `usage_pulse` table must be slice-able by the builder without re-running the digest job. Schema includes per-user, per-week metrics with enough granularity to reconstruct any digest section in the Supabase SQL editor.

## Success Criteria

- A founder reads the Monday-morning Slack digest and immediately knows: "Did things get better or worse this week? Who do I need to talk to?"
- The builder can answer any new user-behavior question within 5 minutes by querying `usage_pulse` directly, without code changes
- After 4 weeks of digests, the team has a clear North Star number with a trend line, replacing anecdotes
- The risk list surfaces at least one actionable user-outreach item per week (paying user gone silent, conversion candidate, project went silent)
- Adding a new metric to the digest is a single SQL query change, not a new pipeline

## Scope Boundaries

- **No client-side instrumentation.** The digest reads only existing data (Supabase rows, S3 object metadata). No new IPC events, no new frontend code, no telemetry SDK.
- **No mid-week alerts.** Critical events surface in the next Sunday digest, not as immediate Slack pings. (Defer to V2 if responsiveness becomes a problem.)
- **No repo-committed digest history.** Markdown is delivered to Slack + email only; the persistent record lives in `usage_pulse` plus Slack/email archives.
- **No real-time dashboard.** Ad-hoc exploration is via Supabase SQL editor, not a hosted UI.
- **No local-only user behavior.** Free users without cloud sync remain partially invisible; this is acknowledged, not solved.
- **No user-facing surface.** This digest is internal. Surfacing the same data to end users is a separate idea.
- **Not a privacy floor.** This brainstorm assumes the recipient set (founder team) already has Supabase/S3 admin access; no new consent UI is required because no new data leaves the user's machine. Privacy Floor (ideation Survivor #6) is a separate brainstorm prerequisite for any client-side telemetry.

## Key Decisions

- **All three lenses in one digest, weekly cadence:** Founders prefer one inbox item per Monday over three separate channels. Carrying cost is one Markdown formatter, not three.
- **Supabase `usage_pulse` table, refreshed weekly (not real-time):** Avoids modifying the push-tree route. Stale-by-up-to-7-days is acceptable for a weekly review surface. Ad-hoc queries hit Supabase directly via the dashboard.
- **Two active-architect numbers, side by side:** The ratio between login-active and commit-active is itself useful product signal (engagement vs activation). Single number obscures it.
- **Drop saves-vs-commits, substitute project-silence:** The original signal isn't computable from cloud data; project-silence is a strict-subset substitute that fits the risk lens. The local signal has a separate home (ideation Survivor #4).
- **Slack + email delivery, no repo commit:** Founders consume Markdown where they already work. The historical record lives in the table.
- **Cloud-only data scope, with the visibility limit acknowledged:** Reaching into local data would require client-side instrumentation, which is out of scope and would require a Privacy Floor first.

## Dependencies / Assumptions

- **Supabase service-role access.** The job runs server-side with the Supabase service-role key already present in the backend.
- **S3 admin access.** The job uses backend AWS credentials to list S3 objects under `projects/<id>/commits/`. This already exists for sync routes.
- **Slack webhook URL** for the founder channel. Will need to be provisioned and added to backend `.env`.
- **Email transport** (existing Stripe-related email path may already use a provider; if not, will need provisioning).
- **`auth.users.last_sign_in_at` is reliably populated** by Supabase auth flows — needs verification during planning.
- **Cloud-synced project count is at the right scale for per-project `tree.json` reads** (hundreds of projects). If it grows past a few thousand active projects, the read pattern needs reconsideration.

## Outstanding Questions

### Resolve Before Planning

*(none — all blocking product decisions made above)*

### Deferred to Planning

- [Affects R2a][Technical] Exact section layout and ordering of the Markdown digest, including a top callout block of 4-6 headline numbers
- [Affects R2b][Technical] Schema for the `usage_pulse` table — column list, indexes, RLS policy (founder team has access only)
- [Affects R3, R6][Needs research] What metric extraction is feasible from per-project `tree.json` files vs S3 object listings — does the existing `tree.json` schema include per-commit timestamps, parents, branch labels, restore markers? Some metrics may require a richer S3 read pattern
- [Affects R3a][Needs research] How `auth.users.last_sign_in_at` actually behaves under Supabase JWT refresh — whether it updates on every refresh or only on full re-auth — affects WAU-by-login accuracy
- [Affects R5][Technical] Threshold parameters for project-silence detection (commits/week required, prior-week count, lookback window)
- [Affects R7][Technical] Cohort window definition for return-commit % — calendar weeks vs rolling 7-day, signup cohort grouping (weekly vs monthly), denominator handling for very recent signups
- [Affects R3c][Technical] Whether project names appear in the "top projects" section verbatim or as IDs — recommended verbatim since founder recipients already have Supabase admin access, but worth confirming during planning review
- [Affects R3b][Technical] How to detect free→Pro conversions cleanly from the `subscriptions` table (status transitions, not just current state)
- [Affects R1][Technical] Failure mode if the Sunday job fails silently — alerting/retry policy
- [Affects R8][Technical] Backfill: should the first run also generate prior weeks' rows from historical S3 LastModified data, or start fresh?

## Next Steps

→ `/ce:plan` for structured implementation planning. The product surface is fully specified; remaining questions are technical/research and belong in planning.
