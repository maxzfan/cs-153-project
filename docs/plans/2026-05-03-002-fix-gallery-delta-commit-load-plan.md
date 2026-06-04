---
title: Gallery preview reconstructs delta-stored commits
type: fix
status: active
date: 2026-05-03
origin: docs/plans/2026-04-22-001-feat-dual-artifact-commit-model-plan.md
---

# Gallery preview reconstructs delta-stored commits

## Overview

The gallery view silently fails to load any commit whose on-disk artifact is a `.delta` file rather than a `.3dm`/`.rvt`/`.ifc` snapshot. Empty tiles render with no error indicator. The fix mirrors the priority chain that `restoreToCommit` already uses: reconstruct delta commits before falling back to `readCommitFile`. The fix is committed to the working tree on `feat/windows-hardening-phase-0`. Runtime verification in the packaged Electron app is still pending.

## Problem Statement

### Symptom

In gallery mode, multiple tiles render in the grid but only one shows a 3D model. The first commit a user ticks renders correctly; subsequent ticks add empty tiles. Reproduction observed on `feat/windows-hardening-phase-0`.

### Root cause

Two parallel code paths exist for materializing a commit's full file buffer:

1. **`restoreToCommit`** at `src/contexts/VersionControlContext.tsx:931–1008` correctly handles delta-stored commits by calling `desktopAPI.reconstructCommit(currentModel, commitId, treeData)` first, then falling back to `desktopAPI.readCommitFile`.
2. **Gallery preview loader** at `src/components/ModelViewer.tsx:564–581` (pre-fix) only called `desktopAPI.readCommitFile`.

`readCommitFile` is gated by `VALID_ORIGINAL_FORMATS = ['.3dm', '.rvt', '.ifc']` at `electron/services/file-storage-service.ts:21`. Delta commits are written via `saveDeltaFile` at `VersionControlContext.tsx:814` to a `.delta` file. `readCommitFile` returns `null` for those, so the gallery loop skipped them — the tile got `displayModel = null` and rendered as the empty `<GridFloor />` only. The catch block at the bottom of the loop swallowed nothing (no error was thrown), so devtools showed no signal.

### Why "first works, subsequent don't"

Most projects start with one keyframe (initial commit, snapshot) followed by deltas — `commitModelChanges` at `VersionControlContext.tsx:812–823` always tries delta first and falls back to keyframe only if the delta is too large or computation fails. So:

- **Tile 1 (initial commit, snapshot)** → `readCommitFile` finds `.3dm` → loads ✓
- **Tile 2+ (later commits, mostly deltas)** → `readCommitFile` returns `null` → blank tile ✗

### Why this slipped through

The dual-artifact plan (`docs/plans/2026-04-22-001-feat-dual-artifact-commit-model-plan.md`) explicitly scoped a gallery rewrite for Phase 2 — switching gallery slots from `load3dmFile` over to `loadGlbFile` against `.glb` derivatives (lines 274–285 of that plan, and `feat(viewer): load gallery tiles from glTF derivatives` in commit `c23e817` on the dual-artifact branch). The Phase 0 work that landed on this branch added delta storage and updated `restoreToCommit`, but did **not** update the gallery loader because the gallery rewrite was deferred to Phase 2.

Phase 2 is not yet on `feat/windows-hardening-phase-0`. Until it lands, the existing gallery loader is the active code path on this branch and needs delta support.

## Proposed Solution

Mirror `restoreToCommit`'s priority chain in the gallery loader. When a selected commit has `storageType === 'delta'`, reconstruct the full file buffer via `desktopAPI.reconstructCommit` before falling back to `readCommitFile`. Hold the tree-data builder in a ref to keep the gallery effect's dependency array stable (matching the existing `commitsRef` pattern introduced by commit `6b5480c`).

### Files changed

```
src/contexts/VersionControlContext.tsx   +5 lines
src/components/ModelViewer.tsx          +18 -3 lines
```

### Diff summary

`src/contexts/VersionControlContext.tsx`

- Add `buildTreeDataForReconstruction: () => object` to `VersionControlContextType`.
- Expose the existing `useCallback` from the provider value.

`src/components/ModelViewer.tsx`

- Destructure `buildTreeDataForReconstruction` from `useVersionControl()`.
- Add `buildTreeDataRef` (parallels `commitsRef`) so the load effect's deps stay `[isGalleryMode, selectedCommitIds, currentModel, modelName]`.
- In the desktop branch of the load loop:

```ts
let fileBuffer: ArrayBuffer | null = null;
if (commit.storageType === 'delta') {
  const treeData = buildTreeDataRef.current();
  fileBuffer = await desktopAPI.reconstructCommit(currentModel, commit.id, treeData);
  if (cancelled) return abort();
}
if (!fileBuffer) {
  fileBuffer = await desktopAPI.readCommitFile(currentModel, commit.id);
  if (cancelled) return abort();
}
if (fileBuffer) { /* parse + register loaded model, unchanged */ }
```

## Technical Considerations

### Effect deps stability

`buildTreeDataForReconstruction` has dep array `[activeBranchId, currentCommitId, branches, commits]` at `VersionControlContext.tsx:929`. Its identity changes whenever any of those change. If we put it directly in the gallery effect deps, every commit landing or branch operation would re-run the gallery's full disposal-and-reload — exactly the behavior that commit `6b5480c` removed when it switched the dep from `selectedCommits` → `selectedCommitIds`. The `buildTreeDataRef` keeps the call-site fresh while keeping the effect deps minimal.

### Cancellation

The new `reconstructCommit` await is followed by an `if (cancelled) return abort()` check, mirroring the existing pattern. `abort()` disposes any models added to `newOwnedModels` so far and bails. No new dispose paths are introduced.

### Cancellation race on stale ref

If the user starts a gallery load, then commits a new keyframe before the load finishes, `buildTreeDataRef.current` may be one generation behind when the in-flight reconstruction reads it. `reconstructCommit` only needs the parent chain of the target commit (not the head), so a treeData snapshot taken before a new head-commit lands is still complete for any commit that existed at snapshot time. Confirmed via `commit-reconstruction-service.ts` — reconstruction walks from target commit backward through `parentCommitId` until it hits a snapshot.

### Reconstruction failure fallback

If `reconstructCommit` returns `null` (e.g., parent chain corrupt), the code falls through to `readCommitFile`. For a delta commit with a broken chain, `readCommitFile` will also return `null`, and the tile renders empty — the same broken state as today, but no worse. A future improvement is a tile-level error indicator (see Follow-ups below).

### TypeScript and lint

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx tsc --noEmit -p electron/tsconfig.json` — clean.
- `npx tsc --noEmit -p electron/preload-tsconfig.json` — clean.
- `npm run lint` against the touched files surfaces only pre-existing errors (the empty-block in `LoadedObjects` at line 200 and an `any` at `VersionControlContext.tsx:221`).

## System-Wide Impact

### Interaction graph

User clicks a checkbox in `VersionControl.tsx:342` →
`onCheckedChange` → `toggleCommitSelection(commitId)` (`GalleryContext.tsx:41`) → `selectedCommitIds` becomes a new `Set` →
gallery load effect (`ModelViewer.tsx:528`) re-runs →
`loadCommitModels` iterates selected commits →
**[new] for delta commits: `desktopAPI.reconstructCommit` → IPC → `commit-reconstruction-service.ts` → walks parent chain, applies deltas to a snapshot** →
fallback path: `desktopAPI.readCommitFile` → IPC → `file-storage-service.ts:125` →
`load3dmFile` (singleton `Rhino3dmLoader`) →
`setGalleryModelData(newModelData)` → re-render → `<SceneContent>` → `<LoadedObjects>` clones each `Object3D` into the tile's scene.

The same checkbox click also bubbles to the row's `onClick` at `VersionControl.tsx:325` and triggers `restoreToCommit(commit.id)` for the clicked commit. That issues its own concurrent `reconstructCommit` + `load3dmFile` for the main viewer. Two parses against the singleton Rhino loader run in parallel; three.js's `WorkerPool` queues them. Not introduced by this fix; flagged here for context.

### Error propagation

- `reconstructCommit` returning `null`: silently falls to `readCommitFile`. No log, no toast.
- `readCommitFile` returning `null`: tile stays empty. No log.
- `load3dmFile` rejecting: caught at `ModelViewer.tsx:583` with a swallowing `catch {}`.

The whole loop favors graceful degradation over visible error reporting. That is a known UX gap — see Follow-ups.

### State lifecycle risks

The fix preserves the existing disposal contract: only `newOwnedModels` (gallery-loaded buffers) are disposed via `abort()` or `disposeOwned()`. `commit.modelData` references owned by `VersionControlContext` are never disposed by gallery code. No change to who-owns-what.

### API surface parity

Three call sites currently materialize a commit's full file buffer:

| Call site | Path | Handles delta? |
|---|---|---|
| `restoreToCommit` (`VersionControlContext.tsx:931`) | `reconstructCommit → readCommitFile → fileBuffer → IndexedDB → exportModelToBuffer` | Yes |
| `pullFromCommit` (`VersionControlContext.tsx:~1058`) | similar to restore | Yes (via `commit.modelData` fallback at line 1059) |
| Gallery loader (`ModelViewer.tsx:564`) | **pre-fix:** `readCommitFile` only → **post-fix:** `reconstructCommit → readCommitFile` | Yes (after this fix) |

The duplication between these three sites is real and deserves a single shared helper. See Follow-ups.

### Integration test scenarios that unit tests would not catch

1. Project with one snapshot followed by N delta commits → enable gallery → tick all → all N+1 tiles render their distinct models.
2. Project with mixed snapshot/delta commits across two branches → enable gallery → tick across branch boundaries → all tiles render.
3. Cloud-pulled delta commit → readCommitFile finds the `.delta` file (because pull writes it) → gallery reconstructs from local chain → tile renders.
4. Rapid toggle: tick A, tick B 100ms later, untick A 100ms after that → final state is `{B}` rendered, no zombie tiles, no GPU leak.
5. Reconstruction failure (e.g., corrupted parent chain) → tile renders empty, no crash, other tiles unaffected.

## Acceptance Criteria

### Functional

- [ ] In a project with at least one delta-stored commit, enabling gallery mode and ticking that commit renders its model.
- [ ] Ticking 2–4 commits where any are delta-stored renders all of their models.
- [ ] Ticking the initial (snapshot) commit alongside delta commits still works.
- [ ] Toggling a delta commit off and back on still loads it.

### Non-functional

- [ ] No new GPU memory leak — `disposeOwned` runs once per gallery selection change, same as before.
- [ ] No re-render storm on unrelated commit metadata changes (star toggle, branch operations) — verified by reading the effect deps.
- [ ] First-tile load latency unchanged for snapshots. Delta tiles load in roughly `reconstructCommit` time (parent-chain walk + delta application).

### Quality gates

- [ ] TypeScript: all three projects compile clean.
- [ ] Lint: no new errors in touched files.
- [ ] Manual reproduction in dev (`npm run electron:dev`) confirms the symptom is gone.

## Success Metrics

There is no telemetry on gallery-tile load success. Manual verification is the only signal until that gap is closed (see Follow-ups). Bar for "fixed" is: a contributor reproduces the bug on `main`-as-of-this-fix-being-merged, applies this branch, retries the same project, and observes that previously-blank tiles now render.

## Dependencies & Risks

### Dependencies

- Relies on `desktopAPI.reconstructCommit` already being correct. Not modified here.
- Relies on `buildTreeDataForReconstruction` producing the same tree shape `commitReconstructionService` expects. Not modified here.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reconstruction perf — tiles take noticeably longer than snapshots | Medium | Low–Med | Phase 2 of the dual-artifact plan addresses this by moving gallery to `.glb` derivatives. This fix is the bridge until then. |
| Stale `buildTreeDataRef` if a commit lands mid-load | Low | Low | Reconstruction only needs parent chain of target commit, not head. |
| Concurrent `load3dmFile` calls between gallery and `restoreToCommit` exhaust the singleton worker | Low | Low | Pre-existing behavior, not introduced. three.js `WorkerPool` handles queuing. Surface for monitoring. |

## Follow-ups (not in this fix)

These are real gaps but out of scope for this minimum-diff fix. Each is a candidate for a follow-up plan.

1. **Single source of truth for "load commit file buffer."** Extract the priority chain (`reconstructCommit → readCommitFile → fileBuffer → IndexedDB → exportModelToBuffer`) into a single helper exposed from `VersionControlContext`. Both gallery and `restoreToCommit` consume it. Eliminates the entire class of "site A handles deltas, site B doesn't" bugs.

2. **Make silent failures noisy in dev.** Today, `readCommitFile → null` and `load3dmFile → reject` both fail silently. Add a `console.warn` (gated to dev) when the gallery cannot materialize a tile, including commit id, storageType, and which step returned empty. Optionally render a per-tile error indicator (warning glyph + tooltip) instead of a blank scene.

3. **Regression test.** No automated tests exist for any of `src/components/ModelViewer.tsx`. The minimum useful test is one that mocks `desktopAPI.reconstructCommit` + `readCommitFile` and verifies the gallery loader calls them in the correct order for delta vs snapshot commits. Could live as a Vitest unit test isolated from r3f.

4. **Coordinate with Phase 2 of dual-artifact.** When the `.glb` derivative path lands (commit `c23e817` and follow-ups), the gallery should prefer derivatives and only fall back to original-file reconstruction when a derivative is missing. The current fix is intentionally narrow — it keeps the existing original-file path correct without colliding with the derivative work that's queued for a sibling branch.

5. **Telemetry.** Emit a structured event for `gallery_tile_load_failed` with reason (delta_chain_corrupt | file_missing | parse_error). Without it, this class of bug only surfaces when a user happens to notice and report.

## Sources & References

### Origin

- **Origin plan:** [docs/plans/2026-04-22-001-feat-dual-artifact-commit-model-plan.md](../../docs/plans/2026-04-22-001-feat-dual-artifact-commit-model-plan.md) — Phase 0 added delta storage to `commitChanges` and `restoreToCommit` but deferred the gallery rewrite to Phase 2 (`.glb` derivatives). This fix closes the gap that opened in the gallery loader when delta storage shipped without the matching gallery update.
- **Origin brainstorm:** [docs/brainstorms/2026-04-22-dual-artifact-commit-model-requirements.md](../../docs/brainstorms/2026-04-22-dual-artifact-commit-model-requirements.md) — line 34: "Gallery mode comparison works identically across formats (all comparing glTF)" — Phase 2 goal.

### Internal references

- Gallery load effect: `src/components/ModelViewer.tsx:528–608`
- `restoreToCommit` priority chain: `src/contexts/VersionControlContext.tsx:931–1008`
- `commitModelChanges` delta-vs-snapshot decision: `src/contexts/VersionControlContext.tsx:812–823`
- `readCommitFile` extension allowlist: `electron/services/file-storage-service.ts:21,125–137`
- `saveDeltaFile`: `electron/services/file-storage-service.ts:210`
- Phase-0 review fix that introduced the `commitsRef` pattern this plan extends: commit `6b5480c`
- Sibling-branch glb gallery work: commit `c23e817` (`feat(viewer): load gallery tiles from glTF derivatives`)

### Related

- Bug-fix changes in this plan: working-tree diff against `feat/windows-hardening-phase-0` HEAD (not yet committed).
- Investigation transcript: produced by `/investigate` on 2026-05-03.
