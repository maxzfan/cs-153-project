---
date: 2026-04-08
topic: dmg-performance
---

# DMG Performance

## Problem Frame

The packaged DMG is noticeably slower than the dev build — startup and 3D model loading are the two primary pain points. Three rounds of fixes have shipped (code splitting, WASM deferral, GPU flag attempt + revert), but the app remains 10x slower than dev on Apple Silicon.

The dominant remaining cause: Chromium's GPU blocklist silently forces **SwiftShader (software WebGL)** in the packaged app, degrading Three.js rendering from GPU-accelerated to CPU-rendered. The previous attempt to override the blocklist (`ignore-gpu-blocklist` + `enable-zero-copy`) caused a 15-second startup hang and was reverted. `enable-zero-copy` is the likely hang trigger on Apple Silicon; the correct approach is `ignore-gpu-blacklist` + `disable-software-rasterizer` without `enable-zero-copy`.

Secondary contributors still unaddressed:
- **V8 bytecode not cached**: Every launch re-parses 300KB app + 843KB Three.js chunk from scratch.
- **rhino3dm WASM recompiled on every file open**: No persistent cache for the 2.5MB compiled WebAssembly module.
- **Worker pool warm-up blocks window creation**: `workerPool.warmUp()` runs before `createWindow()`.
- **No GPU diagnostic in packaged builds**: No way to verify GPU status without a debug build.

## Completed Work (R1–R4)

The following requirements from the original doc were shipped in PR #16:

- ~~R1. Code splitting~~ ✓ — Three.js (843KB), Radix UI (310KB), Supabase (167KB), app (300KB); routes lazy-loaded.
- ~~R2. Deferred WASM init~~ ✓ — rhino3dm WASM no longer initializes on app startup.
- ~~R3. Hardware acceleration~~ ✗ — GPU flags added then reverted due to startup hang.
- ~~R4. Bundle analysis~~ ✓ — rollup-plugin-visualizer added.

## Requirements

- R5. **GPU flags (safe)** — Apply `ignore-gpu-blacklist` and `disable-software-rasterizer` before `app.ready()`, without `enable-zero-copy`. Add a 10-second `ready-to-show` timeout fallback so the window shows even if GPU initialization hangs, preventing a frozen launch.
- R6. **GPU diagnostic shortcut** — A hidden keyboard shortcut (Cmd+Shift+G) opens `chrome://gpu` in a new BrowserWindow in the packaged app, so GPU status is diagnosable without rebuilding in dev mode.
- R7. **V8 bytecode cache** — Call `session.setCodeCachePath()` with a path inside the user data directory so Electron caches parsed JS bytecode to disk. Eliminates re-parse cost on every launch for all JS chunks.
- R8. **WASM compilation cache** — After compiling rhino3dm on first `.3dm` open, serialize the compiled `WebAssembly.Module` to IndexedDB. Subsequent opens deserialize from cache instead of recompiling.
- R9. **Worker pool non-blocking** — Move `workerPool.warmUp()` to run concurrently with `createWindow()` (fire-and-forget) rather than sequentially before it.

## Success Criteria

- App window appears in under 2 seconds from launch (currently hangs for several seconds before showing).
- Opening a `.3dm` file after warm-up feels as fast as dev mode.
- The GPU diagnostic shortcut confirms `WebGL: Hardware accelerated` in the packaged build.
- No regression: 3D viewer loads correctly, commit/branch operations unaffected.
- If GPU flags cause a hang, the 10s timeout ensures the window still appears.

## Scope Boundaries

- No changes to backend, cloud sync, or auth flows.
- Do not change delta worker or commit storage logic.
- Not targeting Windows build performance.
- Does not include Three.js render performance tuning (LOD, instancing, etc.).
- Do not re-add `enable-zero-copy` — it caused the previous startup hang on Apple Silicon.

## Key Decisions

- **`enable-zero-copy` excluded**: It was the likely cause of the 15s hang when combined with `ignore-gpu-blocklist`. Hardware WebGL is achievable without it.
- **Timeout fallback on `ready-to-show`**: A defensive guard so that if GPU flags cause a future hang, the window appears anyway after 10 seconds rather than freezing indefinitely.
- **WASM cache in IndexedDB (renderer side)**: The compiled `WebAssembly.Module` is serializable. Storing it in IndexedDB avoids V8 recompilation on every file open — the renderer already has access without new IPC.
- **Bytecode cache in userData**: `session.setCodeCachePath()` expects a writable directory; `app.getPath('userData')` is the canonical choice.

## Dependencies / Assumptions

- `ignore-gpu-blacklist` (Chromium flag) is the correct spelling for Apple Silicon; `ignore-gpu-blocklist` is an alias — use whichever Electron accepts.
- `WebAssembly.Module` serialization via `WebAssembly.compile()` + structured clone is supported in Electron's Chromium version.
- The rhino3dm WASM path (`./rhino3dm/`) remains in `asarUnpack` and resolves correctly.

## Outstanding Questions

### Resolve Before Planning
_(none)_

### Deferred to Planning

- [Affects R5][Technical] Confirm whether `ignore-gpu-blacklist` or `ignore-gpu-blocklist` is the correct switch name for the Electron version in use.
- [Affects R5][Technical] Verify that `app.commandLine.appendSwitch()` calls placed at module top-level (before `app.whenReady()`) take effect correctly in the packaged build.
- [Affects R7][Technical] Does `session.setCodeCachePath()` need to be called before or after `app.whenReady()`? Check Electron docs for the correct timing.
- [Affects R8][Needs research] What is the maximum IndexedDB entry size on macOS? The compiled WASM module may exceed 50MB — verify it fits or use a file-based fallback.

## Next Steps

→ `/ce:plan` for structured implementation planning
