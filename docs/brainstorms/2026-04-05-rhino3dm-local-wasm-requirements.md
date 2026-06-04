---
date: 2026-04-05
topic: rhino3dm-local-wasm
---

# Bundle rhino3dm WASM Locally + Eager Init

## Problem Frame

Every cold file open in 0studio blocks on a CDN network request to fetch the rhino3dm WASM binary (~10MB) and its JS loader from `cdn.jsdelivr.net`. This is the dominant latency on first file open. The app is an offline-capable Electron distributable — there is no reason to depend on a CDN.

The issue has two compounding parts:

1. **CDN dependency**: `rhino3dm@8.17.0` is already installed as an npm dependency and ships inside the distributable's `node_modules/`. The actual `.wasm` and `.min.js` files are present locally but unused — both code paths (`Rhino3dmLoader` for display, direct module for export) hardcode `cdn.jsdelivr.net/npm/rhino3dm@8.4.0/` instead.
2. **Version mismatch**: The CDN URL hardcodes `8.4.0`; the installed package is `8.17.0`. This is a latent bug — behavior depends on a version the codebase does not test against.
3. **No eager initialization**: WASM JIT compilation happens on the first file open, blocking the user. The app does no background initialization during the idle startup window.

## Requirements

- **R1.** The rhino3dm WASM binary (`rhino3dm.wasm`) and its JS loader (`rhino3dm.min.js`) are copied from `node_modules/rhino3dm/` into the built distributable at build time so they are always available on disk.
- **R2.** `Rhino3dmLoader.setLibraryPath` in `getLoader()` (`src/lib/rhino3dm-service.ts`) is updated to point to the local relative path (not the CDN URL).
- **R3.** `getRhino3dm()` in `rhino3dm-service.ts` is updated to load the rhino3dm module from the local file (not via CDN script injection). The `<script>` tag injection path and CDN URL are removed.
- **R4.** The version used is the npm-installed version (`8.17.0`). The hardcoded `8.4.0` CDN reference is eliminated. Future version updates happen through `package.json`, not by editing source URLs.
- **R5.** `getLoader()` is called eagerly on app launch — during the startup idle window, before any user interaction with files — so WASM JIT compilation completes before the first file open.
- **R6.** The app opens, parses, and exports `.3dm` files with no network access required.

## Success Criteria

- First file open after cold launch takes no longer than a warm open (WASM already compiled by the time the user picks a file).
- Opening a `.3dm` file with no internet connection succeeds.
- No CDN-related console errors or network requests for rhino3dm appear in the packaged app.
- The installed npm version (`8.17.0`) is what runs — not `8.4.0`.

## Scope Boundaries

- Does **not** move rhino3dm parsing to the Electron main process.
- Does **not** add a geometry cache or change the Three.js rendering pipeline.
- Does **not** add a CDN fallback (Electron distributable should always have the local files; a missing WASM is a build failure, not a runtime fallback scenario).
- Does **not** change any user-facing UI behavior.

## Key Decisions

- **Eager init on app launch**: `getLoader()` is called during startup idle time, not deferred to welcome screen or first file open. This maximizes the preload window.
- **No CDN fallback**: Local files are authoritative. If the WASM is missing it indicates a broken build, which should surface as an error rather than silently falling back to a potentially mismatched CDN version.
- **Use npm-installed version**: Eliminates the 8.4.0 vs 8.17.0 split and makes version management straightforward.

## Dependencies / Assumptions

- `rhino3dm@8.17.0` is already a declared npm dependency and its files are present in `node_modules/rhino3dm/` at build time.
- The Electron build pipeline (via Vite or electron-builder) can be configured to copy static assets into the distributable's output directory.

## Outstanding Questions

### Deferred to Planning

- **[R1][Technical]** What is the best build-time mechanism to copy `rhino3dm.wasm` and `rhino3dm.min.js` into the dist output — Vite's `publicDir`, `vite-plugin-static-copy`, or an `electron-builder extraResources` directive?
- **[R2][Technical]** What relative path should `setLibraryPath` use in the packaged Electron app (where the base URL is `file://`) vs. dev mode (where Vite serves at `localhost:5173`)? The path may need to differ per environment.
- **[R5][Technical]** Where in the startup sequence is the right place to call `getLoader()` eagerly — `App.tsx` top-level, a dedicated init module, or somewhere in the Electron main/preload handshake?
- **[R3][Technical]** After removing the `<script>` injection in `getRhino3dm()`, confirm whether `rhino3dm.module.min.js` (the ES module variant in node_modules) can be imported directly via a standard `import()` call in the renderer, or whether the IIFE variant (`rhino3dm.min.js`) still needs script-tag loading.

## Next Steps

→ `/ce:plan` for structured implementation planning
