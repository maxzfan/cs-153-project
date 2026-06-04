---
title: "fix: Migrate FileWatcherService from fs.watch to chokidar"
type: fix
status: active
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-file-watcher-reliability-requirements.md
---

# fix: Migrate FileWatcherService from fs.watch to chokidar

## Overview

Replace the native `fs.watch` implementation in `electron/services/file-watcher.ts` with chokidar 4.x (already a runtime dependency). This fixes two reliability issues on macOS: missed reloads (when `fs.watch` returns `null` for the filename) and fragile spurious-reload prevention.

## Problem Statement

`FileWatcherService` uses Node.js `fs.watch` which has two known macOS issues:

1. **Missed reloads**: `fs.watch` can emit directory events with `filename: null` on macOS. The current guard (`changedFile !== filename`) silently drops these — legitimate Rhino `.3dm` saves may never trigger a model reload.
2. **Fragile spurious reload prevention**: The `basename` filter blocks `0studio_*` folder events in most cases, but the behavior is untested under macOS edge cases (null-filename events, kqueue coalescing).

See origin document: `docs/brainstorms/2026-04-05-file-watcher-reliability-requirements.md`

## Key Decisions (from brainstorm)

- **Use chokidar** (already at `^4.0.0` in runtime deps): handles macOS null-filename, provides `awaitWriteFinish`, and watches files reliably cross-platform.
- **Watch the file directly** (`chokidar.watch(filePath)`): naturally prevents `0studio_*` folder events without an `ignored` pattern.
- **`awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }`**: waits for the file to stop changing before firing — handles Rhino's incremental writes.
- **`ignoreInitial: true`**: suppresses the initial `add` event on watcher startup (matches current mtime-guard behavior).

## Files

- `electron/services/file-watcher.ts` — **full rewrite of implementation** (public API surface unchanged)
- `electron/tsconfig.json` — update `moduleResolution` from `"node"` to `"node16"` so TypeScript resolves chokidar 4's ESM `exports` field correctly

## Implementation

### `electron/services/file-watcher.ts`

Replace the current `fs.watch`-based implementation with chokidar. Keep the public API identical:

```ts
import chokidar, { FSWatcher } from 'chokidar';

export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private isWatching = false;
  private watchedPath: string | null = null;

  watch(filePath: string, callback: (eventType: string, filename?: string) => void): void {
    if (this.isWatching) {
      this.stop();
    }

    this.watchedPath = filePath;

    this.watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    // Rhino saves via both direct write (change) and atomic rename (add)
    const onFileChange = () => callback('change', filePath);
    this.watcher.on('add', onFileChange);
    this.watcher.on('change', onFileChange);
    this.watcher.on('unlink', () => callback('unlink', filePath));
    this.watcher.on('error', (error) =>
      callback('error', error instanceof Error ? error.message : String(error))
    );

    this.isWatching = true;
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      this.watchedPath = null;
    }
  }

  get watching(): boolean {
    return this.isWatching;
  }

  getWatchedPaths(): string[] {
    return this.watchedPath ? [this.watchedPath] : [];
  }
}
```

**What changed vs current implementation:**
- `import { watch, FSWatcher, existsSync, statSync } from 'fs'` → `import chokidar, { FSWatcher } from 'chokidar'`
- Removed: `debounceTimer`, `lastModified`, all debounce/mtime logic
- Added: chokidar watcher with `awaitWriteFinish`, `ignoreInitial`
- Handles both `add` + `change` (Rhino atomic-rename saves emit `add`, not `change`)
- Callback arg mapping preserved: second arg is `filePath` for change/unlink, error message for error

### `electron/tsconfig.json`

Change `"moduleResolution": "node"` to `"moduleResolution": "node16"`.

Chokidar 4.x uses the `exports` field in its `package.json` to gate its ESM entry point. The `"node"` resolution algorithm predates this and resolves via `main` only, which can cause TypeScript type-check failures. `"node16"` understands `exports` and resolves correctly.

## Acceptance Criteria

- [ ] R1: Saving `.3dm` in Rhino triggers a model reload within 600ms of the file stabilizing
- [ ] R2: Saving a commit in 0studio does not trigger a model reload
- [ ] R3: Rapid incremental writes result in a single reload after stabilization (not multiple)
- [ ] R4: Deleting the `.3dm` file triggers an `unlink` event in the renderer
- [ ] TypeScript compilation succeeds (`npm run build:electron` passes without errors)
- [ ] IPC event contract unchanged: `{ eventType, filename?, filePath }` shape from `main.ts` is unaffected

## Technical Considerations

- **ESM compatibility**: `electron/tsconfig.json` uses `"module": "ES2020"` so the compiled output is ESM. Chokidar 4.x is pure ESM. This is compatible — no dynamic import workaround needed. The `moduleResolution` fix is for TypeScript type resolution only.
- **Preload unaffected**: `electron/preload-tsconfig.json` compiles to CJS separately and does not import chokidar.
- **`stop()` called on `watcher.close()`**: Chokidar's `close()` returns a Promise but does not need to be awaited here — the watcher stops accepting new events immediately and the class state is cleaned up synchronously.
- **`0studio_` folder naming**: Confirmed as `0studio_${filename-without-extension}` (no leading dot). Watching the file directly makes the `ignored` pattern unnecessary.

## Sources

- **Origin document:** [docs/brainstorms/2026-04-05-file-watcher-reliability-requirements.md](../brainstorms/2026-04-05-file-watcher-reliability-requirements.md) — Key decisions carried forward: watch file directly, chokidar with awaitWriteFinish, ignoreInitial, handle add+change
- Current implementation: `electron/services/file-watcher.ts`
- IPC bridge: `electron/main.ts:337-348`
- Storage folder naming: `electron/services/file-storage-service.ts:24-29`
