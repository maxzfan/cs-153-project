---
date: 2026-04-28
topic: user-observability
focus: user observability so we get a better idea of how users are using the product and where to iterate on
---

# Ideation: User Observability for 0studio

## Codebase Context

**Project shape.** Electron + React/Vite + Three.js desktop app for `.3dm` (Rhino) version control. Three processes: Electron main, React renderer, separate Express backend on `localhost:3000`. Auth via Supabase JWT, cloud sync via S3 presigned URLs, billing via Stripe. Seven nested React Contexts. Two-layer commit storage (local `.0studio/` + cloud S3).

**What observability already exists.**
- Only `console.*` logging (~48 calls); no structured logger
- Stripe webhooks → `subscriptions` Supabase table — the only persisted "what happened" stream
- Supabase Realtime presence channel (ephemeral)
- Backend rate-limit middleware (in-memory only)
- localStorage recent-projects list (local-only)

**What is completely absent.**
- Zero analytics SDK (no PostHog/Mixpanel/Amplitude/Sentry/Datadog)
- Zero structured logger
- Zero React `ErrorBoundary`; no `window.onerror`/`onunhandledrejection`; no `process.on('uncaughtException')` anywhere
- Zero consent UI / privacy policy / ToS surfaces
- Zero auto-updater / version-check pings
- Zero CSP

**Leverage points.**
- IPC bridge (`electron/preload.ts` → `src/lib/desktop-api.ts`): ~27 channels; every commit/restore/branch/file-watch flows through here
- Backend `verifyAuth` middleware: every authenticated API call has user identity already
- Supabase JWT provides `user.id` everywhere
- Seven React Contexts own all state mutations
- `FileWatcherService` (`electron/services/file-watcher-service.ts`) detects `.3dm` saves
- Stripe-webhook → `subscriptions` table pattern is directly extensible to a generic events table
- `.0studio/tree.json` is already a structured event log of user creative work

**Privacy / trust constraints (load-bearing).**
- Audience is professional architects working on confidential client IP. Filenames like `ACME HQ - lobby v3` are themselves sensitive
- App is local-first; cloud sync is opt-in and paid — implicit contract is "data does not leave the machine unless you push"
- App is unsigned (Gatekeeper warnings already exist); Mac power users run Little Snitch and will see new outbound domains
- Backend Stripe webhook path uses `express.raw()` before `express.json()` — any new event-ingest route must not break the ordering

**Past learnings.** No `docs/solutions/` directory; no prior decisions on observability anywhere in the repo. Greenfield. The 2026-04-06 ideation rejected "Structured logging" as "routine infrastructure" — the rejection was thin and worth revisiting deliberately, which this session does.

**Existing signal we could mine today (no new instrumentation).**
- Supabase rows: `subscriptions`, `projects`, `project_members`
- Stripe payment lifecycle events
- S3 presigned-URL issuance (currently `console.log` only — could persist)
- Backend rate-limit hit counts (in-memory)
- Cloud-synced commit metadata in `.0studio/tree.json` (rich behavioral log per project, already user-authored)

## Ranked Ideas

### 1. Commit Tree → Weekly Founder Digest
**Description:** A backend script (`backend/scripts/weekly-digest.js`) that runs Sunday night, queries Supabase (`subscriptions`, `projects`, `project_members`) and S3-synced commit metadata, and outputs a Markdown report. Sections: weekly active architects, return-commit cohort % (`% of users who made a 2nd commit in a different week than their first`), free-vs-paid behavioral split (median commits/week, % using cloud sync, day-30 retention), top projects by commit volume, lost-work pattern detection (high save-to-commit ratio), free→paid conversions. Optionally posted to Slack or emailed to founders.

**Rationale:** Highest leverage on the list. Reuses data users already explicitly pushed to cloud — zero new privacy surface. Defines the North Star in plain SQL and computes it forever for the cost of one cron job. Both skeptics agreed this was the missing crystallization the candidate list danced around. The same SQL queries can later feed an admin route or in-product cohort comparator without refactoring.

**Downsides:** Only sees cloud-synced users — free local-only users are invisible. SQL needs care: lost-work-pattern detection on incomplete data could mislead. Markdown digest format may not scale past ~50 active users; eventually warrants a real admin view. Won't surface friction in unfinished commits a user never pushed.

**Confidence:** 90%
**Complexity:** Low
**Status:** Explored (brainstormed 2026-04-28)

### 2. Closed Beta of 5 Power Users + Weekly Recordings
**Description:** Recruit 5 named professional architects (preferably 1 free-tier, 4 Pro) into a private channel (Slack or Discord). Behind a build-flag in `electron/main.ts`, ship them an instrumented version (richer console traces, "send debug bundle to founders" button wired through `window.electronAPI`). Run a rotating Friday Loom session (15-20 minutes) with one user per week, exchanging ~hour/month of their time for free Pro indefinitely. Collect qualitative themes in a `docs/closed-beta/` directory.

**Rationale:** At <1k user scale, 5 named architects telling you what they hate beats 50,000 events. Both skeptics named this as the highest-ROI option for current scale. Zero privacy issues (named consent, instrumented build is opt-in). Forces the founder team to talk to actual users instead of analyzing dashboards. Becomes a permanent qualitative source that cohort analytics never replace.

**Downsides:** Selection bias toward power users — won't surface beginner-onboarding pain or silent-churn behavior. Operationally heavy: founders must show up every week, recruit replacements when a user drops out. Sample of 5 doesn't generalize; risk of over-fitting roadmap to their specific workflows.

**Confidence:** 85%
**Complexity:** Low (no code beyond a dev-build flag)
**Status:** Unexplored

### 3. Crash Capture + In-App Feedback Widget + Debug Bundle Export
**Description:** Three-part qualitative pipe shipping together (one new backend route, three frontend touchpoints):
- **Crash capture:** `window.onerror` + `unhandledrejection` in renderer, `process.on('uncaughtException')` in `electron/main.ts` and `backend/server.js`. Sanitize stack traces (scrub `/Users/.+?/`, scrub project paths) before any storage or hashing. Hash-only identifier of stack content (`sha256(scrubbed_stack)`) clusters identical crashes without leaking content.
- **In-app feedback widget:** Title-bar `?` button + `Cmd+Shift+/` hotkey. Auto-prompts after a renderer error (only). Free-text "what were you trying to do?" + optional "attach state" checkbox that opens a preview of exactly what would attach (last 50 IPC actions with PII redacted, current route, hashed project ID). User reviews before submit.
- **Debug bundle export:** Help → Export Diagnostics menu item. Sanitized zip (no `.3dm` bytes, hashed filenames, last 500 console lines, anonymized commit-tree shape, app/Electron/Rhino/OS versions). User previews zip contents before sending. Email-attached or POSTed via opt-in.

All three POST to a new `backend/routes/feedback.js` route gated by `verifyAuth` (writes to a Supabase `feedback` table modeled on the `subscriptions` pattern).

**Rationale:** Closes three observability gaps simultaneously: zero error monitoring, zero qualitative pipe, zero support diagnostics. Apple's model — user-initiated, user-reviewed, user-transmitted — which is the only telemetry shape architects on confidential IP will accept. All three pieces share one backend route, so incremental shipping is natural (debug bundle first, crash capture second, in-app widget third).

**Downsides:** Auto-prompt-after-error needs careful tuning (annoying if it fires on transient network failures). The "review and send" flow adds friction that some users won't bother with — feedback-widget submission rates may be low. Sanitization is a moving target; a regression that lets a filename slip through is a real privacy incident.

**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. FileWatcher Lost-Work Nudge (Local-Only)
**Description:** `FileWatcherService` already detects every `.3dm` save. Add a per-project rolling counter `(saves_detected, commits_made)` over a 7-day window persisted to `.0studio/usage.jsonl`. When the gap exceeds a threshold (e.g., 20+ saves with zero commits), surface a gentle in-app toast: "You've saved 23 times since your last commit — want to checkpoint now?" Counter is computed and stored 100% locally; nothing is uploaded.

**Rationale:** Solves a real architect problem (Rhino crashes mid-session, lost work risk) AND surfaces our highest-value adoption-friction signal: the gap between "user is editing a file" and "user is using our product." This is the pattern no out-of-the-box analytics tool would see, because it's defined by the *absence* of an event. Product-feature-first, telemetry-second — the right ordering for a tool with an active user base.

**Downsides:** Threshold tuning is hard (architects iterate fast — 20 saves in a session is normal in some workflows). False-positive nudges train users to dismiss them; nudge becomes background noise. Without uploading the counter, founders only see this signal via the closed beta — but at current scale that's an acceptable trade-off.

**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

### 5. Launch Heartbeat + Auto-Updater (gated by #6)
**Description:** Add `electron-updater` (or equivalent self-hosted update mechanism) checking on launch and every 24 hours. Each check POSTs `{app_version, os_arch, locale}` to `backend/routes/heartbeat.js` (gated by Supabase JWT — already authenticated user); response carries `latest_version` for an in-app "update available" toast. The update check IS the user-visible payoff that justifies the network call. Aggregated DAU/WAU/MAU and version-fragmentation telemetry fall out for free as a backend log of heartbeats — no separate events table needed initially. Cadence: **launch + every 24h**, never every 30 minutes (that's a presence beacon, not an updater).

**Rationale:** Closes a real shipping gap. The app is unsigned with no auto-update mechanism — users currently re-download `.dmg` files manually, which means version fragmentation is silently accumulating. Pairs an observability win (true active-user counts and version distribution) with a real user-facing benefit (update notifications). Strongest "kills two birds" idea on the list.

**Downsides:** Requires #6 (Privacy Floor) to ship first — adding any outbound call without consent UI is a dark pattern. Code-signing/notarization is a separate prerequisite that's not yet done; auto-updater UX is poor on Gatekeeper-warned apps. Backend must host or proxy update artifacts (additional infra). Heartbeat-as-DAU is a denominator metric, not a behavior signal — needs to be paired with #1 to be useful.

**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 6. Privacy Floor: Consent UI + Allowlist + Optional Local Event Journal
**Description:** The infrastructure that gates every other idea on this list that sends data, packaged as one foundational PR sequence:
- **First-launch consent modal:** default OFF, no pre-checked boxes, with privacy policy + ToS visible *before* the modal appears
- **Strict written allowlist:** every field in every event must appear on a checked-in list (`docs/observability/event-allowlist.md`); no `payload jsonb`, no free-form strings, no filesystem paths, no commit messages, no branch names. Lint or compile-time enforcement preferred
- **Pseudonymous identifier:** `sha256(user_id + monthly_salt)` for sensitive event fields — labeled "pseudonymous, rotated monthly," **never** "anonymous"
- **One-click revocation** that DELETES prior events server-side, not just stops new emission
- **Local-only event journal** wrapped behind `src/lib/observability/journal.ts`, written to `~/Library/Application Support/0studio/events/<date>.jsonl`. Events accumulate locally; consented users send batches via the existing `verifyAuth` backend
- **Settings page section** showing exactly what was collected and when (the *useful* form of the privacy ledger — operates on real data the user can review pre-upload)
- **Pre-sanitization at the source:** scrub `/Users/.+?/`, project paths, filenames in any string field before it ever reaches an event payload

**Rationale:** Without this floor, every shipping idea above a certain line is unshippable. #5 (Heartbeat) is a dark pattern without it. Future telemetry that builds on the events table is unsafe without it. The allowlist is the structural defense against "let's just add one more field" drift that turns a well-intentioned analytics setup into a privacy incident at month 18. The local journal lets future ideas backfill the day a user opts in instead of starting from zero.

**Downsides:** Significant upfront cost; doesn't directly answer "what are users doing." Privacy policy + ToS need legal review. Settings/consent UI is engineering effort that produces no signal until later ideas ship on top. Will produce zero signal for users who decline (which, given this audience, may be 50%+).

**Confidence:** 70%
**Complexity:** Medium-High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | IPC interceptor auto-emitting method+args | Privacy nuke — payloads include filenames, branch names, project paths |
| 2 | Generic events table with `payload jsonb` (standalone) | Schemaless backend = schemaless leakage; absorbed into #6 with strict allowlist |
| 3 | Session stitching as its own epic | One column on the journal, not its own idea; folds into #6 |
| 4 | Privacy Ledger View as a separate UI panel | Vanity / consent theater; trust comes from policy and behavior, not a panel architects won't open |
| 5 | Unified observability primitive (track/flag/captureError in one client) | Premature abstraction; the three lifecycles differ in latency, retention, and consent |
| 6 | Auto-deprecation feature-flag loop | Actively dangerous to confidential-IP users; removes features under them based on noise at <1k scale |
| 7 | Personal Stats / Year-in-Review dashboard | Vanity unless paired with shipping data; partially absorbed into #6's settings page |
| 8 | First-week activation funnel (9 milestones) | Cohorts of 3 produce false confidence; revisit at ~500 signups |
| 9 | Free-vs-paid cohort comparator (standalone) | Subsumed by #1's weekly digest |
| 10 | Repurpose Realtime presence as session pulse | Weak signal at scale (dozens of events/week); subsumed by #1 |
| 11 | Backend rate-limit counter persistence | Operational metric, not user behavior; subsumed by #1 |
| 12 | Slow-action heatmap with p50/p95/p99 daily | p99 dashboards at <500 users are noise dashboards; defer until a user reports slowness |
| 13 | Abandoned-flow `useFlow()` detection | Refactor masquerading as instrumentation; ask the 5 users (#2) |
| 14 | Rage-click / retry-storm detection | Almost zero signal at this scale; revisit at 10k users |
| 15 | Dead-end-screen detection (route + 60s no-action) | False-positive factory in a creative tool where staring is normal |
| 16 | Silent IPC failure capture (standalone) | Folds into #3 (debug bundle) and #6 (event journal) |
| 17 | Commit-tree delta uploads as behavior log | Tree shape itself fingerprints client projects — most sensitive artifact in the app, hardest reject on the list |
| 18 | Team iteration-loop observability | Premature; team-collaboration features may not exist at the depth implied |
| 19 | Agent-driven proactive support (read-only Supabase view) | Requires #6 + meaningful event volume first; revisit at 12-month horizon |
| 20 | Heartbeat at 30-min cadence | Cadence is a presence beacon, not an updater — replaced by launch+24h in #5 |
| 21 | Stand-alone Diagnostics panel UI | Dashboard nobody opens; if signal is needed, surface in closed beta |

## Notes on Productive Disagreement

The two skeptic passes diverged sharply on one idea: **the user-facing Privacy Ledger View**. The practicality skeptic called it "two engineering weeks of consent theater" — a panel architects won't open on a CAD tool. The privacy skeptic called it the single best idea on the list — auditability of telemetry is what makes consent meaningful.

Resolution: rejected as a *separate UI panel* (it really is consent theater), but pulled forward the structural insights into #6 — the allowlist, default-off opt-in, one-click delete-server-side revocation, and a settings-page summary that operates on real collected data. The honesty is in the policy, the allowlist, and the deletion semantics — not in a panel.

## Implementation Sequencing Hint (not a plan)

If acted on, a natural ordering would be: #2 (closed beta — week 1, no code) → #1 (weekly digest — week 1-2, backend-only) → #4 (lost-work nudge — week 2-3, local-only) → #6 (privacy floor — week 4-6) → #5 (heartbeat + updater — week 7-8, gated by #6) → #3 (crash + feedback + bundle — week 9-12, layered onto consent UX).

Brainstorming any of these via `ce:brainstorm` would convert the survivor into requirements before planning.

## Session Log
- 2026-04-28: Initial ideation — 40 raw ideas across 5 frames (pain & friction, unmet need, inversion, assumption-breaking, leverage), ~27 unique after dedup, +4 cross-cutting syntheses, 6 survived adversarial filtering by practicality + privacy skeptics
- 2026-04-28: Idea #1 (Weekly Founder Digest) selected for brainstorming; pushed artifact to main
