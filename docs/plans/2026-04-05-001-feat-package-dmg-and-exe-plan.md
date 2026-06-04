---
title: "feat: Package App as DMG (macOS) and EXE (Windows)"
type: feat
status: completed
date: 2026-04-05
---

# feat: Package App as DMG (macOS) and EXE (Windows)

## Overview

0studio is an Electron desktop app. macOS DMG packaging already works via `npm run electron:dist`, producing arm64 and x64 DMGs. Windows EXE packaging does not exist — no `win` target is configured, no `.ico` icon file exists, and the build scripts have Unix-only assumptions (`mv`) that break on Windows. This plan adds Windows NSIS installer support, fixes cross-platform build script compatibility, and wires up a GitHub Actions CI workflow that produces both macOS and Windows artifacts on release.

## Current State

- **electron-builder**: v26.5.0, already installed
- **Existing macOS targets**: DMG + ZIP, for x64 + arm64 (`package.json` lines 128–154)
- **Output directory**: `dist-electron` (doubles as compiled-TS output dir — causes clutter)
- **Build script**: `build:electron` uses `mv` to rename `preload.js → preload.cjs` — this is Unix-only and breaks on Windows runners
- **`build:all`**: double-runs `build` and `build:electron` (runs them itself + calls `electron:dist` which runs them again)
- **No Windows config**: no `"win"` section in `package.json` `build` block
- **No `.ico`**: only `assets/icon.png` (3024×3024 PNG) — Windows packaging requires a multi-resolution `.ico`
- **Platform guards missing**: `titleBarStyle: 'hiddenInset'` and `trafficLightPosition` set unconditionally in `electron/main.ts:83–84` — these are macOS-only; on Windows the window chrome will be broken
- **Squirrel handler commented out**: `electron/main.ts:29–32` — NSIS installers on Windows fire `--squirrel-*` argv events; without handling them, shortcuts may be broken on first install
- **CI secrets missing**: `release.yml` build step has no `VITE_*` env vars — CI-built binaries will have empty Supabase/Stripe/backend config and be non-functional
- **`author` field**: `package.json` shows `"Your Name"` — this appears in Windows Add/Remove Programs as "Publisher"

## Proposed Solution

### Phase 1: Fix cross-platform build scripts (package.json)

Fix issues that make the build pipeline work correctly on both macOS and Windows:

**1a. Cross-platform preload rename**

Replace the `mv` command in `build:electron` with a portable Node.js one-liner:

```json
// package.json (build:electron script)
"build:electron": "tsc -p electron/tsconfig.json && tsc -p electron/preload-tsconfig.json && node -e \"require('fs').renameSync('dist-electron/preload.js','dist-electron/preload.cjs')\""
```

**1b. Fix `build:all` double-compilation**

```json
// package.json (build:all script) — currently runs build & build:electron twice
"build:all": "npm run build && npm run build:electron && electron-builder --publish=never"
```

**1c. Separate output directory**

Change `directories.output` from `dist-electron` (collision with compiled TS) to `release`:

```json
// package.json build.directories
"directories": {
  "output": "release",
  "buildResources": "build"
}
```

Update `electron:dist` artifact globs and CI workflow paths accordingly.

**1d. Fix `package.json` `author` field**

Set to the real publisher name (used in Windows installer UI and Add/Remove Programs).

### Phase 2: Generate `.ico` and add Windows target config

**2a. Generate multi-resolution `.ico`**

Using ImageMagick (run once locally, commit the result):

```bash
# terminal
brew install imagemagick  # if not installed
convert assets/icon.png \
  -define icon:auto-resize=256,128,64,48,32,16 \
  assets/icon.ico
```

Commit `assets/icon.ico` to the repo.

**2b. Add `win` and `nsis` sections to `package.json`**

```json
// package.json build section — add after "dmg" block
"win": {
  "icon": "assets/icon.ico",
  "publisherName": "0studio",
  "target": [
    { "target": "nsis", "arch": ["x64"] }
  ],
  "fileAssociations": [
    {
      "ext": "3dm",
      "name": "Rhino 3D Model",
      "description": "Rhino 3D Model File"
    }
  ]
},
"nsis": {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "0studio",
  "deleteAppDataOnUninstall": false,
  "license": "build/license.rtf"
}
```

`oneClick: false` gives users the standard Next/Next/Finish wizard, appropriate for a pro tool. `perMachine: false` installs to `AppData\Local` without requiring admin rights.

### Phase 3: Fix Electron main process for Windows

**3a. Platform-conditional title bar in `electron/main.ts`**

```typescript
// electron/main.ts — createWindow(), around line 83
const isMac = process.platform === 'darwin';

const win = new BrowserWindow({
  // ... other options ...
  titleBarStyle: isMac ? 'hiddenInset' : 'default',
  ...(isMac ? { trafficLightPosition: { x: 10, y: 6 } } : {}),
  // ...
});
```

**3b. Re-enable Windows startup handler in `electron/main.ts`**

Un-comment the Squirrel startup guard (lines 29–32), scoped to Windows only:

```typescript
// electron/main.ts — top of file, before app.whenReady()
if (process.platform === 'win32' && require('electron-squirrel-startup')) {
  app.quit();
}
```

This prevents the app from attempting to run during NSIS install/uninstall events, which would produce broken Start Menu shortcuts on some Windows versions.

### Phase 4: Update GitHub Actions CI workflow

**File**: `.github/workflows/release.yml`

Split the existing single macOS job into three jobs: `build-macos`, `build-windows`, and `release`.

```yaml
# .github/workflows/release.yml (restructured)
name: Build and Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g., 1.0.1)'
        required: true

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Build macOS
        run: npm run build:all
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_BACKEND_URL: ${{ secrets.VITE_BACKEND_URL }}
          VITE_STRIPE_PUBLISHABLE_KEY: ${{ secrets.VITE_STRIPE_PUBLISHABLE_KEY }}
      - uses: actions/upload-artifact@v4
        with:
          name: macos-builds
          path: |
            release/*.dmg
            release/*.zip
          retention-days: 5

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Build Windows
        run: npm run build && npm run build:electron && npx electron-builder --win --publish=never
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_BACKEND_URL: ${{ secrets.VITE_BACKEND_URL }}
          VITE_STRIPE_PUBLISHABLE_KEY: ${{ secrets.VITE_STRIPE_PUBLISHABLE_KEY }}
      - uses: actions/upload-artifact@v4
        with:
          name: windows-builds
          path: |
            release/*.exe
          retention-days: 5

  release:
    needs: [build-macos, build-windows]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: macos-builds
          path: ./artifacts
      - uses: actions/download-artifact@v4
        with:
          name: windows-builds
          path: ./artifacts
      - name: Generate SHA256 checksums
        run: |
          cd artifacts
          sha256sum *.dmg *.zip *.exe > checksums.txt 2>/dev/null || true
      - uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ github.ref_name }}
          name: 0studio ${{ github.ref_name }}
          draft: false
          prerelease: false
          files: |
            ./artifacts/*.dmg
            ./artifacts/*.zip
            ./artifacts/*.exe
            ./artifacts/checksums.txt
          body: |
            ## 0studio ${{ github.ref_name }}

            ### Downloads

            **macOS**
            - `*-arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
            - `*-x64.dmg` — Intel Mac

            **Windows**
            - `*-Setup.exe` — Windows installer (x64)

            > ⚠️ **macOS**: If Gatekeeper blocks the app, right-click → Open, or go to System Settings → Privacy & Security → "Open Anyway".
            > ⚠️ **Windows**: SmartScreen may warn "Unknown publisher" — click "More info" → "Run anyway". The app is not yet code-signed.
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Required GitHub Secrets to add** (repository Settings → Secrets and variables → Actions):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BACKEND_URL`
- `VITE_STRIPE_PUBLISHABLE_KEY`

## Technical Considerations

- **Cross-compilation**: NSIS Windows installers can be built on macOS with electron-builder (no Wine needed). The CI approach of using `windows-latest` is simpler and enables future code signing.
- **Output dir rename**: Changing `directories.output` from `dist-electron` to `release` means any scripts or docs referencing `dist-electron/*.dmg` must be updated (check `docs/BUILD_GUIDE.md`, `docs/HOMEBREW_SETUP.md`, `docs/HOMEBREW_UPDATE.md`).
- **SmartScreen warning**: Without a Windows Authenticode code signing certificate, all users will see a SmartScreen "Unknown publisher" dialog. This is unavoidable for unsigned builds. Document this prominently in the release notes.
- **Gatekeeper on macOS**: Code signing is currently disabled (`"identity": null`). The existing Gatekeeper bypass instructions in the Homebrew cask and docs cover this.
- **`simple-git` / GitService**: `simple-git` is in `dependencies` but GitService import is unused in the packaged build per `main.ts:9`. Audit whether it's truly dead code — if so, remove it to reduce installer size and avoid AV false positives on Windows.
- **rhino3dm CDN dependency**: The renderer loads rhino3dm from jsDelivr CDN at runtime. On Windows in restricted corporate environments this may silently fail. Out of scope for v1 — document the internet requirement.
- **Windows ARM64**: Skipping Windows ARM builds for v1 — the `windows-latest` runner is x64 and cross-compiling ARM64 Windows with native modules is risky.

## System-Wide Impact

- **Interaction graph**: `build:electron` rename change affects `electron:dev`, `electron:dist`, and `build:all` scripts — all currently call `build:electron`. CI workflow calls these directly.
- **Error propagation**: If `VITE_*` secrets are not set in GitHub Actions, the Vite build silently embeds empty strings — the app opens but auth/sync/payments silently fail. This is the highest-risk silent failure.
- **State lifecycle**: Output dir rename from `dist-electron` to `release` is purely a path change — no runtime state affected. Electron main process and preload paths are all relative; they don't reference `dist-electron` by name.
- **API surface parity**: `files` array in `package.json` `build` still references `dist-electron/main.js`, `dist-electron/preload.cjs`, etc. — these paths are the source files (compiled TS output), not the output dir, so they stay correct even after the output dir rename.

## Acceptance Criteria

- [ ] `npm run electron:dist` on macOS produces `release/*.dmg` (arm64 + x64) without errors
- [ ] `npx electron-builder --win --publish=never` on a Windows machine (or CI) produces `release/*-Setup.exe`
- [ ] `assets/icon.ico` exists, is committed, and contains 16/32/48/64/128/256px sizes
- [ ] `build:electron` script works on Windows (no `mv` command)
- [ ] `build:all` does not run `build` or `build:electron` twice
- [ ] Output directory is `release/`, not `dist-electron/`
- [ ] macOS app window renders correctly (hidden title bar with traffic lights)
- [ ] Windows app window renders correctly (native title bar, no visual artifacts from `trafficLightPosition`)
- [ ] NSIS installer runs without errors on Windows 10/11; app launches after install
- [ ] `.3dm` file association registered by NSIS installer (double-click opens 0studio)
- [ ] GitHub Actions workflow produces all artifacts (macOS DMG + ZIP, Windows EXE) on tag push
- [ ] `VITE_*` secrets documented and set in repo settings
- [ ] `author` field in `package.json` set to real publisher name
- [ ] Release notes include SmartScreen and Gatekeeper bypass instructions

## Dependencies & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `VITE_*` secrets not set in GitHub → non-functional CI builds | High | Set all four secrets before first CI release build; test by checking Supabase URL in the packaged app |
| SmartScreen blocking Windows users | Medium | Document bypass in release notes; plan for Authenticode cert in future |
| `simple-git` in dependencies inflating installer / triggering AV | Low | Audit and remove if truly unused |
| `rhino3dm` CDN blocked in corporate networks | Low | Out of scope v1; document internet requirement |
| Output dir rename breaking Homebrew cask URL patterns | Medium | Update `HOMEBREW_SETUP.md` and `HOMEBREW_UPDATE.md` after rename; verify `ls release/*.zip` output filenames match cask |

## Files to Change

- `package.json` — `build:electron`, `build:all`, `directories.output`, `author`, add `win` + `nsis` sections
- `assets/icon.ico` — new file (generate with ImageMagick, commit)
- `electron/main.ts` — platform guard for title bar (lines 83–84), re-enable Squirrel handler (lines 29–32)
- `.github/workflows/release.yml` — add `build-windows` job, add `VITE_*` env vars to both build jobs, fix artifact paths
- `docs/BUILD_GUIDE.md` — update output dir references from `dist-electron/` to `release/`
- `docs/HOMEBREW_SETUP.md` — update ZIP path references

## Sources & References

### Internal References
- Current build config: `package.json:109–160`
- Title bar / Squirrel: `electron/main.ts:29–32, 83–84`
- Build docs: `docs/BUILD_GUIDE.md`, `docs/CODE_SIGNING_GUIDE.md`, `docs/HOMEBREW_SETUP.md`
- Entitlements: `build/entitlements.mac.plist`
- License: `build/license.rtf`
- CI workflow: `.github/workflows/release.yml`

### External References
- electron-builder Windows config: https://www.electron.build/configuration/win
- electron-builder NSIS config: https://www.electron.build/configuration/nsis
- electron-builder cross-compilation: https://www.electron.build/multi-platform-build
- ImageMagick ICO conversion: `convert assets/icon.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico`
