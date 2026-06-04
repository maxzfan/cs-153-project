---
date: 2026-04-05
topic: app-performance
focus: make the deployed app run faster (editing/opening files, app upon launch, etc)
---

# Ideation: 0studio App Performance

## Codebase Context

0studio is an Electron desktop app (TypeScript main, React 18 + Three.js renderer, Express backend at localhost:3000). Heavy WASM dependency: `rhino3dm` (~10MB) fetched from `cdn.jsdelivr.net` at runtime for `.3dm` file parsing. Seven deeply nested React Contexts (Auth, RecentProjects, Presence, VersionControl, CloudSync, Gallery, Model) all initialize unconditionally on app start. IPC bridge routes all file/git ops through the main process. Delta compression via `fossil-delta` + a single worker thread that spawns lazily on first commit. Commit storage: `.0studio/tree.json` (pretty-printed JSON, fully rewritten on every commit) + per-commit `.3dm` snapshots. `chokidar` watches the parent directory of the `.3dm` file, including the `.0studio_` subfolder where commit files live — causing self-triggering reload loops.

Key confirmed bottlenecks:
- rhino3dm WASM fetched from CDN on every cold session (`rhino3dm-service.ts` line 14)
- Delta worker spawns lazily in `delta-worker-pool.ts` `ensureWorker()`
- `AuthContext` blocks all rendering on `supabase.auth.getSession()` + payment plan fetch
- `PresenceContext` + `CloudSyncContext` mount unconditionally and open network connections before a project is open
- `validateCommitFiles` issues N×`existsSync` calls (one per commit) on every project open (`file-storage-service.ts`)
- `tree.json` serialized with `JSON.stringify(treeData, null, 2)` on every commit
- No LRU cache in `CommitReconstructionService` — delta chains re-walked on every commit switch
- `chokidar` watches parent directory, `.0studio_` commit writes trigger spurious file-changed events

## Ranked Ideas

### 1. Bundle rhino3dm WASM Locally + Eager Initialization
**Description:** Ship the rhino3dm JS module and its ~10MB `.wasm` binary inside the Electron distributable (e.g., under `public/vendors/rhino3dm/`) rather than fetching from `cdn.jsdelivr.net`. Then call `getLoader()` eagerly on app start (or project open) so WASM is compiled during idle time before the user touches a file.
**Rationale:** Every cold file open currently blocks on a CDN network request + WASM JIT compilation. In an offline Electron app this is a reliability failure as well as a latency issue. Bundling eliminates network variance entirely; eager init hides the compile cost.
**Downsides:** Adds ~10MB to distributable size. Need to update on rhino3dm version upgrades.
**Confidence:** 92%
**Complexity:** Low–Medium
**Status:** Explored (brainstorm: 2026-04-05)

### 2. Fix chokidar: Exclude `.0studio_` Folder + Use `awaitWriteFinish`
**Description:** The file watcher currently watches the parent directory of the `.3dm` file. The `.0studio_` folder (where commit files and `tree.json` live) is in the same directory, so every commit save triggers a `file-changed` event that causes the renderer to reload the model. Add `ignored: /(^|[\/\\])\.0studio_/` to the chokidar config and enable `awaitWriteFinish: { stabilityThreshold: 500 }` so partial writes from Rhino don't trigger premature reloads.
**Rationale:** Eliminates a self-triggering feedback loop on every commit save. Also prevents mid-write reloads that cause mysterious parse failures. Directly improves editing responsiveness.
**Downsides:** `awaitWriteFinish` adds up to 500ms latency before detecting a legitimate external change (acceptable; Rhino saves aren't instant anyway).
**Confidence:** 90%
**Complexity:** Low (2–3 line change)
**Status:** Unexplored

### 3. Defer CloudSync + Presence Context Init Until After Project Open
**Description:** Currently all 7 React contexts mount unconditionally on app start. `PresenceContext` opens a Supabase Realtime WebSocket and `CloudSyncContext` polls cloud state — both before any project is open. Move these two providers inside a `<ProjectOpen>` boundary in `App.tsx` that renders only after `currentProjectFile` is set.
**Rationale:** Eliminates 2 network operations from the startup critical path. App shell appears faster; presence and sync are only needed once a file is open.
**Downsides:** Requires restructuring the context tree in `App.tsx`. Presence subscription latency increases slightly.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. Non-Blocking Auth + Payment Plan Fetch
**Description:** `AuthProvider` currently sets `loading: true` and blocks all child rendering until `supabase.auth.getSession()` resolves, then fires an additional fetch to `/api/stripe/payment-status`. Render the app shell immediately treating `loading: true` as a permissive state, and update auth state in the background.
**Rationale:** On cold launch with a slow backend, this fetch can take 300–800ms. Making it non-blocking decouples perceived startup time from network latency.
**Downsides:** Requires careful audit of which features gate on `hasVerifiedPlan` — they need graceful "still loading" states.
**Confidence:** 82%
**Complexity:** Medium
**Status:** Unexplored

### 5. LRU Cache for Reconstructed Commit Buffers (Main Process)
**Description:** Add a small LRU map (3–5 entries, keyed by `commitId`) to `CommitReconstructionService`. Before walking the delta chain, check the cache. Invalidate on new commits to the same branch. Gallery mode hits the cache on every revisit instead of re-reading from disk + re-applying deltas.
**Rationale:** The dominant case in gallery mode and branch comparison is revisiting commits the user just saw. An LRU cache makes repeated access O(1).
**Downsides:** Memory cost: 3–5 cached buffers × file size. For a 50MB `.3dm` file this is 150–250MB of resident memory. Needs size-based eviction or a configurable limit.
**Confidence:** 88%
**Complexity:** Low–Medium
**Status:** Unexplored

### 6. Pre-Warm Delta Worker on App Launch
**Description:** Call `deltaWorkerPool.ensureWorker()` immediately inside `app.whenReady()` in `electron/main.ts`, before the first user action. The worker thread and fossil-delta module are JIT-compiled during idle time after launch.
**Rationale:** The first "Save Version" click currently pays a silent worker cold-start penalty of 100–400ms. Pre-warming is a 1–2 line change with zero user-visible downside.
**Downsides:** Spawns a worker thread even for users who only browse history. Negligible memory cost (~20MB).
**Confidence:** 95%
**Complexity:** Very Low (1–2 lines)
**Status:** Unexplored

### 7. Quick Wins Bundle: React Context Memoization + validateCommitFiles Optimization
**Description:** Two low-effort changes:
- (a) Wrap `VersionControlContext` and `ModelContext` Provider value objects in `useMemo` with precise dependency arrays to stop cascading re-renders on every state change.
- (b) Replace the `validateCommitFiles` loop of N×`existsSync` calls with a single `readdirSync` to build a `Set<string>`, then check all commit IDs against it — reducing project-open blocking from O(n×syscall) to O(1 syscall + n lookups).
**Rationale:** Both are low-risk, narrowly scoped changes that improve editing responsiveness and project-open time at scale. ~1 day of work for measurable gains.
**Downsides:** Context memoization requires careful dependency array maintenance.
**Confidence:** 88%
**Complexity:** Low
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Three.js geometry cache (IndexedDB) | Overlaps with LRU buffer cache; serializing Three.js BufferGeometry is non-trivial |
| 2 | Atomize saveCommitFile + saveTreeFile IPC | Medium value, medium complexity; smaller than other ideas |
| 3 | Vite manual chunk splitting | Lower priority vs WASM + context waterfall issues; harder to measure in Electron |
| 4 | Move rhino3dm parsing to main process | High architectural cost; bundling WASM locally achieves same benefit at 1/5 the effort |
| 5 | Delta worker pool expansion (multi-worker) | LRU cache reduces worker call frequency; pool expansion complex for marginal gain |
| 6 | Append-only commit log / binary pack file | High architectural cost; simpler quick-wins get 80% of the benefit |
| 7 | Move Express HTTP routes to main process IPC | Very high risk; HTTP overhead not the dominant bottleneck |
| 8 | V8 snapshot / preload caching | High tooling setup; not grounded in a confirmed bottleneck |
| 9 | Speculative .3dm buffer prefetch on open-file | Marginal — WASM parse cost dwarfs disk read time |
| 10 | Remove dynamic `fs/promises` import in hot path | Micro-optimization, negligible real impact |
| 11 | Presence broadcast debounce | Narrow, not a primary performance issue |
| 12 | Transferable ArrayBuffer for IPC | Requires COOP headers; LRU cache eliminates the transfer on revisits anyway |
| 13 | tree.json append-only log | Overlaps with quick-wins; full append+compact is too complex relative to value |

## Session Log
- 2026-04-05: Initial ideation — ~45 raw candidates generated across 6 frames, 7 survivors. Idea #1 sent to brainstorm.
- 2026-04-05: Idea #6 (delta worker pre-warm) sent to brainstorm → requirements doc written.
