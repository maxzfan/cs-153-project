---
title: "cleanup PR A — filesystem hygiene + abandoned-artifact decisions"
type: cleanup
status: active
date: 2026-04-29
origin: docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md
---

# Cleanup PR A — Filesystem Hygiene + Abandoned-Artifact Decisions

## Overview

One PR that lands every concrete, mechanical cleanup item plus the decide-and-act pass on abandoned-looking artifacts. No design judgment beyond "keep or delete?" per artifact, and every keep gets a one-line documented purpose. Together this eliminates the ~12 visible-irritant artifacts at the repo root that new contributors hit before they can navigate the actual code.

## Problem Statement

The repo has accumulated three classes of low-grade clutter, all visible at first glance:

1. **Build outputs in inconsistent gitignore state.** `.gitignore` lists `dist/` and `dist-electron/`, but pre-existing tracked files inside both directories were committed before the rule was added. Result: every build modifies tracked files (so `git status` always shows changes), but new files inside those dirs are silently ignored. Burned us in PR #24/#25 — required source-only commits with explicit file lists.

2. **Stray top-level files with unclear ownership.** Three loose `*.sql` migrations (`PROJECT_MEMBERS_MIGRATION.sql`, `SUBSCRIPTION_RLS_POLICY.sql`, `USAGE_PULSE_MIGRATION.sql`) belong under `supabase/`. `.DS_Store` shouldn't be tracked. A duplicate Finder file at `docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan 2.md` mirrors the canonical without the trailing space. `docs/backend-README.md` belongs at `backend/README.md`. The gstack skills section in `CLAUDE.md` is duplicated (lines 5-9 and 91-95).

3. **Abandoned-looking artifacts whose status nobody can confirm.** `homebrew/` directory + `HOMEBREW_SETUP.md` + `HOMEBREW_UPDATE.md` (distribution path?). `prpm.lock` (unrecognized lockfile). `icon.iconset/` + `0studio_mac_icon.png` at root (build assets in the wrong place). `env.ts` at root (loose TS file, unusual). Backend `test` script placeholder.

Each abandoned-looking item persists because nobody knows if deleting it breaks something. A decision pass either kills them or documents them. Either outcome ends the ambiguity.

## Proposed Solution

Two phases inside one PR. Phase 1 is mechanical and low-risk; Phase 2 needs a quick git-archeology + grep pass per artifact but no design work.

### Phase 1 — Mechanical sweep

**1a. Untrack `dist/` and `dist-electron/`.**
```bash
git rm --cached -r dist/ dist-electron/
```
After commit, future builds no longer dirty `git status`. Newly added files inside those dirs continue to be gitignored as expected.

**1b. Move top-level SQL migrations into `supabase/migrations/`.**

Pre-flight grep:
```bash
git grep -nE 'PROJECT_MEMBERS_MIGRATION|SUBSCRIPTION_RLS_POLICY|USAGE_PULSE_MIGRATION'
```
If any code path references them by basename or path, update those references in the same commit. Most likely candidates: `backend/scripts/digest-metrics.js`, `backend/scripts/verify-digest-metrics.js`, deployment docs.

Then:
```bash
mkdir -p supabase/migrations
git mv PROJECT_MEMBERS_MIGRATION.sql supabase/migrations/
git mv SUBSCRIPTION_RLS_POLICY.sql supabase/migrations/
git mv USAGE_PULSE_MIGRATION.sql supabase/migrations/
```

**1c. Add `.DS_Store` to `.gitignore` and untrack any tracked instances.**
```bash
echo '.DS_Store' >> .gitignore
git ls-files | grep -i '\.DS_Store$' | xargs -r git rm --cached
```

**1d. Delete the Finder duplicate plan file.**
```bash
git rm 'docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan 2.md'
```
Verify the canonical (no trailing space) version remains.

**1e. Remove `public/placeholder.svg` if unreferenced.**
```bash
git grep -n 'placeholder\.svg' && echo "still referenced — skip" || git rm public/placeholder.svg
```

**1f. Move `docs/backend-README.md` → `backend/README.md`.**
```bash
git grep -n 'docs/backend-README\.md' && echo "update referrers"
git mv docs/backend-README.md backend/README.md
```

**1g. Dedupe the gstack section in `CLAUDE.md`.**
Lines 5-9 and 91-95 are duplicates. Delete the second occurrence (lines 91-95) and verify the kept block is the more complete one (compare verbatim before deleting).

### Phase 2 — Decide-and-act on abandoned artifacts

For each artifact, run the decision rule, record the answer in the PR description, and act.

**2a. `homebrew/` directory + `HOMEBREW_SETUP.md` + `HOMEBREW_UPDATE.md`.**
```bash
git log --oneline -- homebrew/ | head -5         # last activity
git grep -n 'homebrew' .github/ scripts/         # CI / distribution refs
```
- If last activity < 6 months and CI references exist: **keep**, add a one-line "this is for X" header to each doc.
- Otherwise: **delete** all three.
- Either way, document the decision in the PR description.

**2b. `prpm.lock`.**
```bash
git grep -n 'prpm' .          # any reference?
git log --oneline -- prpm.lock | head -3
```
- If grep returns zero hits and last touch is far in the past: **delete**.
- Otherwise: **investigate further** — could be a bun/npm fork lockfile from an experimental tool.

**2c. `icon.iconset/` + `0studio_mac_icon.png` (root).**
```bash
git grep -n 'icon\.iconset\|0studio_mac_icon' .
```
electron-builder's mac icon resolution is the most likely consumer. Check `package.json:build.mac.icon` and `assets/icon.icns` (if present).
- If the iconset is the source for `assets/icon.icns` (or similar): **move both into `assets/` or `build/`**, update any path references.
- If unreferenced: **delete**.

**2d. `env.ts` at root.**
```bash
git grep -n "from ['\"]./env" vite.config.ts
```
Confirm it's imported by `vite.config.ts` for `vite-plugin-validate-env`. If yes (expected): **keep at root**, add a 3-line comment header to `env.ts` explaining its role, and add a one-line entry to `CLAUDE.md` under a new "Build configuration files" subsection.

**2e. Backend `test` script placeholder.**
Look at `backend/package.json` `scripts.test`. Two paths:
- **Replace** with a real `node --test backend/test-fixtures/**/*.test.js` runner if test fixtures exist (per CLAUDE.md's mention of digest tests).
- **Or delete** the script entry and document the no-test stance in `backend/README.md` (which Phase 1f just moved).

## Acceptance Criteria

After PR merges and a fresh `git clone` + `npm install` + `npm run build:electron`:

- [ ] `git status` is clean immediately (no modified `dist*/` files).
- [ ] `git ls-files dist/ dist-electron/` returns empty.
- [ ] `git ls-files | grep -i '.DS_Store'` returns empty.
- [ ] `find . -maxdepth 1 -name '*.sql'` returns empty.
- [ ] `ls supabase/migrations/` shows the three SQL files.
- [ ] `docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan 2.md` does not exist.
- [ ] `docs/backend-README.md` does not exist; `backend/README.md` does.
- [ ] `git grep -c 'gstack skills' CLAUDE.md` returns 1, not 2.
- [ ] PR description records a kept-or-deleted decision for each Phase 2 artifact.
- [ ] Every kept Phase 2 artifact has a documented purpose (header in the file, or one-line entry in `CLAUDE.md`).
- [ ] `npm run electron:dev` and `npm run electron:dist` both succeed (smoke test that nothing path-critical was moved).

## Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| A script hardcodes a path to one of the three SQL files (e.g., backend bootstrap) | Medium | Pre-flight `git grep` is the gate. After moves, run `npm run dev` on backend and any seed scripts as a smoke test. |
| Deleting `homebrew/` breaks an unadvertised distribution path | Medium | Check `.github/workflows/` for any `brew` references. If none, deletion is safe; install path can be reconstructed if a user later asks. |
| Deleting `prpm.lock` breaks an opt-in tool nobody mentioned in chat | Low | Worst case: tool produces the lockfile again on next run. Reversible. |
| `env.ts` decision wrong (it turns out to be unused) | Low | grep result is the gate; if no callers, skip the "keep + document" path and delete instead. |
| `git rm --cached -r dist*/` somehow corrupts dev workflow | Low | The directories themselves stay in the working tree (only the index is updated). Local rebuilds continue to work. |

## Resource Requirements

- One developer for half a day to one full day.
- No new dependencies.
- No CI changes (Phase 4 of the broader brainstorm adds the dist-tracking guard; this PR makes that future guard pass on day 1).

## Dependencies & Prerequisites

- Clean working tree (no in-flight branch with `dist*/` modifications you care about).
- `git grep` and `gh` available locally.

## Future Considerations

- The dist-tracking guard from PR B (Phase 4) is what prevents this debt from re-accumulating. Land PR A first; PR B's guard passes on day 1 because of PR A.
- The Phase 2 decisions made here should be linked from the PR description so future "what is this?" questions can find the answer in PR history.

## Documentation Plan

- One-line entry in `CLAUDE.md` if `env.ts` is kept (per 2d).
- One-line "this is for X" headers added to any kept Phase 2 docs.
- PR description records all Phase 2 decisions in a table.
