---
date: 2026-04-28
topic: codebase-cleanup
focus: clean up codebase, like unused docs, etc
---

# Ideation: Codebase Cleanup

## Codebase Context

**Project shape.** Electron + React (TypeScript, Vite) desktop app for 3D model version control. Express (JS) backend under `backend/`. Supabase + Stripe. Top-level layout: `electron/`, `src/`, `backend/`, `docs/`, `scripts/`, `public/`, `supabase/`, plus build configs and three loose `*.sql` files.

**Notable conventions.** Frontend is TS, backend is JS (deliberate split). Three TS configs. `@/` alias to `src/`. No automated tests; backend `test` script is a placeholder. Docs live under `docs/` with subfolders `brainstorms/`, `feature-summaries/`, `handoffs/`, `ideation/`, `plans/`, `process/`, `superpowers/`.

**Past learnings.** `docs/solutions/` does not exist. The 2026-04-06 open ideation doc flagged "build artifacts tracked in git" as a key gap, never followed up. The Windows hardening plan recommends bootstrapping `docs/solutions/` as a compounding-asset move.

**Concrete cleanup signals (from grounding scan):**
- Three top-level `.sql` migrations (`PROJECT_MEMBERS_MIGRATION.sql`, `SUBSCRIPTION_RLS_POLICY.sql`, `USAGE_PULSE_MIGRATION.sql`) that should live under `supabase/`
- `dist/`, `dist-electron/` — gitignored but already-tracked files persist; new files in those dirs get silently ignored, creating an inconsistent state
- Stray top-level files: `0studio_mac_icon.png`, `icon.iconset/`, `env.ts`, `prpm.lock`, possibly `homebrew/`
- 15+ markdown files at top of `docs/` with overlapping concerns (Windows trio, AWS pair, Subscription pair, Homebrew pair, root README vs `docs/README.md`, `backend-README.md` outside `backend/`)
- Unbounded growth in `handoffs/`, `brainstorms/`, `ideation/` without an archival convention
- `public/placeholder.svg` (Vite scaffold leftover)
- `CLAUDE.md` has a duplicated gstack section (lines 5-9 and 91-95)
- One Finder duplicate spotted: `docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan 2.md`
- `.claude/worktrees/` shows as modified in git status

## Ranked Ideas

### 1. Filesystem hygiene sweep (one-shot PR)

**Description.** Single mechanical PR that:
- Moves the three top-level `*.sql` files into `supabase/migrations/` (or deletes if confirmed already applied + redundant)
- Runs `git rm --cached -r dist/ dist-electron/` so the gitignore actually takes effect; rebuilds are no longer committed
- Adds `.DS_Store` to `.gitignore` and removes any tracked instances
- Removes `docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan 2.md` (Finder duplicate)
- Removes `public/placeholder.svg` if unreferenced
- Moves `docs/backend-README.md` → `backend/README.md`
- Dedupes the gstack skills section in `CLAUDE.md`

**Rationale.** Every item is concrete, mechanical, no design risk. Eliminates ~10-15 visible irritants in one shot. Untracking `dist*/` is the highest-leverage piece — current state is the worst-of-both-worlds where new build files are gitignored but old ones drift.

**Downsides.** Touches many files (review noise). Small chance a script hardcodes a path to one of the SQL files (need to grep before moving).

**Confidence.** 90%
**Complexity.** Low
**Status.** Explored — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`

### 2. docs/ information architecture pass

**Description.** Establish doc-lifecycle convention and act on it:
- Create `docs/archive/` and move completed plans/brainstorms/handoffs whose status is `completed` (per frontmatter)
- Write `docs/README.md` as a one-page index explaining what each subdirectory is for and the lifecycle convention
- Consolidate the overlapping pairs: `AWS_BACKEND_DEPLOYMENT.md` + `AWS_SETUP.md`, `SUBSCRIPTION_GATING_SETUP.md` + `SUBSCRIPTION_SERVICE_USAGE.md`, the three `WINDOWS_*.md` files (one combined "Windows tester pack" page that links the three)
- Document growth policy for `handoffs/`, `brainstorms/`, `ideation/` (auto-archive after N rounds or on plan completion)

**Rationale.** Without convention, every new feature adds noise to `docs/`. An index + archive policy compounds: future docs find their slot, future agents find context faster.

**Downsides.** Bikeshed risk on convention. Consolidating overlapping docs may lose nuance — needs careful merging, not blind concatenation.

**Confidence.** 80%
**Complexity.** Medium
**Status.** Explored — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`

### 3. Decide-and-act pass on abandoned-looking artifacts

**Description.** For each questionable artifact, make an explicit keep-vs-delete decision via a quick git-archeology + grep pass, then act:
- `homebrew/` folder + `HOMEBREW_SETUP.md` + `HOMEBREW_UPDATE.md` — abandoned distribution path? If yes, delete all three. If retained, write a one-line "this is for X" header at top of the docs.
- `prpm.lock` — what tool produced this? If unused, delete.
- `icon.iconset/` + `0studio_mac_icon.png` at root — move to `assets/` or `build/`, or delete if superseded.
- `env.ts` at root — Vite env validation file. Decide if it stays at root or moves to `electron/`.
- Backend `test` script placeholder — replace with the digest test runner that exists, or delete the script and document the no-test stance.

**Rationale.** Several abandoned-looking artifacts persist because nobody knows if they're load-bearing. A decision pass either kills them or documents their purpose. Either outcome ends the ambiguity.

**Downsides.** Requires institutional memory or git archeology for each item. ~30 minutes per item adds up.

**Confidence.** 85%
**Complexity.** Medium
**Status.** Explored — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`

### 4. `npm run lint:hygiene` — automated rot detection

**Description.** Single composite script that runs three checks and fails CI on any:
- `ts-prune` for unused exports across `src/` and `electron/`
- `depcheck` for unused npm dependencies and missing dev-deps
- A custom grep that fails if any new file lands in `dist/` or `dist-electron/` paths (catches accidental commits before they enter history)

Wire into the existing CI gate. Document the noise allowlist in a `.lint-hygienerc` config so future maintenance has a clear undo.

**Rationale.** Without detection, rot accumulates silently. Lifts one-off cleanup into a maintenance ritual that runs every PR.

**Downsides.** `ts-prune` and `depcheck` have known noise rates; allowlist tuning is needed. Adds two npm dev-dependencies.

**Confidence.** 75%
**Complexity.** Low
**Status.** Explored — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`

### 5. Bootstrap `docs/solutions/` as the institutional knowledge base

**Description.** Create `docs/solutions/` per the Windows hardening plan's recommendation. Seed with three first entries:
- `cross-platform-path-normalization.md` — patterns for paths shown in UI vs. compared for equality
- `oauth-loopback-pattern.md` — the loopback PKCE flow and why it beats custom protocols
- `electron-log-redaction.md` — the 9-pattern redactor + tests as a reusable hardening recipe

Adopt frontmatter conventions (`title`, `tags`, `applies_to`, `last_verified`) so future agents searching via `compound-engineering:research:learnings-researcher` find these.

**Rationale.** Without this folder, every cleanup or hardening pass is ephemeral — context evaporates. With it, each completed plan gives back a durable lesson. Compounds across teammates and AI agents.

**Downsides.** Folder only matters if filled. Risk of empty-shell adoption. Needs disciplined seeding from the windows-hardening + cleanup PRs.

**Confidence.** 70%
**Complexity.** Low
**Status.** Explored — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`

### 6. `npm run lint:stale-docs` — periodic doc-rot detector

**Description.** `scripts/detect-stale-docs.cjs` that flags any `docs/**/*.md` file matching BOTH:
- not modified in the last 90 days, AND
- not referenced (link, mention, or path) from any other in-repo `.md`, `README`, or `CLAUDE.md`

Outputs a "candidates for archival" report. Run quarterly via the same `lint:hygiene` umbrella from idea #4. Flags don't auto-archive — the report is the trigger for a human decision pass.

**Rationale.** Doc rot is invisible to ESLint. Auto-detection turns "do we still need this?" from a memory burden into a periodic batch. Especially compounds for `handoffs/`, `brainstorms/`, `ideation/` which grow unbounded.

**Downsides.** Reference detection has false positives (docs referenced from PRs or commits, not from in-repo files). Time-based threshold is heuristic — actively-correct docs can sit untouched for >90 days.

**Confidence.** 65%
**Complexity.** Medium
**Status.** Explored — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Auto-archive script for completed plans | Over-engineered; manual sweep + archive folder (#2) is enough |
| 2 | Date-stamp all filenames consistently | Bikeshed; doesn't move the needle |
| 3 | Audit and remove unused imports | ESLint already covers it |
| 4 | Convert backend from JS to TS | Legitimate but a separate initiative; out of scope for cleanup |
| 5 | Pre-commit hook for dist/.DS_Store | Too process-y; CI lint (#4 above) gives same coverage with less friction |
| 6 | `npm dedupe` for package-lock | Trivial; no real signal of bloat |
| 7 | Auto-generated docs index from frontmatter | Over-engineered; manual index (#2) is enough |
| 8 | Move SQL files (standalone) | Bundled into Survivor #1 |
| 9 | Stop tracking dist/* (standalone) | Bundled into Survivor #1 |
| 10 | .DS_Store gitignore (standalone) | Bundled into Survivor #1 |
| 11 | Delete prpm.lock (standalone) | Bundled into Survivor #3 (decide-then-act) |
| 12 | Relocate env.ts (standalone) | Bundled into Survivor #3 |
| 13 | Delete placeholder.svg (standalone) | Bundled into Survivor #1 |
| 14 | Move icon.iconset (standalone) | Bundled into Survivor #3 |
| 15 | Investigate homebrew/ (standalone) | Became core of Survivor #3 |
| 16 | Move backend-README (standalone) | Bundled into Survivor #1 |
| 17 | Consolidate AWS docs | Bundled into Survivor #2 |
| 18 | Consolidate Subscription docs | Bundled into Survivor #2 |
| 19 | Consolidate Homebrew docs | Bundled into Survivor #3 (gated by homebrew decision) |
| 20 | Delete " 2.md" Finder duplicate | Bundled into Survivor #1 |
| 21 | docs/archive/ folder (standalone) | Bundled into Survivor #2 |
| 22 | docs/ index page (standalone) | Bundled into Survivor #2 |
| 23 | CLAUDE.md gstack dedupe (standalone) | Bundled into Survivor #1 |
| 24 | Verify simple-git removal | Already shipped in PR #23 |
| 25 | ts-prune (standalone) | Bundled into Survivor #4 |
| 26 | depcheck (standalone) | Bundled into Survivor #4 |
| 27 | CI lint for dist tracking (standalone) | Bundled into Survivor #4 |
| 28 | Doc-lifecycle convention (standalone) | Bundled into Survivor #2 |
| 29 | "what is this file" CLI script | Over-engineered; covered by Survivor #2's index |

## Session Log
- 2026-04-28: Initial ideation — 33 candidates generated, 13 rejected, 14 bundled into thematic survivors, 6 final survivors (4 mechanical + 2 compounding-leverage). Ideation skipped sub-agent dispatch because grounding scan already surfaced concrete candidates.
- 2026-04-29: All 6 survivors brainstormed as a single coherent cleanup program — see `docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md`. Phases were sequenced to honor dependencies (e.g., #2 docs IA depends on #3 homebrew decision).
