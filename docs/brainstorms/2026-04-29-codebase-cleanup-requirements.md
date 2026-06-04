---
date: 2026-04-29
type: cleanup
status: active
origin: docs/ideation/2026-04-28-codebase-cleanup-ideation.md
---

# Codebase Cleanup — Requirements

## Origin

Six survivors from the 2026-04-28 ideation pass on codebase cleanup. The ideation grounded in a fresh repo scan (3 stray top-level SQL files, drifting `dist*/` tracking, 15+ markdown files in `docs/` with overlapping concerns, abandoned-looking `homebrew/`+`prpm.lock`+`icon.iconset/`, no `docs/solutions/` knowledge base). All six survivors are brainstormed here as a single coherent program because the dependencies are tight: docs IA (#2) needs the abandoned-features decision (#3) before consolidation can finish; the lint hygiene script (#4) composes the untrack-dist work from #1 into a regression gate.

## Problem Statement

The repo accumulates ambient debt that's individually low-impact but collectively erodes velocity:

1. **Inconsistent state under .gitignore.** `dist/` and `dist-electron/` are ignored, but pre-existing tracked files inside them keep drifting. Newly added files in those paths are silently dropped from PRs (already burned us once during PR #24/#25 — the dist rebuild noise required source-only commits with explicit file lists).
2. **Stray top-level files muddy the entry-experience.** New contributors see `0studio_mac_icon.png`, `prpm.lock`, `icon.iconset/`, `env.ts`, `homebrew/` and three loose `*.sql` files at root and have no way to tell what's load-bearing.
3. **`docs/` sprawl with no lifecycle.** 15+ markdown files at the top of `docs/`, four subfolders (`brainstorms/`, `handoffs/`, `ideation/`, `plans/`) growing unbounded with no archival convention, overlapping pairs (AWS, Subscription, Homebrew) that diverge.
4. **No detection for new rot.** A cleanup pass without a regression gate degrades back to baseline within months.
5. **No institutional memory.** `docs/solutions/` does not exist. Every cleanup, every hardening pass, every fix evaporates as PR-only context.

## Goals

- **Eliminate visible irritants** that already cost human attention (gitignore drift, stray top-level files, duplicated CLAUDE.md sections).
- **Establish doc lifecycle** so future plans, brainstorms, handoffs land in obvious places and archived ones don't add noise.
- **Make new rot detectable** via a single `npm run lint:hygiene` script that catches the same classes we just cleaned up.
- **Capture the lessons** in `docs/solutions/` so the cleanup compounds instead of evaporating.

## Non-Goals

- **Backend JS → TS migration.** Scope creep — separate initiative.
- **Auto-archive scripts** that move docs without human review. Manual decision pass + archive folder is enough.
- **Auto-generated docs index from frontmatter.** Over-engineered for the volume; manual `docs/README.md` is enough.
- **Pre-commit hooks.** CI lint gives the same coverage with less developer friction.
- **Bikeshed-prone changes** (date-stamping every filename, renaming files to a "consistent" convention) without clear value.

## Phases

### Phase 1 — Filesystem hygiene sweep (mechanical)

**Description.** One PR moving easy mechanical wins. No design decisions, no abandoned-feature judgment calls.

**Deliverables.**
- `git rm --cached -r dist/ dist-electron/` so the existing `.gitignore` rule actually takes effect. Verify rebuild outputs no longer appear in `git status` after `npm run build:electron`.
- Move `PROJECT_MEMBERS_MIGRATION.sql`, `SUBSCRIPTION_RLS_POLICY.sql`, `USAGE_PULSE_MIGRATION.sql` to `supabase/migrations/`. Pre-flight: grep the codebase for any path reference to those filenames before moving (especially `backend/`).
- Add `.DS_Store` to `.gitignore` and `git rm --cached` any tracked instances.
- Delete `docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan 2.md` (Finder duplicate of the canonical file with no trailing space).
- Delete `public/placeholder.svg` if `git grep` finds no references. Otherwise note and skip.
- Move `docs/backend-README.md` → `backend/README.md`.
- Dedupe the gstack skills section in `CLAUDE.md` (currently appears at lines 5-9 and 91-95).

**Dependencies.** None. Pre-flight grep is the only gate.

**Acceptance.**
- After PR merges and a fresh checkout: `git status` is clean immediately after `npm install && npm run build:electron`.
- `git ls-files dist/ dist-electron/` returns empty.
- `git ls-files | grep '\.DS_Store'` returns empty.
- `find . -maxdepth 1 -name '*.sql'` returns empty.
- No grep hit for "backend-README" or "fix-file-watcher-chokidar-migration-plan 2".

**Complexity.** Low. Half a day of work plus review.

**Risk.** Pre-flight miss — a script or doc references a moved SQL file. Mitigation: grep, run the affected script (most likely `backend/scripts/digest-metrics.js` or similar), update if needed.

### Phase 2 — Decide-and-act on abandoned-looking artifacts

**Description.** For each questionable artifact, a quick git-archeology + grep pass decides keep-vs-delete. **Phase 2 must complete before Phase 3** because consolidating Homebrew docs depends on whether `homebrew/` survives.

**Inventory and decision rule.**

| Artifact | Decide via | Default action if abandoned |
|---|---|---|
| `homebrew/` directory | `git log -- homebrew/` last activity + grep for distribution refs in CI | Delete; remove `HOMEBREW_SETUP.md` + `HOMEBREW_UPDATE.md` |
| `prpm.lock` | grep for "prpm" anywhere in the tree; if zero references, it's a stale tool artifact | Delete |
| `icon.iconset/` + `0studio_mac_icon.png` (root) | Check electron-builder config for `icon` paths | Move to `assets/` or `build/` (whichever the icon path expects) |
| `env.ts` (root) | Already imported by `vite.config.ts` for `vite-plugin-validate-env` | Keep at root; document in CLAUDE.md why it's there |
| Backend `test` script placeholder | Backend already has `digest-metrics.js` + `verify-digest-metrics.js` | Replace placeholder with a real `node --test backend/test-fixtures/**/*.test.js` runner OR delete the script and document the no-test stance in `backend/README.md` |

For each item: write a one-line decision in the PR description and a one-line "this is for X" header in any kept item's accompanying doc. Document `env.ts`'s purpose in `CLAUDE.md` since it's the only loose TS file at root.

**Dependencies.** Phase 1 should land first (cleaner working tree). Otherwise standalone.

**Acceptance.**
- Every artifact in the inventory has a recorded decision (kept-with-doc or deleted) and the corresponding action is in the PR.
- A second-pass scan from a fresh clone surfaces no new "what is this?" candidates.

**Complexity.** Medium. ~30-60 minutes per item × 5 items.

**Risk.** Deletion of a load-bearing artifact. Mitigation: the grep + git log gate. Worst case: revert the delete commit.

### Phase 3 — `docs/` information architecture

**Description.** Establish a doc-lifecycle convention and act on it. Touches almost every file in `docs/` but the changes are small per file (move or frontmatter-add).

**Convention.**
- **Frontmatter status field.** Every plan, brainstorm, and handoff gets `status: active | completed | archived` in frontmatter. Plans default to `active`; on the merge of the PR that ships them, status flips to `completed`. After a documented "stale" interval (90 days idle, see Phase 6), `completed` may move to `archived`.
- **Archive folder.** `docs/archive/` holds files where status went to `archived`. Subdivided as `docs/archive/plans/`, `docs/archive/brainstorms/`, `docs/archive/handoffs/` to preserve provenance.
- **Top-level `docs/README.md` index.** One page documenting what each subdirectory is for, the lifecycle convention, and pointers to "where do I put a new X?" for plans/brainstorms/handoffs/ideation/solutions.

**Deliverables.**
- `docs/README.md` index page.
- `docs/archive/{plans,brainstorms,handoffs}/` directories created (with `.gitkeep` if empty).
- Frontmatter `status` field added to every existing plan/brainstorm/handoff that lacks it.
- Existing `completed` plans moved to `docs/archive/plans/` (initial seed). Use the windows-hardening plan and brainstorm as the first archive entries once they fully merge.
- Consolidation pass on overlapping doc pairs:
  - `AWS_BACKEND_DEPLOYMENT.md` + `AWS_SETUP.md` → one `AWS_DEPLOYMENT.md`. Diff the two, merge non-overlapping content carefully (do not concatenate blindly).
  - `SUBSCRIPTION_GATING_SETUP.md` + `SUBSCRIPTION_SERVICE_USAGE.md` → one `SUBSCRIPTION.md`.
  - The three `WINDOWS_*.md` files (CHECKLIST, INSTRUCTIONS, KNOWN_ISSUES): leave as-is. They serve different audiences and lifecycles. Add a one-line linker section to each.
- Document growth policy in `docs/README.md`: handoffs/ideation/brainstorms add freely; quarterly stale-doc detector pass (Phase 6) flags candidates for archival.

**Dependencies.** Phase 2 must complete first so the Homebrew consolidation in this phase is unambiguous (delete vs. keep depends on whether `homebrew/` lives).

**Acceptance.**
- `docs/README.md` exists and links to every subdirectory's purpose.
- Every plan/brainstorm/handoff has a `status` frontmatter field.
- AWS docs are one file. Subscription docs are one file.
- A new contributor reading `docs/README.md` can answer "where does my new feature plan go?" without asking.

**Complexity.** Medium. One day of work, mostly mechanical with two careful merges.

**Risk.** Bad merge of overlapping AWS/Subscription docs (lossy). Mitigation: side-by-side diff before merging; preserve any unique content from both, even if redundant in the merged doc; let the next reader prune in a follow-up.

### Phase 4 — `npm run lint:hygiene` regression gate

**Description.** Composite npm script that runs three checks under one umbrella. Wires into the existing CI gate. Document the noise allowlist explicitly so future maintenance is auditable.

**Components.**

1. **`ts-prune`** for unused exports across `src/` and `electron/`. Existing `.ts-prunerc` config controls allowlist (e.g., entry points, type-only re-exports).
2. **`depcheck`** for unused npm dependencies and missing devDependencies. Same pattern: `.depcheckrc` for allowlist.
3. **Custom dist-tracking guard** — `scripts/lint-dist-tracking.cjs` fails CI if `git ls-files dist/ dist-electron/` returns any output. Catches accidental commits before they enter history.

**Deliverables.**
- `package.json` adds `lint:hygiene` script that runs all three sequentially (fail-fast).
- `.ts-prunerc` and `.depcheckrc` seeded with current-state allowlists.
- `scripts/lint-dist-tracking.cjs`.
- CI integration: add `npm run lint:hygiene` to the existing GitHub Actions workflow that already runs `npm run lint`.

**Dependencies.** Phase 1 must complete (otherwise the dist-tracking guard fails on day 1 from pre-existing tracked files).

**Acceptance.**
- `npm run lint:hygiene` runs locally and exits 0 against current main.
- Adding `import { unused } from "./foo"` to a random file fails the CI step (manual smoke).
- Committing a file under `dist-electron/` fails the dist-tracking guard.
- The allowlist files exist and are documented in `CONTRIBUTING.md` (or `docs/README.md`) so future maintainers know how to extend them.

**Complexity.** Low. Half a day plus the time spent tuning the noise allowlists (which is real — `ts-prune` flags type-only exports as unused if you don't tell it otherwise).

**Risk.** Allowlist becomes a write-only graveyard, masking real rot. Mitigation: the stale-doc detector (Phase 6) eventually proves the pattern by flagging unused entries automatically; for `ts-prune`/`depcheck`, periodic manual review is the price.

### Phase 5 — Bootstrap `docs/solutions/`

**Description.** Per the Windows hardening plan's Future Considerations and the learnings-researcher's recommendation. Create the folder, define the convention, seed with three real entries from the hardening track that just landed.

**Convention.**

```markdown
---
title: <one-line solution title>
tags: [electron, oauth, security]
applies_to: [packaged-electron, windows, mac]
last_verified: 2026-04-29
---

# <Title>

## Problem
<one-paragraph problem framing>

## Pattern
<the pattern, with code/config examples>

## Why this works
<rationale, edge cases, what NOT to do>

## References
- <link to PR / commit / spec / RFC>
```

**Seed entries.**
1. `cross-platform-path-normalization.md` — equality-comparison paths get lowercased on Windows; UI-display paths do not. Distilled from `electron/lib/argv-util.ts` (Phase 3) plus the `path-util.ts`/`isSupportedProjectFile` extraction.
2. `oauth-loopback-pkce.md` — RFC 8252 loopback flow, why it beats custom protocol, the host/state/single-shot hardening list. Distilled from `electron/services/oauth-service.ts` and `scripts/smoke-oauth.cjs` (Phase 4 of windows-hardening).
3. `electron-log-redaction.md` — 9-pattern redactor, when to install on main vs renderer, why the test fixture matters. Distilled from `electron/lib/log-redact.ts` + `log-redact.test.ts` (Phase 5 of windows-hardening).

**Dependencies.** None — can land before or in parallel with anything else. But the seeds depend on PRs #24 and #25 having merged so the references aren't dead links.

**Acceptance.**
- `docs/solutions/` exists with the three seed entries plus a `README.md` documenting the frontmatter convention.
- The `compound-engineering:research:learnings-researcher` agent invoked with a relevant query (e.g., "OAuth loopback patterns") returns these entries.
- `docs/README.md` (from Phase 3) links to `docs/solutions/`.

**Complexity.** Low. One day to write three solid entries that future agents can actually use.

**Risk.** Empty-shell adoption — folder exists, nobody fills it. Mitigation: the seed PR establishes the bar with real content, and the cleanup PR itself becomes the fourth entry (`codebase-cleanup-pattern.md` written after Phases 1-4 land).

### Phase 6 — `npm run lint:stale-docs` detector

**Description.** `scripts/detect-stale-docs.cjs` flags candidate-for-archival docs. Doesn't auto-archive. The output is a report; the human decides.

**Algorithm.**
1. Walk `docs/**/*.md`, excluding `docs/archive/` and `docs/solutions/`.
2. For each file, get last-modified date via `git log -1 --format=%cI -- <file>`.
3. Build a reference graph: scan all `.md`, `README*`, and `CLAUDE.md` files for path references (relative paths, file basenames, frontmatter `origin:` fields).
4. Flag any file matching ALL of:
   - last modified > 90 days ago, AND
   - not referenced from any other in-repo doc, AND
   - frontmatter `status` is not `active` (if status field exists).
5. Output a markdown report grouped by directory.

**Deliverables.**
- `scripts/detect-stale-docs.cjs`.
- `package.json` `lint:stale-docs` script.
- Add to `lint:hygiene` umbrella (Phase 4) but as warning-only (exit 0 with output to stdout) so quarterly review is a deliberate read, not a CI fail.
- Documented in `docs/README.md` (Phase 3) as "quarterly maintenance ritual."

**Dependencies.** Phase 3 (uses the `status` frontmatter convention). Phase 4 (composes into `lint:hygiene`).

**Acceptance.**
- `npm run lint:stale-docs` produces a report against current state. Manual review of the first report is a small follow-up commit.
- Report distinguishes "no references + old + not active" from "old but actively referenced" so false positives are visible.

**Complexity.** Medium. One day. Reference detection is the tricky part — needs careful regex that handles relative paths, basenames, and markdown link syntax `[text](path)`.

**Risk.** False positives mask real rot under noise. Mitigation: warning-only mode + review-first culture. False negatives (e.g., docs only referenced from PR descriptions, not from the repo) are accepted — those docs persist until someone notices, which is fine.

## PR shape

The 6 phases collapse to 3 PRs:

- **PR A: mechanical sweep** = Phase 1 + Phase 2. Both are concrete and small enough to bundle. ~1 day.
- **PR B: information architecture + detection** = Phase 3 + Phase 4 + Phase 6. The IA work and the lint scripts naturally co-evolve (lint scripts test IA correctness). ~2 days.
- **PR C: knowledge base** = Phase 5. Seeds `docs/solutions/`. Independent and parallelizable; can land before, after, or alongside PR B. ~1 day.

Each PR ships independently — no stacked-PR pattern needed since dependencies are mostly file-system and internal to a single PR.

## Cross-cutting concerns

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Pre-flight grep miss in Phase 1 (script depends on a moved SQL file path) | Medium | Run grep from clean checkout; smoke-test affected scripts |
| Lossy merge of AWS/Subscription doc pairs (Phase 3) | Medium | Side-by-side diff before merging; preserve unique content even if redundant |
| Allowlist sprawl in Phase 4 (`ts-prune`/`depcheck`) | Low | Add a `# REASON:` comment to every allowlist entry; quarterly manual review |
| Empty-shell adoption of `docs/solutions/` | Medium | Seed with 3 real entries from Windows hardening; require future plans to add a solutions entry on completion |
| Stale-doc detector noise erodes trust | Medium | Warning-only output, not CI-fail; monthly read-and-prune ritual |

### Open questions

1. **Is `homebrew/` actively shipped or abandoned?** Determines whether `HOMEBREW_*.md` lives or dies (Phase 2). Resolve via `git log -- homebrew/` + a question to the maintainer if not obvious.
2. **Does `electron-builder` config reference `icon.iconset/` or `0studio_mac_icon.png` at root?** Determines move target (Phase 2).
3. **Does the team want the stale-doc detector wired to fail CI on stale `archived` candidates, or remain warning-only?** Default to warning-only; revisit after first quarter.

### Success metrics

- **Cleanup-pass debt index.** Count visible-irritant artifacts at root (loose SQL files, stray PNGs, `.DS_Store`, abandoned dirs). Should drop from ~12 today to 0 after PR A.
- **`docs/` discoverability.** Time-to-answer for "where does my new feature plan go?" — target: under 30 seconds for a new contributor reading `docs/README.md`.
- **Regression resistance.** A deliberate `git add dist-electron/foo.js && git commit` should fail CI after PR B.
- **Knowledge compounding.** `docs/solutions/` has at least 4 entries within 30 days of PR C (3 seeds + 1 from cleanup itself). Future cleanups reference at least one solutions entry.

## Recommended next step

`ce:plan` against this brainstorm — likely two plan documents:
- `docs/plans/2026-MM-DD-001-cleanup-pr-a-mechanical.md` covering Phases 1+2
- `docs/plans/2026-MM-DD-002-cleanup-pr-b-doc-ia-and-lint.md` covering Phases 3+4+6
- (Phase 5 / PR C may be small enough to skip the formal plan and go straight to implementation; decide during planning.)
