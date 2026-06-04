---
title: "feat: Bundle rhino3dm WASM locally and initialize eagerly"
type: feat
status: active
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-rhino3dm-local-wasm-requirements.md
---

# feat: Bundle rhino3dm WASM Locally + Eager Init

## Overview

Every cold file open in 0studio blocks on a CDN network request to `cdn.jsdelivr.net` to fetch the rhino3dm WASM binary and JS loader (~10 MB). `rhino3dm@8.17.0` is already installed as an npm dependency — the files are sitting in `node_modules/rhino3dm/` unused. This change copies them into the distributable and wires eager initialization so WASM compiles during the startup idle window, before the user opens a file.

The version in the CDN URL is also wrong: it hardcodes `@8.4.0` while the installed package is `8.17.0`. Switching to local files fixes this automatically.

## Problem Statement / Motivation

- **CDN dependency in a desktop app**: The app is marketed as offline-capable, but a core function (opening any `.3dm` file) silently requires the internet. Slow networks cause multi-second stalls; captive portals cause hard failures.
- **Version mismatch**: Both CDN paths in `rhino3dm-service.ts` hardcode `@8.4.0`; the installed package is `8.17.0`. The app runs against an untested version.
- **No eager init**: WASM JIT compilation happens on the first user interaction with a file. The startup idle window (while auth resolves and contexts mount) is wasted.

## Proposed Solution

1. **Copy** `rhino3dm.min.js` and `rhino3dm.wasm` from `node_modules/rhino3dm/` to `public/rhino3dm/` via a build-time npm script.
2. **Update** both CDN references in `src/lib/rhino3dm-service.ts` to use the local relative path `./rhino3dm/`.
3. **Add `asarUnpack`** to electron-builder config so the WASM file is extracted outside the `.asar` archive (required for `file://` protocol WASM loading in Electron).
4. **Add eager init** via `useEffect(() => { getLoader(); }, [])` in `src/App.tsx`.

## Technical Considerations

### Architecture impacts

- `rhino3dm` must remain `external` in Vite (no change to `vite.config.ts` needed). The files are served as static assets, not imported as ES modules — same as the CDN approach, just a different URL.
- `vite.config.ts` line 30: `base: './'` in production means `./rhino3dm/` resolves correctly from inside the `app.asar` archive. Vite dev server serves `public/` at the root (`/`), so dev mode resolves correctly too.
- Files in `public/` are copied verbatim to `dist/` by Vite. `dist/**/*` is included in the electron-builder `files` array (`package.json` line 111), so `dist/rhino3dm/` lands in the packaged app automatically.

### WASM + `app.asar` compatibility

Files packed inside `app.asar` can fail to load WASM via `file://` in some Electron configurations because the OS-level path doesn't exist (it's inside the archive). The fix is `asarUnpack`, which tells electron-builder to extract matching files into `app.asar.unpacked/`. Electron transparently redirects `file://` requests to the unpacked location, so the relative URL `./rhino3dm/` still works in the renderer without any code change.

Add to `package.json` build config:
```json
"asarUnpack": ["dist/rhino3dm/**"]
```

### Build-time file copy

`node_modules/` is excluded from the package. Files must be copied to `public/rhino3dm/` **before** `vite build` runs, so they land in `dist/` as part of the Vite output.

Add an npm script that copies from `node_modules/rhino3dm/`:
```json
"copy:rhino3dm": "mkdir -p public/rhino3dm && cp node_modules/rhino3dm/rhino3dm.min.js public/rhino3dm/ && cp node_modules/rhino3dm/rhino3dm.wasm public/rhino3dm/"
```

Wire it into the existing build pipeline so it runs before `vite build`:
```json
"build:electron": "npm run copy:rhino3dm && tsc -p electron/tsconfig.json && ..."
```

Or prepend to `electron:dist` if the current `build:electron` shouldn't be modified.

### Two CDN paths to update in `rhino3dm-service.ts`

**Path 1 — `getLoader()` (line 14):** Used by `Rhino3dmLoader` for parsing `.3dm` files for display.
```ts
// Before
loaderInstance.setLibraryPath("https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/");
// After
loaderInstance.setLibraryPath("./rhino3dm/");
```

**Path 2 — `getRhino3dm()` (line 99):** Used for export operations (`exportModelToBuffer`, `exportTo3dm`). Currently injects a `<script>` tag pointing to CDN.
```ts
// Before
const rhino3dmUrl = "https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/rhino3dm.min.js";
// After
const rhino3dmUrl = "./rhino3dm/rhino3dm.min.js";
```

### Eager initialization

`getLoader()` in `rhino3dm-service.ts` is a lazy singleton. Calling it once fires the WASM fetch + JIT compile in the background.

Add to `src/App.tsx` (convert arrow function to named function component to hold the effect):
```tsx
import { getLoader } from "@/lib/rhino3dm-service";

const App = () => {
  useEffect(() => {
    getLoader(); // Kick off WASM init during startup idle time
  }, []);

  return (/* existing JSX */);
};
```

This fires after first render — before any user interaction — and does not block any context from mounting.

### Performance implications

- **Cold launch**: WASM compile (~100–500ms, CPU-bound) runs during auth resolution. By the time the user picks a file, it's done.
- **File open latency**: Drops from `CDN fetch (300ms–8s) + WASM compile` to `~0ms` (already compiled).
- **Bundle size**: No change — `rhino3dm` stays `external`, the renderer bundle is unchanged.
- **Distributable size**: +~5.2 MB (2.6 MB JS + 2.6 MB WASM). Acceptable for a desktop app.

## System-Wide Impact

- **Offline support**: The app now functions fully offline for all file operations. No regression risk — local files supersede the CDN.
- **Version alignment**: Both `getLoader()` and `getRhino3dm()` now use the same version (8.17.0). Any behavior differences from the 8.4.0→8.17.0 upgrade should be tested (see Acceptance Criteria).
- **Dev mode**: No behavior change — `public/` is served by the Vite dev server at `localhost:5173`, relative paths work identically.
- **`getRhino3dm()` check**: Line 102 checks `if ((window as any).rhino3dm)` before injecting the script. This short-circuits if the module is already loaded globally. No change needed.
- **`disposeLoader()`** (line 294): Sets `loaderInstance = null`. After eager init, if `dispose` is called it re-lazifies the loader. This is fine — the next file open re-initializes it (from local disk, fast).

## Acceptance Criteria

- [ ] Running `npm run electron:dist` produces a DMG where opening a `.3dm` file succeeds with no internet connection
- [ ] `dist/rhino3dm/rhino3dm.min.js` and `dist/rhino3dm/rhino3dm.wasm` exist in the build output
- [ ] `app.asar.unpacked/dist/rhino3dm/` exists in the packaged app (confirming `asarUnpack` took effect)
- [ ] No CDN requests to `cdn.jsdelivr.net` appear in the Electron DevTools Network tab when opening a file
- [ ] The `getLoader()` eager init call fires at app launch (verifiable via DevTools — rhino3dm WASM compiles during startup, not on first file open)
- [ ] `exportModelToBuffer` and `exportTo3dm` functions continue to work correctly (rhino3dm version 8.17.0 compatibility)
- [ ] Dev mode (`npm run electron:dev`) continues to work — no regressions in file open or export
- [ ] The copy script runs cleanly: `npm run copy:rhino3dm` succeeds and produces both files in `public/rhino3dm/`

## Success Metrics

- First file open after cold launch takes ≤ 1 second (vs 3–10 seconds on CDN path)
- App opens `.3dm` files with airplane mode enabled
- No `net::ERR_*` or CDN errors in DevTools console

## Dependencies & Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| rhino3dm 8.17.0 behavior differs from 8.4.0 | Medium | Test export and open with real `.3dm` files in QA |
| WASM fails to load from `app.asar` without `asarUnpack` | High | `asarUnpack` is the standard Electron fix; well-documented |
| `copy:rhino3dm` not wired into CI/build | Medium | Wire into `build:electron` so it can't be skipped |
| `public/rhino3dm/` checked into git accidentally | Low | Add `public/rhino3dm/` to `.gitignore` — these are build artifacts |

## Implementation Checklist

- [ ] Add `public/rhino3dm/` to `.gitignore`
- [ ] Add `"copy:rhino3dm"` npm script to `package.json`
- [ ] Prepend `copy:rhino3dm` to the `build:electron` (or `electron:dist`) script
- [ ] Add `"asarUnpack": ["dist/rhino3dm/**"]` to `package.json` `"build"` section
- [ ] Update `src/lib/rhino3dm-service.ts` line 14: `setLibraryPath("./rhino3dm/")`
- [ ] Update `src/lib/rhino3dm-service.ts` line 99: local URL for `rhino3dm.min.js`
- [ ] Add `useEffect(() => { getLoader(); }, [])` to `src/App.tsx`
- [ ] Import `getLoader` in `App.tsx`
- [ ] Manually run `npm run copy:rhino3dm` once to populate `public/rhino3dm/` for dev
- [ ] Test dev mode: `npm run electron:dev` — verify file open works
- [ ] Test prod build: `npm run electron:dist` — verify offline file open + export

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-05-rhino3dm-local-wasm-requirements.md](../brainstorms/2026-04-05-rhino3dm-local-wasm-requirements.md)
  - Key decisions carried forward: no CDN fallback, eager init on app launch, use npm-installed version
- `src/lib/rhino3dm-service.ts` — both CDN paths at lines 14 and 99
- `package.json` lines 109–160 — electron-builder `"build"` config, `"files"` array
- `vite.config.ts` lines 18–27 — rhino3dm excluded from bundle; `base: './'` at line 30
- `src/App.tsx` — context provider tree, eager init target
- `node_modules/rhino3dm/` — source files: `rhino3dm.min.js` (2.6 MB), `rhino3dm.wasm` (2.6 MB), version 8.17.0
