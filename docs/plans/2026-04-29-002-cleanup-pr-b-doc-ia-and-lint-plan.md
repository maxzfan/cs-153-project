---
title: "cleanup PR B — docs information architecture + automated rot detection"
type: cleanup
status: active
date: 2026-04-29
origin: docs/brainstorms/2026-04-29-codebase-cleanup-requirements.md
---

# Cleanup PR B — Docs Information Architecture + Automated Rot Detection

## Overview

Three coupled phases that turn the cleanup pass into a self-maintaining system: (1) establish a doc lifecycle convention and act on it, (2) wire `npm run lint:hygiene` to catch the same rot classes via CI, (3) ship a warning-only `lint:stale-docs` detector for periodic doc-rot reviews. Together they make new contributors find their way around `docs/` faster, prevent the `dist*/` regression that PR A just fixed, and turn doc rot from "memory burden" into "quarterly batch."

## Problem Statement

Three observed issues compound:

1. **`docs/` sprawl with no lifecycle.** 15+ markdown files at the top level of `docs/`, four subfolders (`brainstorms/`, `handoffs/`, `ideation/`, `plans/`) growing unbounded with no archival convention. Overlapping pairs (`AWS_BACKEND_DEPLOYMENT.md` + `AWS_SETUP.md`; `SUBSCRIPTION_GATING_SETUP.md` + `SUBSCRIPTION_SERVICE_USAGE.md`) that diverge over time. New contributors can't tell where a feature plan or design doc should live.

2. **No regression gate for the rot we just cleaned up.** PR A untracks `dist*/`, but nothing prevents the next maintainer from `git add dist-electron/foo.js && git commit`. Same for unused exports (`ts-prune` not configured) and unused dependencies (`depcheck` not configured). Without a gate, debt re-accumulates within months.

3. **Doc rot is invisible.** A doc untouched for a year and not referenced from anywhere is dead, but nothing surfaces it. The `handoffs/`, `brainstorms/`, `ideation/` directories are the worst offenders — they grow forever and nobody re-reads the old entries.

## Proposed Solution

Three phases shipped as one PR. Phase 3 establishes the convention; Phase 4 enforces hygiene at PR-time; Phase 6 adds a quarterly-cadence detector. (Phase numbering matches the brainstorm doc; Phase 5 / `docs/solutions/` ships separately as PR C.)

### Phase 3 — `docs/` information architecture

**3a. Frontmatter `status` field convention.**

Add to every plan/brainstorm/handoff (existing files plus new convention going forward):

```yaml
---
status: active   # one of: active | completed | archived
---
```

- `active` — work in progress.
- `completed` — work shipped; doc kept for reference.
- `archived` — older than 90 days idle AND no in-repo reference; moved to `docs/archive/`.

The seed pass adds `status:` to every existing file. Default rule: any plan whose origin PR has merged → `completed`; everything else → `active`.

**3b. `docs/archive/` structure.**

```
docs/archive/
├── plans/         # completed plans whose status moved to archived
├── brainstorms/   # completed brainstorms whose plan landed and aged out
└── handoffs/      # tester rounds that closed out
```

Initial seed: move the windows-hardening plan + brainstorm + round-1 handoff to `archive/` once their PRs (#24, #25, #26) merge and a follow-up confirms tester round 1 passes. (May be a follow-up commit to this PR if the timing doesn't align.)

**3c. `docs/README.md` — the index.**

One page covering:
- What lives in each subdirectory (one paragraph each: `plans/`, `brainstorms/`, `handoffs/`, `ideation/`, `solutions/`, `archive/`, `superpowers/`, `process/`, `feature-summaries/`).
- The lifecycle convention (where `active` → `completed` → `archived` happens).
- "Where do I put a new X?" decision tree for plans, brainstorms, handoffs, solutions.
- Pointers to top-level guides (BUILD_GUIDE, AWS_DEPLOYMENT, SUBSCRIPTION, etc.) with a one-line description each.
- Quarterly maintenance ritual: run `npm run lint:stale-docs`, review, archive flagged entries.

**3d. Consolidate overlapping doc pairs.**

For each pair, do a side-by-side diff and merge into one canonical doc. Preserve any content that's unique to either; let the next reader prune redundancy in a follow-up rather than risk losing nuance.

- `AWS_BACKEND_DEPLOYMENT.md` + `AWS_SETUP.md` → `AWS_DEPLOYMENT.md`. The former probably covers deploying the Express backend; the latter probably covers initial AWS account setup. Merge with subsections: "Initial setup" + "Deployment".
- `SUBSCRIPTION_GATING_SETUP.md` + `SUBSCRIPTION_SERVICE_USAGE.md` → `SUBSCRIPTION.md`. Subsections: "Gating setup" + "Service usage".
- The three `WINDOWS_*.md` files (CHECKLIST, INSTRUCTIONS, KNOWN_ISSUES) **stay separate**. Different audiences (tester vs. team) and different lifecycles (the CHECKLIST regenerates per round). Add a one-line linker section ("See also: …") at the top of each.
- Homebrew docs (`HOMEBREW_SETUP.md` + `HOMEBREW_UPDATE.md`): if PR A's Phase 2 deleted them, no consolidation needed. If kept, merge into one `HOMEBREW.md`.

### Phase 4 — `npm run lint:hygiene` regression gate

**4a. Composite npm script.**

```json
"lint:hygiene": "npm run lint:hygiene:exports && npm run lint:hygiene:deps && npm run lint:hygiene:dist",
"lint:hygiene:exports": "ts-prune -p tsconfig.json --error",
"lint:hygiene:deps": "depcheck --ignores '...' --quiet",
"lint:hygiene:dist": "node scripts/lint-dist-tracking.cjs"
```

Run sequentially with fail-fast. Each subcommand exits non-zero on a finding; the umbrella aggregates.

**4b. Allowlists, with reason comments.**

`.ts-prunerc` (or inline config in `package.json`):
```json
{
  "ignore": [
    "src/main.tsx",
    "electron/main.ts",
    "src/vite-env.d.ts"
  ]
}
```

`.depcheckrc.json`:
```json
{
  "ignores": [
    "@types/*",
    "eslint-plugin-*"
  ]
}
```

Every entry in either allowlist must have a `// REASON: ...` comment (or equivalent for JSON-without-comments — use a peer `.allowlist-rationale.md` file).

**4c. Custom dist-tracking guard — `scripts/lint-dist-tracking.cjs`.**

```js
const { execSync } = require('node:child_process');
const out = execSync('git ls-files dist/ dist-electron/', { encoding: 'utf8' }).trim();
if (out) {
  console.error('lint:hygiene:dist — these tracked files violate .gitignore:');
  console.error(out);
  console.error('\nRun: git rm --cached <file> ...');
  process.exit(1);
}
console.log('lint:hygiene:dist — clean');
```

Catches accidental commits before they enter history. Composes with PR A's untracking work — PR A makes day-1 baseline pass; this guard prevents regression.

**4d. CI integration.**

Add `npm run lint:hygiene` to the existing GitHub Actions workflow that already runs `npm run lint`. Same triggers (PR + push to main). Failure blocks merge.

### Phase 6 — `npm run lint:stale-docs` detector

**6a. `scripts/detect-stale-docs.cjs`.**

```js
// Walk docs/**/*.md (excluding archive/, solutions/).
// For each file:
//   - lastModifiedISO = git log -1 --format=%cI -- <file>
//   - status = parsed frontmatter (default: 'active' if absent)
// Build reference graph by scanning every .md / README* / CLAUDE.md
// for path references (relative paths, file basenames, frontmatter origin: fields).
//
// Flag files matching ALL of:
//   - last modified > 90 days ago
//   - not referenced from any other in-repo doc
//   - status !== 'active'
//
// Output: markdown report grouped by directory, written to stdout.
// Exit code: always 0 (warning-only).
```

**6b. Composition into `lint:hygiene` umbrella.**

Add as a final, warning-only step:
```json
"lint:hygiene": "... && npm run lint:stale-docs || true"
```

The `|| true` keeps it warning-only — output goes to CI logs but doesn't fail the build. Quarterly review is the trigger.

**6c. Documented in `docs/README.md`** under a "Quarterly maintenance" section: "Run `npm run lint:stale-docs`, read the report, decide which flagged docs move to `docs/archive/`. Aim for 30 minutes per quarter."

## Acceptance Criteria

### Phase 3
- [ ] `docs/README.md` exists, < 200 lines, links every subdirectory's purpose.
- [ ] Every plan/brainstorm/handoff has a `status:` frontmatter field.
- [ ] `docs/archive/{plans,brainstorms,handoffs}/` directories exist (with `.gitkeep` if empty).
- [ ] `docs/AWS_DEPLOYMENT.md` exists; `AWS_BACKEND_DEPLOYMENT.md` and `AWS_SETUP.md` removed.
- [ ] `docs/SUBSCRIPTION.md` exists; `SUBSCRIPTION_GATING_SETUP.md` and `SUBSCRIPTION_SERVICE_USAGE.md` removed.
- [ ] Each Windows tester doc has a "See also:" linker section pointing at the other two.
- [ ] A new contributor can answer "where does my new feature plan go?" by reading only `docs/README.md`.

### Phase 4
- [ ] `npm run lint:hygiene` runs locally, exits 0 against current main.
- [ ] Adding a junk unused export (`export const unused = 1`) to a random TS file fails `lint:hygiene:exports`.
- [ ] `git add dist-electron/foo.js && git commit && npm run lint:hygiene:dist` fails.
- [ ] CI workflow runs `lint:hygiene` on every PR. A test PR with a manufactured violation fails CI.
- [ ] `.ts-prunerc` and `.depcheckrc.json` (or equivalent) exist with rationale comments for every allowlist entry.

### Phase 6
- [ ] `npm run lint:stale-docs` runs against current state, produces a report, exits 0.
- [ ] Report distinguishes "stale + unreferenced + not active" from "stale but actively referenced" so false positives are visible.
- [ ] `lint:hygiene` umbrella invokes `lint:stale-docs` warning-only.
- [ ] `docs/README.md` documents the quarterly review ritual.

## Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| Lossy merge of AWS docs (Phase 3d) loses content | Medium | Side-by-side diff before merging; preserve unique content even if redundant in merged doc; tag a follow-up "tighten AWS_DEPLOYMENT" issue. |
| Lossy merge of Subscription docs | Medium | Same mitigation as above. |
| `ts-prune` allowlist sprawl masks real rot | Medium | Every allowlist entry has `// REASON:` comment. Quarterly read-through during stale-doc review. |
| `depcheck` flags `@types/*` packages as unused (well-known) | Low | Add `@types/*` to allowlist with `// REASON: type-only` comment. |
| `lint:stale-docs` reference detection has false positives (markdown link parsing) | Medium | Warning-only mode prevents CI fails; manual review filters false positives at quarter boundaries. |
| `lint:stale-docs` false negatives (docs only referenced from PR descriptions) | Accepted | These persist until someone notices. Acceptable. |
| New contributors don't read `docs/README.md` | Medium | Link from root `README.md`. Reference from CLAUDE.md so AI agents surface it. |

## Resource Requirements

- One developer for ~2 days. Phase 3 is the bulk of the time (consolidation merges + frontmatter pass).
- New dev dependencies: `ts-prune`, `depcheck`. Both are standard, well-maintained.
- No new SaaS / external services.

## Dependencies & Prerequisites

- **PR A must merge first.** PR A's untracking of `dist*/` makes the day-1 baseline of `lint:hygiene:dist` pass. PR A's homebrew decision determines whether Phase 3d consolidates the Homebrew docs or skips them.
- Existing CI workflow runs `npm run lint` and is open to adding additional steps.

## Future Considerations

- A future PR can tighten merged AWS/Subscription docs once we see what reviewers actually use.
- A future PR can add a `solutions/` sub-detector to `lint:stale-docs` (verify `applies_to:` references in frontmatter still exist, etc.).
- If `lint:stale-docs` proves accurate, consider promoting it from warning-only to CI-fail for `archived` candidates after one quarter of human-validated runs.
- Tooling drift: `ts-prune` is in low-maintenance mode upstream. If it goes unmaintained, `tsr` (https://github.com/tsr-tools/tsr) is the supported successor — swap is a one-line script change.

## Documentation Plan

- `docs/README.md` (new) — the central index.
- `docs/AWS_DEPLOYMENT.md` (consolidated from two files).
- `docs/SUBSCRIPTION.md` (consolidated from two files).
- `.allowlist-rationale.md` next to `.depcheckrc.json` documenting each allowlist entry's reason.
- One-line entry in root `README.md` pointing at `docs/README.md`.
- One-line entry in `CLAUDE.md` documenting the lint:hygiene ritual + stale-docs quarterly cadence.
