---
date: 2026-04-05
topic: file-watcher-reliability
---

# File Watcher Reliability Fix

## Problem Frame

The current `FileWatcherService` (`electron/services/file-watcher.ts`) uses native Node.js `fs.watch`, which has two reliability issues on macOS:

1. **Missed reloads**: `fs.watch` can emit directory events with `filename: null` on macOS. The current filter (`changedFile !== filename`) silently drops these, so legitimate `.3dm` saves from Rhino may never trigger a model reload.
2. **Spurious reloads (risk)**: Every commit save writes files into `0studio_${fileName}/` (same parent directory as the `.3dm` file). While the filename filter currently prevents most false triggers, the behavior is fragile and untested under macOS edge cases.

Note: The ideation doc described this as a chokidar fix, but `file-watcher.ts` was already migrated to native `fs.watch`. Chokidar remains a listed dependency but is unused.

## Requirements

- R1. The file watcher must detect all legitimate `.3dm` file saves from Rhino, including cases where macOS `fs.watch` returns a null filename for the change event.
- R2. Commit saves to the `0studio_*` folder must never trigger a spurious model reload.
- R3. Partial-write saves (Rhino writes the file incrementally) must not trigger a reload mid-write; the watcher must wait for the file to stabilize before emitting a change event.
- R4. The fix must handle file deletion events correctly (model should receive an `unlink` event when the `.3dm` file is removed).

## Success Criteria

- Saving a version in 0studio does not cause the 3D model to reload.
- Saving the `.3dm` file in Rhino reliably triggers a model reload within 600ms of the file stabilizing.
- No regression in file-delete detection.

## Scope Boundaries

- Only `electron/services/file-watcher.ts` is in scope.
- No changes to the IPC event contract (`file-changed` event shape stays the same).
- No changes to how the renderer handles `file-changed` events.
- Cross-platform correctness (Windows/Linux) is a bonus but not a blocking requirement.

## Key Decisions

- **Use chokidar** (already a project dependency): handles macOS null-filename, provides native `ignored` patterns and `awaitWriteFinish`. Replace the native `fs.watch` implementation with chokidar.
- **Ignore pattern**: `/0studio_/` matches the `0studio_${fileName}` storage folder naming convention.
- **awaitWriteFinish stabilityThreshold: 500ms**: matches the existing debounce duration; acceptable given Rhino saves are not instantaneous.

## Dependencies / Assumptions

- `chokidar ^4.0.0` is already in `package.json` and available.
- The existing mtime-deduplication logic in `FileWatcherService` can be removed once chokidar's `awaitWriteFinish` takes over write-completion responsibility.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Verify that chokidar 4.x API is compatible with Electron 32's Node.js version and that `ignored` + `awaitWriteFinish` work as expected in the packaged app (not just dev mode).
- [Affects R2][Technical] Confirm the `0studio_` folder naming is stable (i.e., always prefixed with `0studio_` and never `.0studio_`) by reading `file-storage-service.ts:getStorageFolderPath`.

## Next Steps

→ `/ce:plan` for structured implementation planning
