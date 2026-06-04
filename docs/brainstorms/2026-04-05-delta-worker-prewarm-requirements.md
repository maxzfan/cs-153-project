---
date: 2026-04-05
topic: delta-worker-prewarm
---

# Delta Worker Pre-Warm on App Launch

## Problem Frame

The first "Save Version" click pays a silent cold-start penalty of 100–400ms while the delta worker thread spawns and JIT-compiles fossil-delta. `DeltaWorkerPool.ensureWorker()` is lazy — it only runs on the first `computeDelta` or `applyDelta` call. Pre-warming during idle time after launch eliminates this penalty entirely.

## Requirements

- R1. The delta worker thread is spawned during `app.whenReady()` idle time, before any user action triggers a commit.
- R2. `DeltaWorkerPool` exposes a public `warmUp()` method that triggers `ensureWorker()` without requiring a pending job.
- R3. Pre-warming does not block window creation or delay app startup.

## Success Criteria

- First "Save Version" after a cold launch has no observable worker cold-start pause.
- App launch time is unchanged (warm-up is fire-and-forget, not awaited).

## Scope Boundaries

- No changes to the worker's internal logic, message protocol, or job handling.
- No changes to `computeDelta`, `applyDelta`, or `shutdown`.

## Key Decisions

- **`warmUp()` calls `ensureWorker()` and discards the return value** — no sentinel message to the worker needed; spawning the thread is sufficient to trigger JIT compilation.
- **Fire-and-forget in `app.whenReady()`** — called without `await` alongside `createWindow()` so it never delays window creation.

## Next Steps

→ `/ce:work` — scope is clear, 3-line change, ready to implement directly.
