---
title: "feat: Windows Build Hardening for Tester Parity"
type: feat
status: active
date: 2026-04-26
origin: docs/brainstorms/2026-04-23-windows-build-hardening-requirements.md
---

# feat: Windows Build Hardening for Tester Parity

## Enhancement Summary

**Deepened on:** 2026-04-26 (ultrathink mode). Run after initial plan write, integrating findings from architecture-strategist, security-sentinel, performance-oracle, code-simplicity-reviewer, pattern-recognition-specialist, julik-frontend-races-reviewer, agent-native-reviewer, plus targeted SAC mitigation research.

### Critical corrections applied
1. **SAC is NOT a blocker as of April 14, 2026.** Cumulative update KB5083769 (build ≥26100.8116) made SAC freely reversible from Settings — no Windows reset required. Risk severity dropped High → Medium. Tester preflight reduced to a 60-second click-path. (Source: BleepingComputer KB5079391 / KB5083769 rollout, Microsoft Learn SAC overview Apr 2026.)
2. **Phase 4 OAuth: PKCE exchange moves entirely to main process.** Original plan tried to inject a main-generated verifier into the renderer's `supabase-js` storage — there is no public API for that and it relies on undocumented internal storage keys. Corrected: main calls Supabase's `/auth/v1/token?grant_type=pkce` endpoint directly via `fetch`, returns `{access_token, refresh_token}` to renderer, renderer calls `supabase.auth.setSession()` (documented public API). Eliminates verifier-handoff bug entirely.
3. **IPC channel naming: kebab-case without colons.** Existing channels in `electron/preload.ts` are all kebab-case-no-namespace (`open-project-dialog`, `save-commit-file`, etc.). Plan's `auth:google-sign-in` etc. would break the convention. Renamed throughout: `start-google-sign-in`, `cancel-google-sign-in`, `start-stripe-checkout`, `cancel-stripe-checkout`, `get-diagnostic-report`.
4. **Phase 4 cancellation + lifecycle hardening.** Added cancel-IPC handlers, `Set<http.Server>` tracking with `render-process-gone` + `webContents:destroyed` cleanup hooks, `socket.destroy()` on close (Node `server.closeAllConnections()` ≥18.2). Reduced 5min timeout to 3min.
5. **Phase 4 security hardening.** Loopback servers must validate `Host` header, enforce single-shot semantics (close after first valid request), serve success HTML with `CSP: default-src 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Stripe success URL gets a `state` param for CSRF symmetry with OAuth. `shell.openExternal` URLs validated against an allowlist of `https:` + expected hostnames before launch.
6. **Phase 5 redaction patterns expanded** from 3 to 9: add `sb_publishable_*` / `sb_secret_*` / `sk_(test|live)_*` / `rk_(test|live)_*` Stripe restricted, `refresh_token` JSON values, OAuth `code=`/`code_verifier=`/`state=` query params, `(?:/Users|/home|C:\\Users)\\<USER>` segment replacement, email PII. Backed by a unit test fixture in `electron/lib/log-redact.test.ts` rather than manual review.
7. **Phase 5 logging architecture clarified.** Keep `electron-log/main` + `electron-log/renderer` (the documented v5 idiom) — do not invert. But disable `console` transport in packaged builds and either disable `eventLogger.startLogging()` OR extend redact regex to scrub `code`/`access_token`/`refresh_token` query params from URL-bearing event log lines.
8. **Phase 3 race fixes.** `pendingFileToOpen` queue must drain after `did-finish-load` (not just `whenReady`). `webContents.send` before window-ready drops messages — wrap in a `pendingMessages: any[]` array and flush on `did-finish-load`. Single-instance lock check must run BEFORE `electron-log` `initialize()`.
9. **Phase 2 chokidar tuning corrected.** Static 500→1500ms threshold gives +1s p50 latency on every save. Replaced with adaptive strategy: start at 500ms, escalate to 1500ms after first EBUSY in this session. Retry backoff tightened from `50/200/800/2000` to `25/75/200/500/1500` (capped composed worst case ~2.3s vs original 4.5s). Watcher fires `change` raw → renderer shows subtle "save detected, syncing…" indicator before stability resolves.
10. **`shell.openExternal` URL allowlist.** Build the Supabase auth URL entirely in main from env constants. Validate `new URL(u); ['https:'].includes(parsed.protocol) && allowedHosts.includes(parsed.hostname)` before launch. Defends against renderer XSS or compromised dependency injecting `javascript:` / `file:` URLs.
11. **Backend-side touchpoint surfaced.** `backend/routes/stripe.js` constructs Checkout Sessions and currently sets `success_url` from request payload; Phase 4 must verify it accepts the loopback URL passed from renderer.
12. **Agent-native additions.** `--diag-report` CLI flag prints JSON report to stdout (no window), wraps `get-diagnostic-report` in `desktop-api.ts`, writes `%APPDATA%\0studio\logs\diag-report.json` on every app start. `scripts/windows-smoke.ps1` automates ~10-12 mechanical checklist items (registry, file existence, log writability) before the human checklist runs. `scripts/verify-windows-artifact.cjs` runs in CI to assert `dist/rhino3dm/rhino3dm.wasm` and `dist/web-ifc/web-ifc.wasm` are present and non-empty in the asar — converts Phase 0b from one-time check to permanent CI gate.

### Pushback rejected (and why)
- **"Defer Phase 4 entirely until tester reports OAuth break."** (code-simplicity reviewer.) Tempting and would save 3-4 days, but the security review found multiple HIGH-severity issues in the *current* `redirectTo: window.location.origin` flow that aren't tester-visible — packaged-Mac users may be running with a broken token-handling path that's only working accidentally. Phase 0a still gates whether to act, but the architecturally-correct rebuild is worth doing once cross-platform.
- **"Inline `path-util.ts` and `argv-util.ts`."** (code-simplicity.) Inlined `path-util.ts` (1-2 callers, zero state). Kept `argv-util.ts` because security review added path-traversal/realpath/length checks that justify a separate testable module. Also kept because moving `isSupportedProjectFile` and `SUPPORTED_PROJECT_EXTS` out of `main.ts` breaks a circular import that `argv-util.ts` would otherwise create.
- **"Drop `vite-plugin-validate-env` runtime guard."** (code-simplicity.) Kept — security review found that `import.meta.env` substitutions evaluate to `undefined` (not `""`) when var is missing, so deep-call-site failures are silent. Build-time check stops "missing var" but runtime check stops "var set to empty string in CI" which is a different and observed failure mode.
- **"Drop `scripts/wait.cjs`."** (architecture + simplicity, both flagged.) Accepted. `wait-on http://localhost:5173` is sufficient; the 2s extra was paper over a hot-reload race that should be diagnosed if it reappears.

### New considerations discovered
- Backend `routes/stripe.js` is in Phase 4 scope (was missing from original file-layout).
- Windows Defender heuristic flagging: ~5-15% of fresh Windows 11 machines get unsigned Electron + WASM-blob installers quarantined as `Wacatac.B!ml` or similar generic ML rule. Submit each new build to https://www.microsoft.com/wdsi/filesubmission ahead of tester handoff (24-72h response).
- Corporate WDAC/AppLocker: Phase 0c expands tester preflight to ask whether machine is enterprise-managed (`Settings → Accounts → Access work or school`). If yes, defer that tester — no override exists for managed WDAC.
- electron-log `eventLogger.startLogging()` auto-logs `webContents` URL navigation. URLs during OAuth contain `?code=...` — either disable eventLogger or extend redaction. Plan extends redaction.
- `simple-git` removal acceptance check: add `grep -rn 'GitService\|simple-git\|project-service' src/ electron/` to PR check before deletion.

## Overview

Take 0studio's Windows .exe build from "scaffolded but never end-to-end-tested" to a working, full-parity build that a non-developer Windows tester can install, use exactly as the macOS app, and uninstall cleanly. The April 5 packaging plan (`docs/plans/2026-04-05-001-feat-package-dmg-and-exe-plan.md`, status: completed) wired the NSIS target, `icon.ico`, platform guards, and a `windows-latest` CI job — but six major features have shipped since (dual-artifact commits Phases 0-3A, cloud sync 3A, chokidar file watcher rewrite, rhino3dm local WASM, delta compression, glTF derivative conversion) and none have been Windows-tested. The April 23 brainstorm (origin) commits to **full feature parity, audit + instrument before first tester session**, **3-or-fewer tester round-trips**, and **unsigned .exe is fine for the tester**.

This plan implements R1-R7 from the origin in seven phases, ordered to make the tester-handoff feedback loop as productive as possible: build correctness first (so the tester actually has something to install), audit fixes second (so they don't trip immediately), correctness/architecture third (so OAuth and double-click work), diagnostic logging fourth (so any bug they hit produces actionable info), then the human-side work — checklist, handoff artifacts, known-issues tracker.

## Problem Statement

Windows packaging exists in `package.json` (`win.target: nsis`, `assets/icon.ico` committed, NSIS config), `electron/main.ts` (`isMac` platform guard for title bar), and `.github/workflows/release.yml` (`build-windows` job on `windows-latest`). None of it has been verified end-to-end on real Windows hardware. The static audit run for this plan (see Research section) found:

- The CI `build-windows` job has **almost certainly never produced a working .exe** because `package.json` `copy:rhino3dm` and `copy:web-ifc` use Unix-only `mkdir -p` + `cp` on a `windows-latest` runner. Without those copy steps, the renderer cannot load any 3D model. This blocks every R2 feature.
- Google OAuth and Stripe Checkout both call `redirectTo: window.location.origin`, which is `file://` in any packaged Electron build (Mac or Windows). This almost certainly means the macOS DMG OAuth flow is also broken — the team has been using dev mode (`http://localhost:5173`) where it works.
- No `app.requestSingleInstanceLock()` is wired. Double-clicking a `.3dm` while the app is running on Windows opens a second instance window.
- No diagnostic logger exists in the codebase — only three `console.error` call sites in `electron/main.ts`. R4 is greenfield.
- One genuine path-string bug in `src/contexts/VersionControlContext.tsx:352` (`path.split('/').pop()`) that breaks model display name on Windows.
- `simple-git@3.27.0` is dead code in the packaged build (~3MB inflating the installer); the `electron/services/git-service.ts` and `electron/services/project-service.ts` they live in are not constructed by `main.ts`.
- Stale "rhino3dm library loads from CDN" string in `release.yml:142` will mislead testers (the WASM is now bundled).
- A new external risk **not in the brainstorm**: Windows 11 24H2's **Smart App Control (SAC)** silently blocks unsigned binaries with no "Run anyway" option for fresh-install Win 11 users (~30-50% of consumer Windows machines per April 2026 telemetry). The brainstorm assumed SmartScreen "Run anyway" is sufficient — for SAC-enabled testers, it isn't. This must be verified or worked around as a Phase 0 preflight.

## Proposed Solution

Seven phases, gated by Phase 0 verification. Phases 1-3 unblock the tester. Phase 4 is the largest piece (cross-platform OAuth/Stripe rebuild) and may be deferred if Phase 0 reveals the current packaged Mac flow secretly works. Phases 5-7 produce the durable assets the brainstorm promised ("static audit is the compounding asset").

### Phase 0 — Verify current state (preflight, ~half day)

Before changing any code, establish three ground truths that determine whether the rest of the plan is correctly scoped:

**0a. Does the current macOS DMG OAuth and Stripe Checkout work end-to-end?**
- Build `npm run electron:dist` on the current `main` branch.
- Install the DMG, sign in with Google, attempt a Stripe Checkout test session.
- If both work: there is a code path I don't yet understand and Phase 4 is much smaller (the redirect mechanism is somehow functional in packaged Electron, possibly via Supabase's session-via-realtime pickup). Re-scope Phase 4 to just the loopback for Stripe (Stripe rejects `file://` more strictly than Google).
- If either fails: Phase 4 is a cross-platform fix benefitting Mac too, not Windows-specific.
- Document the result in `docs/windows-known-issues.md` (created in Phase 7) and update Phase 4 scope.

**0b. Does the current `build-windows` CI job actually produce a runnable .exe?**
- Trigger the workflow via `workflow_dispatch` with a dummy version. Read the logs.
- If `npm run copy:rhino3dm` or `copy:web-ifc` fails on PowerShell (expected): we are correct that no working .exe has ever shipped, Phase 1 is necessary.
- If it succeeds (GitHub Actions silently routing through Git Bash): re-scope Phase 1 to confirm rhino3dm/web-ifc resources actually arrive in the packaged .exe (download the artifact, unzip the asar with `npx asar extract`, verify `dist/rhino3dm/rhino3dm.wasm` and `dist/web-ifc/web-ifc.wasm` are present and non-empty).

**0c. Will the tester's machine accept an unsigned .exe?**

Three checks, all completed before the first handoff round.

- **0c.i — Windows build version.** Have the tester run `winver`. **Required: OS Build ≥ 26100.8116** (April 14, 2026 cumulative KB5083769). On that build and later, Smart App Control is freely reversible from Settings; the previously assumed "one-way / requires reset" rule no longer applies. If they're below this build, either have them install Windows Update first or treat SAC as a hard blocker.
- **0c.ii — Enterprise-managed machine check.** `Settings → Accounts → Access work or school`. If the machine is enrolled in Intune / domain-joined / under MDM, ask whether IT enforces WDAC or AppLocker policies. Run `Get-AppLockerPolicy -Effective -XML` to inspect. If unsigned executables are policy-blocked, **no override exists**; defer this tester until Microsoft Artifact Signing is in place (see Future Considerations).
- **0c.iii — SAC + Defender state.** Have the tester run `Get-MpComputerStatus | Select SmartAppControlState, AMRunningMode`. If `SmartAppControlState` is `Off` or `Eval`, no action needed. If `On`, walk them through the 60-second toggle: `Settings → Privacy & Security → Windows Security → App & browser control → Smart App Control settings → Off`. Reversible post-KB5083769 — they can flip it back on after the tester rounds.

**Defender heuristic flagging (separate from SAC).** ~5-15% of unsigned Electron apps with NSIS installers and WASM blobs trip Defender ML heuristics (commonly `Wacatac.B!ml`). Mitigation: submit each new build to https://www.microsoft.com/wdsi/filesubmission **24-72 hours before** tester handoff. Add this to the Phase 6 release checklist.

Document outcomes of all three checks in `docs/handoffs/2026-MM-DD-windows-tester-round-N.md` before Phase 6 handoff.

Phase 0 is a hard gate — output a one-page memo to `docs/windows-known-issues.md` (which Phase 7 establishes) summarizing the three ground truths before Phase 1 begins.

### Phase 1 — CI build correctness (R1)

Make the `windows-latest` job produce a working, downloadable .exe artifact every time the workflow runs.

**1a. Replace Unix-only npm scripts with Node scripts.** Per current external best-practice (Node ≥16 has `fs.cp`, `fs.mkdir({recursive})`, etc., obviating helper libs), write a tiny `scripts/copy-resources.cjs` that handles both rhino3dm and web-ifc copies, and a `scripts/wait.cjs` for the dev server delay.

```js
// scripts/copy-resources.cjs
const fs = require('node:fs');
const path = require('node:path');

const copies = [
  { src: 'node_modules/rhino3dm/rhino3dm.min.js', dst: 'public/rhino3dm/rhino3dm.min.js' },
  { src: 'node_modules/rhino3dm/rhino3dm.wasm',   dst: 'public/rhino3dm/rhino3dm.wasm' },
  { src: 'node_modules/web-ifc/web-ifc.wasm',     dst: 'public/web-ifc/web-ifc.wasm' },
];
for (const { src, dst } of copies) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`copied ${src} → ${dst}`);
}
```

```js
// scripts/wait.cjs
const ms = parseInt(process.argv[2] || '2000', 10);
setTimeout(() => process.exit(0), ms);
```

Update `package.json`:
```json
"copy:rhino3dm": "node scripts/copy-resources.cjs",
"copy:web-ifc":  "node scripts/copy-resources.cjs",
"build:electron": "npm run copy:rhino3dm && tsc -p electron/tsconfig.json && tsc -p electron/preload-tsconfig.json && node -e \"require('fs').renameSync('dist-electron/preload.js','dist-electron/preload.cjs')\"",
"electron:dev":   "npm run build:electron && concurrently \"npm run dev\" \"wait-on http://localhost:5173 && node scripts/wait.cjs 2000 && electron .\""
```

(Collapse the two copy scripts into one — there's no reason to run them separately.)

**1b. Add missing VITE_ env vars to both CI jobs.** `src/pages/Dashboard.tsx:60-61` reads `VITE_STRIPE_PRO_PRICE_ID` and `VITE_STRIPE_ENTERPRISE_PRICE_ID`. Both are absent from `release.yml`. Add to **both** `build-macos` and `build-windows` env blocks, and add as repo secrets.

**1c. Wire `vite-plugin-validate-env` with a Zod schema.** Single source of truth for required `VITE_*` vars. `vite build` fails loud if any are missing or empty.

```ts
// env.ts (sibling to vite.config.ts)
import { defineConfig } from '@julr/vite-plugin-validate-env';
import { z } from 'zod';

export default defineConfig({
  validator: 'zod',
  schema: {
    VITE_SUPABASE_URL: z.string().url(),
    VITE_SUPABASE_ANON_KEY: z.string().min(20),
    VITE_BACKEND_URL: z.string().url(),
    VITE_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
    VITE_STRIPE_PRO_PRICE_ID: z.string().startsWith('price_'),
    VITE_STRIPE_ENTERPRISE_PRICE_ID: z.string().startsWith('price_'),
  },
});
```

Plus a runtime guard in `src/main.tsx` that logs missing env vars to electron-log (Phase 5) and renders a startup error component instead of mounting `<App />`. This belt-and-braces protects against the "var set to empty string in CI" case.

**1d. Allow tester rounds without tag bumps.** Current workflow only fires on `push: tags v*` or `workflow_dispatch` with a `version` input. Add a third path: `workflow_dispatch` with a `branch` input that produces a tester artifact named `0studio-windows-tester-<sha>.exe` without creating a GitHub Release. Keep the tag-push and release-flow paths unchanged.

**1e. Strip stale CDN message.** Update `release.yml:142` — remove "An internet connection is needed to load 3D models (rhino3dm library loads from CDN)" since `rhino3dm-local-wasm` shipped. Replace with "An internet connection is required for cloud sync, sign-in, and updates." — accurate for the current state.

**1f. Strip dead Squirrel block.** `electron/main.ts:51-56` checks for Squirrel argv flags, but we ship NSIS not Squirrel — these args are never passed. Delete the block, with a one-line replacement comment noting NSIS handles install events natively.

**Acceptance:** Trigger `workflow_dispatch` on `feat/dual-artifact-phase-3-formats`. The Windows job produces a `0studio-1.0.3-Setup.exe` artifact. Download, install on Windows 11 x64 VM, app launches and shows the welcome screen. No more changes required at the CI level for the tester loop.

### Phase 2 — Static audit fixes (R3)

Fix every Windows-unsafe pattern surfaced by the audit. Each is small and local; together they prevent ~80% of the cross-platform regressions the brainstorm anticipates.

**2a. `src/contexts/VersionControlContext.tsx:352` — path-split bug.**
```ts
// before
const fileName = path.split('/').pop() || path;
// after
const fileName = path.split(/[\\/]/).pop() || path;
```
Audit consumers of `modelName` for any other forward-slash assumptions; window-title `basename` is fine (uses `path.basename`).

**2b. Remove `simple-git` and dead service files.** Delete:
- `electron/services/git-service.ts` (only importer of `simple-git`)
- `electron/services/project-service.ts` (only importer of `git-service`)
- `simple-git@3.27.0` from `package.json` dependencies

This eliminates the entire CRLF-parsing / git-on-PATH question for Windows. **Pre-deletion check** (PR acceptance gate): `grep -rn 'GitService\|simple-git\|project-service' src/ electron/ | grep -v 'docs/\|test/'` must return zero matches.

**2c. chokidar Windows tuning** (`electron/services/file-watcher.ts`):
- **Adaptive `stabilityThreshold`**: start at 500 ms (current). On the first EBUSY observed in this app session, escalate to 1500 ms for the remaining lifetime. Avoids the +1s p50 latency cost a static 1500 ms would impose on every save while still adapting for users with large .3dm files. ~30 lines of state in the watcher service. Static 1500 ms is acceptable Phase-1 fallback if adaptive logic adds risk.
- Keep `pollInterval: 100`; raise to 200 if the escalated threshold causes detection lag.
- Do **not** add `usePolling: true` for local NTFS — only conditionally enable for UNC paths (`path.startsWith('\\\\')`). Stub for now; revisit if the tester reports issues with a network-stored .3dm.
- Swallow EBUSY/EPERM in the watcher's `error` callback (downgrade to `log.debug`); they're transient on Windows during atomic-rename saves and not user-actionable.
- **Surface a "save detected, syncing…" UI indicator.** The watcher emits `change` raw before `awaitWriteFinish` settles. Wire a separate `change-pending` IPC event to the renderer that toggles a subtle indicator in the header. Hides the 500-1500ms latency by making it intentional.

**2d. Path normalization helper.** Add `electron/lib/path-util.ts`:
```ts
import path from 'node:path';
export const normalizePath = (p: string): string =>
  process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
```
Use everywhere paths are compared for equality (e.g. `electron/main.ts:454-456` `filename === this.currentIfcSidecar`). Do **not** use this for paths shown in the UI — only for equality checks.

**2e. EBUSY retry on file read + concurrent-save state machine.** `electron/main.ts:521` `readFile(filePath)` after a save event can throw EBUSY if Rhino still holds the lock. Tightened backoff: `25, 75, 200, 500, 1500` ms (5 attempts, ~2.3s total worst case). Most EBUSY clears in <100ms; the original `50 * Math.pow(4, i)` was too aggressive past the second attempt:

```ts
const RETRY_DELAYS = [25, 75, 200, 500, 1500] as const;
async function readFileWithRetry(p: string): Promise<Buffer> {
  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    try { return await fs.readFile(p); }
    catch (e: any) {
      const isLast = i === RETRY_DELAYS.length - 1;
      if (isLast || !['EBUSY','EPERM'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
    }
  }
  throw new Error('unreachable');
}
```

**Concurrent-save guard.** A user saving twice in 2 seconds can fire two chokidar `change` events while a previous read is still retrying. Without coordination, two concurrent reads race and an older read may win, flashing stale data into the UI. Add per-path state machine in the watcher service:
```ts
type ReadState = 'IDLE' | 'READING' | 'READING_STALE';
const states = new Map<string, ReadState>();
// On change event:
//   IDLE → READING, kick off read
//   READING → READING_STALE, do nothing (in-flight read will re-trigger)
//   READING_STALE → no-op
// On read complete:
//   READING → IDLE, dispatch result
//   READING_STALE → READING, kick off another read (do not dispatch this result)
```

**2f. Drive-letter casing in `productName`.** `package.json:115` already sets `productName: "0studio"`. Verify on the first packaged Windows build that `app.getPath('userData')` resolves to `%APPDATA%\0studio\`, not `%APPDATA%\rhino-studio\`. Different Electron versions have flipped on whether `name` or `productName` wins; if it's wrong, set both to `"0studio"`.

**Acceptance:** Each fix has a one-line diff or one-file-rename. Commit as a single PR titled `fix(windows): static audit fixes from R3 audit`. No tester impact yet — these are quietly preventing future regressions.

### Phase 3 — Windows-correct main process behavior (R2 part 1)

Fill the platform-guard gaps so file association, double-click while running, and second-instance launches work on Windows.

**3a. Single-instance lock + `second-instance` argv parser + safe-message queue.** Top of `setupApp()`, BEFORE `log.initialize()` (Phase 5a):
```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let pendingFileToOpen: string | null = extractProjectPath(process.argv);
const pendingRendererMessages: Array<[string, ...unknown[]]> = [];

function safeSend(channel: string, ...args: unknown[]) {
  if (!this.mainWindow || this.mainWindow.webContents.isLoading() || this.mainWindow.isDestroyed()) {
    pendingRendererMessages.push([channel, ...args]);
    return;
  }
  this.mainWindow.webContents.send(channel, ...args);
}

// On did-finish-load, drain the queue:
//   while (pendingRendererMessages.length) {
//     const [channel, ...args] = pendingRendererMessages.shift()!;
//     this.mainWindow!.webContents.send(channel, ...args);
//   }
//   if (pendingFileToOpen) { this.openProject(pendingFileToOpen); pendingFileToOpen = null; }

app.on('second-instance', (_event, argv /*, cwd */) => {
  const file = extractProjectPath(argv);
  if (!this.mainWindow || this.mainWindow.isDestroyed()) {
    if (file) pendingFileToOpen = file;
    return;
  }
  if (this.mainWindow.isMinimized()) this.mainWindow.restore();
  this.mainWindow.focus();
  if (file) this.openProject(file); // openProject internally uses safeSend
});
```

To break the circular import that would arise if `argv-util.ts` imported `isSupportedProjectFile` from `main.ts`, **extract the supported-file helper into its own module** (`electron/lib/project-file.ts`):
```ts
// electron/lib/project-file.ts
export const SUPPORTED_PROJECT_EXTS = ['.3dm', '.rvt', '.ifc'] as const;
export function isSupportedProjectFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SUPPORTED_PROJECT_EXTS.some((ext) => lower.endsWith(ext));
}
```

Argv parser with security defenses (`electron/lib/argv-util.ts`):
```ts
import fs from 'node:fs';
import path from 'node:path';
import { isSupportedProjectFile } from './project-file.js';

export function extractProjectPath(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (typeof a !== 'string') continue;
    if (a.length > 4096) continue;                        // DoS guard
    if (a.includes('\0')) continue;                       // null-byte injection
    if (a.startsWith('--') || a.startsWith('-')) continue; // Chromium flags
    if (!isSupportedProjectFile(a)) continue;
    try {
      const real = fs.realpathSync(a);                    // resolve symlinks/junctions
      if (real !== path.resolve(a) && process.platform === 'win32') {
        // On Windows, realpath rewrites case; accept that. But reject if
        // resolved path escapes to a system dir.
      }
      const lc = real.toLowerCase();
      if (process.platform === 'win32' && (lc.startsWith('c:\\windows\\') || lc.startsWith('c:\\program files'))) {
        continue; // never open files from system locations
      }
      if (!fs.existsSync(real)) continue;
      return real;
    } catch { continue; }
  }
  return null;
}
```

Replace the existing `process.argv[process.argv.length - 1]` parse at `electron/main.ts:101-108` with `extractProjectPath(process.argv)`. Defensive against NSIS-injected args, symlink/junction abuse, system-path traversal, and oversized argv.

**Cancellation channels (race-fix from review).** Phase 4 already adds `cancel-google-sign-in` and `cancel-stripe-checkout`; renderer must call them when the user closes the sign-in modal or navigates away mid-flow.

**3b. Keep `app.on('open-file')` unconditional.** Both researchers agreed: `open-file` is documented as macOS-only and silently no-ops on Windows. No platform guard needed; the idiomatic pattern is unconditional registration.

**3c. File association IPC.** Currently `openProject` is a private method on `RhinoStudio`. `second-instance` and `open-file` both need to call it. Already exposed — no IPC channel change required. Verify the renderer's `currentModel` updates correctly when called from a `second-instance` event (BrowserWindow.webContents.send('project-opened', ...) is the existing pattern).

**3d. Verify `nsis.fileAssociations` persists per-user.** External research surfaced a real conflict: electron-builder's official docs imply `perMachine: true` is required for file associations, while another source claims per-user works in current versions. **Empirical test:** install the .exe with `perMachine: false` (current config), then check `HKEY_CURRENT_USER\Software\Classes\.3dm`. If the entry is missing, re-test with `perMachine: true` and document the trade-off (admin elevation required at install). Outcome documented in `docs/windows-known-issues.md`. **Decision rule:** if per-user works, ship as-is. If per-user fails, accept the UAC prompt and switch `perMachine: true` for the tester build only — note in the handoff that admin-install is the current limitation.

**3e. Window controls overlay (defer; not required for parity).** The brainstorm explicitly says "Windows-specific UX redesign is polish, not parity." `titleBarStyle: 'default'` (current Windows path) gives native min/max/close buttons. Skip `titleBarOverlay`.

**Acceptance:** On a Windows install, double-clicking a `.3dm` while the app is closed opens it. Double-clicking a different `.3dm` while the app is running brings the app to front and switches to that file (no second window). Closing the window leaves the app alive only if `process.platform === 'darwin'` (existing behavior, unchanged on Windows).

### Phase 4 — OAuth + Stripe loopback architecture (R2 part 2)

Replace the `redirectTo: window.location.origin` flow with a loopback HTTP server pattern that works identically on dev, packaged macOS, and packaged Windows. **This is a cross-platform fix, not a Windows-specific one** — Phase 0a verification confirms whether the existing macOS DMG flow is silently broken too. **Keep the entire PKCE exchange in main process** to avoid leaking `supabase-js` internals.

The pattern: main spins an ephemeral HTTP server on `127.0.0.1:0`, opens the OAuth URL via `shell.openExternal`, captures `?code=&state=`, validates state, calls Supabase's token endpoint directly via `fetch`, returns `{access_token, refresh_token}` to renderer, renderer calls `supabase.auth.setSession()` (documented public API). Same shape for Stripe Checkout return URLs.

**4a. Switch Supabase client to PKCE.** `src/lib/supabase.ts`:
```ts
createClient(url, anon, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true },
});
```
`detectSessionInUrl: false` is critical: in Electron, `window.location` is meaningless and the default `true` causes spurious session attempts.

**4b. New `electron/services/oauth-service.ts`.** Loopback PKCE flow, exchange completes in main. Returns access+refresh tokens to renderer.

```ts
// electron/services/oauth-service.ts
import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';

const ALLOWED_AUTH_HOSTS = new Set<string>([new URL(process.env.VITE_SUPABASE_URL!).host]);
const SUCCESS_HTML = `<!doctype html><html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="referrer" content="no-referrer">
  <title>Signed in</title>
  <style>body{font-family:system-ui;text-align:center;padding:80px}</style>
  </head><body><h2>Signed in to 0studio</h2><p>You can close this tab.</p></body></html>`;

function base64url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

let inFlight: Promise<TokenPair> | null = null;
let activeServer: http.Server | null = null;
let activeAbort: (() => void) | null = null;
const openServers = new Set<http.Server>();

export interface TokenPair { access_token: string; refresh_token: string; user: unknown; }

export function startGoogleSignIn(supabaseUrl: string, anonKey: string): Promise<TokenPair> {
  if (inFlight) return inFlight; // double-click guard

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  let consumed = false;

  inFlight = new Promise<TokenPair>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Single-shot: any second request gets 410 Gone
      if (consumed) { res.writeHead(410, securityHeaders()); res.end('Gone'); return; }

      // Host validation: reject anything not addressed to our loopback
      const expectedHost = `127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.headers.host !== expectedHost) {
        res.writeHead(400, securityHeaders()); res.end('bad host'); return;
      }

      const url = new URL(req.url!, `http://${expectedHost}`);
      if (url.pathname !== '/auth-callback') {
        res.writeHead(404, securityHeaders()); res.end('Not found'); return;
      }
      consumed = true;

      const incomingState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (incomingState !== state || !code) {
        res.writeHead(400, securityHeaders()); res.end('bad state');
        cleanup();
        reject(Object.assign(new Error('state mismatch'), { code: 'OAUTH_STATE_MISMATCH' }));
        return;
      }

      // Main-side PKCE exchange — direct fetch to Supabase token endpoint.
      // Uses our own verifier; bypasses supabase-js storage entirely.
      try {
        const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
        });
        if (!tokenRes.ok) throw new Error(`token endpoint ${tokenRes.status}`);
        const data = await tokenRes.json() as { access_token: string; refresh_token: string; user: unknown };
        res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders() });
        res.end(SUCCESS_HTML);
        cleanup();
        resolve({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
      } catch (err: any) {
        res.writeHead(500, securityHeaders()); res.end('exchange failed');
        cleanup();
        reject(Object.assign(err, { code: 'OAUTH_EXCHANGE_FAILED' }));
      }
    });

    openServers.add(server);
    activeServer = server;

    const timeout = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('oauth timeout'), { code: 'OAUTH_TIMEOUT' }));
    }, 3 * 60_000); // 3 min, was 5 — narrower attack surface

    activeAbort = () => {
      cleanup();
      reject(Object.assign(new Error('oauth cancelled'), { code: 'OAUTH_CANCELLED' }));
    };

    function cleanup() {
      clearTimeout(timeout);
      openServers.delete(server);
      if (activeServer === server) activeServer = null;
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections(); // Node ≥18.2
      }
      server.close();
      inFlight = null;
      activeAbort = null;
    }

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}/auth-callback`;
      const supabaseAuthUrl = buildSupabaseAuthUrl(supabaseUrl, redirect, challenge, state);
      const parsed = new URL(supabaseAuthUrl);
      if (parsed.protocol !== 'https:' || !ALLOWED_AUTH_HOSTS.has(parsed.host)) {
        cleanup();
        reject(Object.assign(new Error('blocked auth url'), { code: 'OAUTH_BLOCKED_URL' }));
        return;
      }
      shell.openExternal(supabaseAuthUrl);
    });
  });

  return inFlight;
}

export function cancelGoogleSignIn() { activeAbort?.(); }

export function shutdownAllOAuthServers() {
  for (const s of openServers) {
    if (typeof (s as any).closeAllConnections === 'function') (s as any).closeAllConnections();
    s.close();
  }
  openServers.clear();
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

function buildSupabaseAuthUrl(supabaseUrl: string, redirect: string, challenge: string, state: string) {
  const u = new URL(`${supabaseUrl}/auth/v1/authorize`);
  u.searchParams.set('provider', 'google');
  u.searchParams.set('redirect_to', redirect);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  return u.toString();
}
```

Renderer side, after IPC returns:
```ts
const { access_token, refresh_token } = await desktopAPI.startGoogleSignIn();
await supabase.auth.setSession({ access_token, refresh_token });
// onAuthStateChange fires, AuthContext updates session.
```

Hooks for cleanup on lifecycle events (in `electron/main.ts`):
- `app.on('before-quit', shutdownAllOAuthServers)` — graceful quit
- `mainWindow.webContents.on('render-process-gone', shutdownAllOAuthServers)` — renderer crash
- `mainWindow.webContents.on('destroyed', shutdownAllOAuthServers)` — window close mid-flow

**4c. Stripe Checkout return URL.** Same loopback skeleton (`electron/services/stripe-service.ts`), simpler (no PKCE), but **adds a `state` param for CSRF parity**:
```ts
const state = base64url(crypto.randomBytes(16));
// Backend creates Checkout Session with success_url:
// http://127.0.0.1:<port>/return?status=success&session_id={CHECKOUT_SESSION_ID}&state=<state>
// Loopback validates state, then renderer asks backend to verify the session.
```
Verify the session via the existing backend route (`stripe.checkout.sessions.retrieve`) — **never** trust the success URL alone. Renderer must call `/api/stripe/verify-session` with `Authorization: Bearer <jwt>` and the captured `session_id` before unlocking pro features. The current `Checkout.tsx:50` `return_url: window.location.origin + '/dashboard?success=true'` becomes the loopback URL. Single-shot, host-validated, security-headered identically to OAuth.

**Backend touchpoint:** `backend/routes/stripe.js` constructs Checkout Sessions. Verify it accepts `success_url`/`cancel_url` from the request body and isn't defaulting them to a hardcoded value. If it does default, parameterize it for the loopback URL the renderer passes through.

**4d. Supabase Dashboard config.** Whitelist `http://127.0.0.1:*/auth-callback` in Auth → URL Configuration → Redirect URLs (Supabase supports `*` in path segments). Google Cloud Console settings unchanged — Google sees Supabase's `/auth/v1/callback`, not our loopback. Document in `docs/GOOGLE_AUTH_SETUP.md`.

**4e. IPC surface** (kebab-case to match existing convention):
- `start-google-sign-in` → returns `{ access_token, refresh_token, user } | { error: { code, message } }`
- `cancel-google-sign-in` → no return (idempotent)
- `start-stripe-checkout` → params `{ priceId }`, returns `{ status: 'success' | 'cancel', sessionId? } | { error }`
- `cancel-stripe-checkout` → no return (idempotent)

Each new channel must:
1. Register handler in `electron/main.ts` `setupIPC()`
2. Add `contextBridge.exposeInMainWorld` line in `electron/preload.ts`
3. **Add TypeScript declaration to the `Window.electronAPI` interface** (`preload.ts` lines 113-156) — easy to forget, breaks `desktopAPI` typing
4. Wrap in `src/lib/desktop-api.ts`

**4f. Document the deferred custom-protocol path.** `docs/GOOGLE_AUTH_SETUP.md:232` currently says "For production builds, implement deep linking with custom URL scheme (`0studio://`)" — update to say loopback is the chosen path; custom protocol is deferred indefinitely (loopback works in dev and prod identically and avoids Windows registry quirks).

**4g. Smoke test wired into Mac CI.** New `scripts/smoke-oauth.cjs` exercises the loopback server end-to-end against a test Supabase project (no real Google), exits 0/1. Wire into `build-macos` CI as a post-build step. Converts Phase 0a from a one-time vibe check into a repeatable assertion that prevents Mac DMG regressions.

**Acceptance:** Sign in with Google works in dev, packaged macOS, packaged Windows. Stripe Checkout works in all three. No `file://` redirect URLs anywhere. Same code path on Mac and Windows. Smoke test exits 0 on every Mac CI build.

**Phase 4 risk callout.** This is the largest piece of new code. If Phase 0a finds the current Mac flow works (somehow), narrow Phase 4 to Stripe-only and defer Google OAuth rebuild — but Phase 4g smoke test still ships to detect future Mac regressions.

### Phase 5 — Diagnostic logging (R4)

Add `electron-log@5` with file rotation, both-process error catching, privacy redaction with unit-tested regexes, and a "Copy diagnostic report" UI affordance + CLI flag + on-start JSON snapshot for agent/headless access.

**Ordering critical:** `requestSingleInstanceLock()` (Phase 3a) MUST run BEFORE `log.initialize()` so the second instance can't write to the same log file before quitting.

**5a. Install + main-process wiring.**
```ts
// electron/main.ts (top, AFTER single-instance lock)
import log from 'electron-log/main';

log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 20 * 1024 * 1024; // 20 MB — covers multi-hour tester sessions
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : false;
log.errorHandler.startCatching({
  showDialog: false,
  onError({ error, processType }) { log.error(`[uncaught:${processType}]`, error); },
});
// eventLogger is OFF by default. Plan does NOT enable eventLogger.startLogging() — its
// auto-logging of webContents URL navigation would leak OAuth ?code=&state= query params
// into the log even with the redaction hook, since URLs are passed as object props
// not flat strings. If lifecycle events are needed later, add custom log lines manually.
```

`log.initialize()` injects the IPC bridge automatically — no preload changes required.

**5b. Renderer-side wiring.** `src/main.tsx`:
```ts
import log from 'electron-log/renderer';
log.errorHandler.startCatching();
```
Also install the redaction hook on the renderer's `log/renderer` module (same hook factory used in main, so a single `electron/lib/log-redact.ts` exports the function for both sides).

**5c. Render-process-gone + unresponsive.** In `createWindow()`:
```ts
this.mainWindow.webContents.on('render-process-gone', (_, details) => {
  log.error('[render-gone]', details);
  shutdownAllOAuthServers();      // close any open loopback servers
  shutdownAllStripeServers();
});
this.mainWindow.webContents.on('unresponsive', () => log.warn('[unresponsive]'));
this.mainWindow.webContents.on('destroyed', () => {
  shutdownAllOAuthServers();
  shutdownAllStripeServers();
});
```

**5d. Privacy redaction hook (`electron/lib/log-redact.ts`).** Expanded patterns; backed by unit tests in `electron/lib/log-redact.test.ts`:

```ts
// electron/lib/log-redact.ts
export function applyRedactions(s: string): string {
  return s
    // Auth tokens / Bearer headers
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <REDACTED>')
    .replace(/eyJ[A-Za-z0-9._-]{60,}/g, '<JWT_REDACTED>')
    // Supabase keys
    .replace(/sb_(publishable|secret)_[A-Za-z0-9_]+/g, 'sb_$1_<REDACTED>')
    // Stripe restricted/secret keys (publishable pk_* is intentionally NOT redacted)
    .replace(/(sk|rk)_(test|live)_[A-Za-z0-9]+/g, '$1_$2_<REDACTED>')
    // Refresh tokens in JSON bodies
    .replace(/"refresh_token"\s*:\s*"[^"]+"/g, '"refresh_token":"<REDACTED>"')
    // OAuth artifacts in URLs (covers eventLogger leakage if re-enabled later)
    .replace(/[?&](code|code_verifier|state|access_token|refresh_token)=[^&\s]+/gi, (m, k) => `${m[0]}${k}=<REDACTED>`)
    // S3 presigned signatures
    .replace(/X-Amz-Signature=[A-Za-z0-9]+/g, 'X-Amz-Signature=<REDACTED>')
    .replace(/X-Amz-Credential=[^&\s]+/g, 'X-Amz-Credential=<REDACTED>')
    // Email PII (matters when combined with file paths showing user identity)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<EMAIL_REDACTED>')
    // Home directory username segment (cross-platform)
    .replace(/(\/Users\/|\/home\/|C:\\Users\\)([^\/\\]+)/g, '$1<USER>');
}

export function redactValue(v: unknown): unknown {
  if (typeof v === 'string') return applyRedactions(v);
  if (v instanceof Error) {
    return Object.assign(new Error(applyRedactions(v.message)), { stack: v.stack ? applyRedactions(v.stack) : undefined });
  }
  if (v && typeof v === 'object') {
    try { return JSON.parse(applyRedactions(JSON.stringify(v))); }
    catch { return v; }
  }
  return v;
}

export function installRedactionHook(log: { hooks: Array<(m: any) => any> }) {
  log.hooks.push((message) => {
    message.data = message.data.map(redactValue);
    return message;
  });
}
```

Unit tests assert each pattern scrubs:
- `log.error('failed', { url: 'https://x.s3.amazonaws.com/?X-Amz-Signature=abc' })` → no `abc` in output
- `log.error('jwt', 'eyJhbGciOiJIUzI1NiI...')` → `<JWT_REDACTED>`
- `log.info({ refresh_token: 'rt_xxx' })` → recursive object redaction works
- `log.error(new Error('Bearer secrettoken'))` → Error message scrubbed, stack preserved-but-scrubbed

**5e. "Copy diagnostic report" + agent-native CLI flag + on-start snapshot.**

IPC handler (registered in `setupIPC()`, exposed in `preload.ts`, wrapped in `desktop-api.ts`):
```ts
// electron/main.ts
ipcMain.handle('get-diagnostic-report', async () => {
  const logPath = log.transports.file.getFile().path;
  const tail = await readTailAsync(logPath, 64 * 1024);
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    locale: app.getLocale(),
    gpu: await app.getGPUInfo('basic'),
    logTail: tail,
    timestamp: new Date().toISOString(),
  };
});

async function readTailAsync(p: string, bytes: number): Promise<string> {
  const handle = await fs.promises.open(p, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));
    return applyRedactions(buffer.toString('utf8'));
  } finally { await handle.close(); }
}
```

`Help → Copy Diagnostic Report` menu item opens a modal with two views: pretty-printed text (for Slack paste) and raw JSON (for agent / `jq` parsing). Two buttons: "Copy as text", "Copy as JSON".

**Agent-native additions:**
- **CLI flag:** in `electron/main.ts` argv handling, if `process.argv.includes('--diag-report')`, generate the report synchronously and `process.stdout.write(JSON.stringify(report)); app.exit(0);` before any window creation. Lets `0studio.exe --diag-report > report.json` be invoked headlessly (e.g., from a support script, future agent, GitHub-attached-log capture).
- **On-start snapshot:** every app start writes the report (without `logTail` to keep it small) to `%APPDATA%\0studio\logs\diag-report.json` (overwrite). Lets a tester or agent grab system info even if the app crashed during launch.

**5f. Convert existing `console.error` to `log.error`** in:
- `electron/main.ts:394, 441, 490`
- New IPC error sites in Phase 4
- File-watcher error callback (Phase 2c)

Add a CI lint step `grep -rn 'console\.\(error\|warn\)' electron/ src/ | grep -v '\.test\.' && exit 1 || true` to prevent regression. Allowlist `console.log` for now (used in dev).

**Acceptance:** On Windows, `%APPDATA%\0studio\logs\main.log` exists and contains app start, every IPC error, every cloud sync error. Log file rotates at 20MB. `0studio.exe --diag-report` writes JSON to stdout and exits. `Help → Copy Diagnostic Report` opens modal with text + JSON copy buttons. `%APPDATA%\0studio\logs\diag-report.json` exists after first launch. Unit tests pass: nine redaction patterns each have a scrub assertion. CI lint blocks new `console.error`.

### Phase 6 — Tester checklist + handoff artifacts (R5, R6)

**6a. Write `docs/windows-tester-checklist.md`.** A flat numbered list of 30-50 items, each with a clear pass/fail criterion. Sections:

1. **Pre-install (3 items):** Windows 11 build version (`winver`), SAC status, antivirus product name.
2. **Install (5 items):** SmartScreen click-path completes, NSIS dialog appears with directory choice, install completes without error, desktop shortcut appears, Start Menu entry appears.
3. **First launch (4 items):** App opens to welcome panel within 5 seconds, no console errors visible, traffic-light buttons absent (Windows native title bar present), window resizes correctly.
4. **Local VCS — open / commit / branch / history (8 items):** Open .3dm via File menu, open via double-click on Explorer (cold), open via double-click while running (warm), commit, create branch, switch branch, view history, delete branch.
5. **File watcher (3 items):** External save by Rhino fires a "model updated" UI event, watcher survives 10 consecutive Rhino saves, no EBUSY error toasts.
6. **Cloud sync (5 items):** Sign in with Google (loopback flow), push current commit, pull from another machine, view Gallery for cloud-synced project, sign out clears session.
7. **Subscription (4 items):** Open Stripe Checkout via Upgrade button (test mode), complete checkout (test card), verify plan upgrade in app, billing portal opens.
8. **File formats (3 items):** Open .3dm, .rvt, .ifc — each loads without error, glTF derivative generation works for each.
9. **Team presence (3 items):** Open same project in two Mac/Win combos, see teammate avatar on commit node, see typing indicator.
10. **Uninstall (3 items):** Uninstall via Add/Remove Programs, app-data persists if "delete user data" not checked, registry HKCU\Software\Classes\.3dm removed.

Each item in the format:
```
[ ] 6.2  Sign in with Google
       Steps: Click "Sign in with Google" → system browser opens → complete sign-in
       Pass: returns to app within 30s, avatar visible top-right
       Fail: app stays on sign-in screen, OR error toast, OR system browser shows error
```

**6b. Pre-fill checklist with build version.** A small Node script `scripts/generate-tester-checklist.cjs` reads `package.json` `version` and current git SHA, fills the version line, and writes `docs/handoffs/2026-MM-DD-windows-tester-round-N.md`.

**6c. Tester instructions page.** `docs/windows-tester-instructions.md`:
- Where to download the .exe (GitHub Actions artifact URL or Slack-shared link)
- SmartScreen bypass: "More info" → "Run anyway" with screenshots from Windows 11 24H2
- SAC blocker: "If you see no 'Run anyway' button, your machine has Smart App Control on. Settings → Privacy → Windows Security → App & browser control → Smart App Control → turn off." (Document the warning that this is a one-way operation requiring Windows reset to re-enable.)
- Where the diagnostic log lives (`%APPDATA%\0studio\logs\`)
- How to use Help → Copy Diagnostic Report
- How to file an issue (template link)

**6d. Artifact handoff automation.** Add to `release.yml` `build-windows` job a final step that posts the artifact URL + SHA to a Slack webhook (or a comment on the relevant PR). Tester gets a one-line message with link + SHA, no manual hunting.

**Acceptance:** Checklist exists, instructions exist, tester receives all three (link, instructions, checklist) before each round. Each checklist item has a binary pass/fail criterion that doesn't require the tester to make judgment calls.

### Phase 7 — Known-issues tracker + iteration loop (R7)

**7a. Decision: GitHub label `platform:windows`.** Reasons over a living doc: (a) issues are already where the team works, (b) labels show up in GitHub search and PR filters, (c) closing an issue is the natural "resolved" signal.

**7b. Living doc as rollup, not source.** `docs/windows-known-issues.md` is a one-page rollup auto-generated (or manually copy-pasted) from the `platform:windows` label, structured by severity and tester-round. Used for retrospectives — not for issue tracking.

**7c. Per-round retrospective.** After each tester session, a 30-minute retro produces:
- Issues filed (count + list)
- Issues closed (count + list)
- "What did the audit miss?" — feeds back into Phase 2's lessons
- "What would have caught this?" — drives test additions or lint rules

**7d. Closeout criterion.** R7 closes when every R2 parity item passes on Windows 11 x64 — i.e. all checklist items pass and `platform:windows` has zero open issues.

**Acceptance:** Label exists, rollup doc exists, retrospective is part of the tester-round workflow.

## Technical Approach — Architecture details

### OAuth loopback flow — sequence

```
Renderer → IPC: auth:google-sign-in
Main:
  1. Generate verifier + challenge + state (PKCE)
  2. Spin http.createServer on 127.0.0.1, port 0
  3. Build Supabase auth URL with redirectTo=http://127.0.0.1:<port>/auth-callback
  4. shell.openExternal(supabaseAuthUrl)
  5. User completes Google sign-in in system browser
  6. Google → Supabase /auth/v1/callback → 302 → http://127.0.0.1:<port>/auth-callback?code=...&state=...
  7. Loopback server validates state, captures code, returns success HTML
  8. Server closes
Main → Renderer: { code, verifier }
Renderer:
  9. Override Supabase client's stored verifier with ours
  10. supabase.auth.exchangeCodeForSession(code)
  11. supabase.auth.onAuthStateChange fires → app updates
```

### Diagnostic log layout

```
%APPDATA%\0studio\logs\
├── main.log            (current, max 10MB, info level+)
└── main.old.log        (one rotation kept by default; can extend with archiveLogFn)
```

### IPC channels added in this plan

All kebab-case, no namespace prefix — matches existing channel convention in `electron/preload.ts` (`open-project-dialog`, `save-commit-file`, etc.).

| Channel | Direction | Payload |
|---|---|---|
| `start-google-sign-in` | renderer→main (request/response) | returns `{ access_token, refresh_token, user } \| { error: { code, message } }` |
| `cancel-google-sign-in` | renderer→main | no return (idempotent) |
| `start-stripe-checkout` | renderer→main | params `{ priceId }`, returns `{ status, sessionId? } \| { error }` |
| `cancel-stripe-checkout` | renderer→main | no return (idempotent) |
| `get-diagnostic-report` | renderer→main | returns `{ appVersion, electron, chrome, node, platform, locale, gpu, logTail, timestamp }` |
| `change-pending` | main→renderer (push) | param `{ path }` — chokidar raw `change` before stability resolves |
| `project-opened` | main→renderer (push) | param `{ path }` — existing channel, queued via `safeSend` if window not ready |
| `log:*` | both, via electron-log internal | electron-log handles via `log.initialize()` bridge |

### File / module layout (post-Enhancement)

```
electron/
├── main.ts                     (touched: §1f, §2c, §2e, §3a, §3c, §5a, §5c, §5f)
├── preload.ts                  (touched: §4e — add channels + Window.electronAPI types)
├── lib/                        (NEW directory; pure-helper convention, no state)
│   ├── project-file.ts         (new — extracted SUPPORTED_PROJECT_EXTS + isSupportedProjectFile, breaks circular import)
│   ├── argv-util.ts            (new — extractProjectPath with realpath/length/system-dir guards)
│   ├── log-redact.ts           (new — applyRedactions / redactValue / installRedactionHook)
│   └── log-redact.test.ts      (new — 9 redaction-pattern unit tests)
├── services/
│   ├── file-watcher.ts         (touched: §2c — adaptive threshold + change-pending IPC)
│   ├── oauth-service.ts        (new: §4b — main-side PKCE exchange + loopback hardening)
│   ├── stripe-service.ts       (new: §4c — loopback with state CSRF + backend verify gate)
│   ├── git-service.ts          (DELETE: §2b)
│   └── project-service.ts      (DELETE: §2b)
backend/
└── routes/stripe.js            (touched: §4c — accept success_url from request body)
src/
├── lib/
│   ├── supabase.ts             (touched: §4a — flowType: 'pkce', detectSessionInUrl: false)
│   ├── desktop-api.ts          (touched: §4e — wrappers for new IPC channels)
│   └── env-validation.ts       (new: §1c — runtime guard for empty-string CI case)
├── contexts/
│   ├── AuthContext.tsx         (touched: §4 — signInWithGoogle calls desktopAPI.startGoogleSignIn → setSession)
│   └── VersionControlContext.tsx (touched: §2a — split on /[\\/]/ regex)
├── pages/
│   └── Checkout.tsx            (touched: §4c — return_url uses loopback)
├── main.tsx                    (touched: §1c, §5b)
└── components/
    └── DiagnosticsModal.tsx    (new: §5e — text + JSON copy)
scripts/
├── copy-resources.cjs          (new: §1a — replaces mkdir -p / cp)
├── verify-windows-artifact.cjs (new: §0b/§1 — CI gate asserting WASM blobs in asar)
├── smoke-oauth.cjs             (new: §4g — Mac CI regression test)
└── windows-smoke.ps1           (new: §6a — auto-runs ~10-12 mechanical checklist items)
docs/
├── WINDOWS_TESTER_CHECKLIST.md   (new: §6a — ALL_CAPS to match BUILD_GUIDE.md / STRIPE_SETUP.md)
├── WINDOWS_TESTER_INSTRUCTIONS.md (new: §6c)
├── WINDOWS_KNOWN_ISSUES.md       (new: §7b — or saved GH search URL alternative)
├── GOOGLE_AUTH_SETUP.md          (touched: §4f)
└── handoffs/2026-MM-DD-windows-tester-round-N.md (per-round, new: §6b)
.github/workflows/
└── release.yml                 (touched: §1b, §1d, §1e, §6d, §0b artifact verify, §4g smoke step)
package.json                   (touched: §1a, §1b, §2b, §1c plugin, NSIS perMachine outcome from §3d)
env.ts                          (new: §1c)
```

The `electron/lib/` subdirectory is a **new convention** introduced by this plan: pure-utility, no-state, no-lifecycle helpers. Stateful long-lived services remain in `electron/services/`. Add a one-line note to CLAUDE.md after Phase 5.

## Alternative Approaches Considered

**Custom protocol handler (`0studio://callback`) instead of loopback.** Rejected. Per Bloomca 2025 + RFC 8252 + verified Windows-only protocol-handler quirks (only persists when installed via NSIS, fragile across upgrades, requires single-instance lock, not testable in dev mode). Loopback works identically dev and prod and is what Slack/Linear/Notion use for desktop OAuth. The brainstorm flagged this question; the answer is loopback.

**Continue with `redirectTo: window.location.origin` and hope it works.** Rejected. The audit confirms `window.location.origin` is `file://` in packaged Electron. Even if it works on Mac DMG today (Phase 0 verifies), it relies on undocumented Supabase behavior and is fragile. Doing the loopback rebuild once cross-platform is cheaper than maintaining two flows.

**winston / pino instead of electron-log.** Rejected. Both are server-logger ergonomics (transports, formats, child loggers) that don't pay rent in a desktop app. electron-log v5 with `log.initialize()` does exactly what R4 needs in <20 lines of setup. No lock-in — the IPC bridge is internal to electron-log; switching later is a 1-day job if needed.

**`shx`/`cpx`/`mkdirp`/`ncp` for cross-platform scripts.** Rejected. Node 16+ has `fs.cp`, `fs.mkdir({recursive})`, `fs.rm({recursive,force})`. Built-ins make helper libs obsolete and avoid supply-chain risk.

**`oneClick: true` for one-step install.** Rejected. Auto-installs to `%LOCALAPPDATA%\Programs\<app>` with no prompt — surprises testers and makes uninstall hard to find. `oneClick: false` (current config) is correct for tester scenarios.

**Defer R4 (logging) until first tester round produces a bug we can't diagnose.** Rejected. The brainstorm's success metric is **3 or fewer round-trips**. Without logs, the round-trip cost is "find the tester, ask them to repro, hope they remember the error message." Logs make the first round-trip productive and are reusable for packaged Mac debugging (currently equally invisible).

**Cross-compile Windows from macOS via Wine.** Rejected. electron-builder supports it, but the GitHub `windows-latest` runner is simpler, enables future code signing, and produces an artifact closer to what testers run.

## System-Wide Impact

### Interaction Graph

OAuth flow touches: `AuthContext.tsx` → `desktop-api.ts` → `preload.ts` → `main.ts` IPC → `oauth-service.ts` → loopback HTTP → system browser → Supabase → loopback callback → exchangeCodeForSession (renderer) → `supabase.auth.onAuthStateChange` → all `AuthContext` consumers (`PresenceContext`, `CloudSyncContext`, `ModelContext`, etc.).

File-association flow touches: NSIS installer registers HKCU file-type → user double-clicks .3dm → Windows launches `0studio.exe <path>` → `requestSingleInstanceLock` → either second-instance argv OR cold-launch argv → `openProject` → `FileWatcherService` starts → `FileStorageService` reads tree.json → `VersionControlContext` initializes.

Diagnostic logging touches: every `console.error` site, every IPC error path, every cloud sync error, every uncaught renderer exception, every `render-process-gone` event. The redaction hook applies to all of them — verify in tests that JWTs in URLs are scrubbed.

### Error & Failure Propagation

- OAuth timeout (5min): `oauth-service.ts` rejects → IPC error → renderer toasts "Sign-in timed out, try again". Loopback server already closed.
- OAuth state mismatch: server returns 400 to browser, rejects promise. Indicates CSRF attempt or browser back-button replay; surface as "Sign-in failed for security reasons, try again."
- EBUSY on .3dm read: Phase 2e retry-with-backoff. After 4 attempts, surface as "Could not read project file (in use by Rhino)." Logged at ERROR.
- VITE_ var missing at runtime (Phase 1c): startup-error component renders instead of `<App />`. Logged at FATAL. App does not silently fail.
- chokidar EBUSY/EPERM: swallowed at debug level. No user-visible error.
- `render-process-gone`: logged with full `RenderProcessGoneDetails`. No automatic restart for now (manual reopen). Future: prompt "App crashed, click to reload."

### State Lifecycle Risks

- Loopback server lifetime: created on `auth:google-sign-in` IPC, closed on success/failure/timeout. **Risk:** main process crashes mid-flow → orphan `127.0.0.1:<port>` listener. Mitigation: register `app.on('will-quit')` cleanup that closes any open OAuth/Stripe servers.
- Single-instance lock release: Electron handles automatically on quit. **Risk:** if `requestSingleInstanceLock()` returns false, we `app.quit()` immediately — verify the second instance's argv has been forwarded BEFORE the first instance's `second-instance` handler runs. Electron docs guarantee this ordering.
- Pending `pendingFileToOpen` (cold launch): held in closure until `app.whenReady()`. **Risk:** if app fails to ready (rare), file is dropped. Acceptable.
- Diagnostic log file rotation: electron-log handles atomically. No risk of partial writes.

### API Surface Parity

- Mac DMG and Windows .exe must use the same OAuth flow (Phase 4), same file-association IPC (Phase 3a), same diagnostic logging (Phase 5). No platform branching in renderer code.
- Backend API (`localhost:3000`) is unchanged. Stripe webhook handling unchanged. Supabase Realtime unchanged.

### Integration Test Scenarios

Five scenarios that unit tests with mocks won't catch:

1. **OAuth round-trip on packaged Windows:** Install .exe in VM, sign in with Google, verify session reaches renderer, verify subsequent backend calls include valid Bearer token.
2. **Double-click .3dm while running:** Open app, double-click a different .3dm in Explorer, verify same window switches to the new file (no second instance window).
3. **Atomic-rename save on Windows from Rhino:** Open a 100MB .3dm, save in Rhino, verify watcher fires `change` after stability threshold, no EBUSY error toast.
4. **Stripe Checkout return:** Click Upgrade, complete test-card checkout in system browser, verify return URL hits loopback, verify backend session retrieve confirms upgrade, verify in-app plan reflects upgrade.
5. **VITE_ env var missing:** CI builds with `VITE_BACKEND_URL=""`, app starts, verify startup error component renders and `Missing env vars at startup` is in `main.log` at FATAL.

## Acceptance Criteria

### Functional

- [ ] **R1.** `npm run electron:dist` on macOS produces `release/*.dmg`. `gh workflow run release.yml --ref <branch>` produces `release/*.exe` artifact. Tester installs the .exe on Windows 11 x64 and confirms launch + welcome-screen render.
- [ ] **R2.** Every checklist item from `docs/windows-tester-checklist.md` passes on Windows 11 x64: open .3dm/.rvt/.ifc, commit, branch, switch branch, history, file watcher reacts to Rhino save, sign-in with Google, push to cloud, pull from cloud, Gallery, team presence, Stripe Checkout test card, glTF derivative conversion, double-click cold + warm, uninstall.
- [ ] **R3.** Every audit finding from §2 (Phase 2) is fixed and committed. Repo grep confirms no `path.split('/')`, no dead `simple-git`, no `console.error` (replaced by `log.error`), no Unix-only shell built-ins in `package.json` scripts.
- [ ] **R4.** `%APPDATA%\0studio\logs\main.log` exists and contains app-start, every IPC error, cloud-sync error, file-op error. Log rotates at 10MB. Help → Copy Diagnostic Report works. No JWTs/Bearer tokens/X-Amz-Signatures in any log.
- [ ] **R5.** `docs/windows-tester-checklist.md` covers all R2 items. Each item has binary pass/fail criteria. Tester does not need to make judgment calls.
- [ ] **R6.** Each tester round produces (a) GitHub Actions artifact URL, (b) pre-filled checklist with build version + SHA, (c) tester instructions including SmartScreen + SAC bypass.
- [ ] **R7.** GitHub label `platform:windows` exists. `docs/windows-known-issues.md` is updated after each round. Closes when zero open `platform:windows` issues.

### Non-Functional

- [ ] App startup time on Windows ≤ 5s (matching Mac DMG performance budget).
- [ ] Log file footprint ≤ 20MB (10MB current + 10MB rotated archive).
- [ ] No new dependencies beyond `electron-log@5`, `@julr/vite-plugin-validate-env`. No native modules added.
- [ ] No memory leaks in OAuth/Stripe loopback servers (verified by repeated sign-in cycles).

### Quality Gates

- [ ] All Phase 2 fixes covered by manual verification on Windows 11 VM.
- [ ] Phase 4 OAuth tested end-to-end on Mac, Windows, and dev mode before tester handoff.
- [ ] Phase 4 backend `routes/stripe.js` audit completed; verifies `success_url` is parameterized.
- [ ] Phase 4g `scripts/smoke-oauth.cjs` runs in `build-macos` CI and exits 0 on every build.
- [ ] Phase 5 redaction verified by `electron/lib/log-redact.test.ts` covering all 9 patterns (Bearer, JWT, sb_*, sk_*/rk_*, refresh_token, OAuth artifacts, X-Amz-*, email, home-dir username).
- [ ] All `import.meta.env.VITE_*` references in `src/` listed in `env.ts` schema (CI fails build if not).
- [ ] CI grep guard rejects any `console.error`/`console.warn` reintroduction in `electron/` and `src/`.
- [ ] CI grep guard rejects any `VITE_*_SECRET_*` / `VITE_*_PRIVATE_*` patterns from being added.
- [ ] `WINDOWS_TESTER_CHECKLIST.md` reviewed by one non-developer before first tester round.

### Phase consolidation (PR shape)

The 7 logical phases collapse into ~3 PRs for shipping:
- **PR 1: Windows build correctness pass.** Phases 1 + 2 — CI scripts, env validation, audit fixes, simple-git removal. Lands first; tester preview .exe is producible after this.
- **PR 2: Main-process behavior + diagnostic logging.** Phases 3 + 5 — single-instance lock, message queue, electron-log + redaction + agent-native diag report. Lands second; tester rounds can run after this.
- **PR 3: OAuth + Stripe loopback rebuild.** Phase 4. Lands separately because it's the largest piece and benefits from independent review/rollback. Contingent on Phase 0a verification.
- **Continuous: Phase 6 + 7.** Tester docs, checklist, GH label workflow — produced incrementally, not gated to a single PR.

Phase 0 stays as a one-shot preflight that produces `docs/handoffs/2026-MM-DD-windows-tester-round-1.md` with the three ground-truth findings before PR 1 starts.

## Success Metrics

- **Round-trip count to "all pass": 3 or fewer.** Per origin success criterion. If >3, the audit was under-scoped and we owe a retro.
- **Time from "tester reports bug" → "fix on tester's machine": < 24 hours.** Diagnostic log + GH Actions per-branch builds make this achievable.
- **Bug-class diversity:** Round 1 should expose mostly install/UX-on-first-run issues. Round 2 should be feature-specific bugs. Round 3 should find ≤2 issues. If Round 2 still has install issues, the static audit failed and we need a retrospective before continuing.
- **Mac DMG regression count: 0.** Cross-platform fixes (especially Phase 4) must not break the Mac flow. CI must run a Mac smoke test before each Windows artifact ships.

## Dependencies & Prerequisites

- Tester identity (Win 11 x64, ~3 sessions of ~1h each). **Unresolved but not blocking** per origin — planning starts now, tester sourcing parallel.
- Phase 0 verification of Mac DMG OAuth flow. **Blocks Phase 4 scoping.**
- Phase 0 verification of CI Windows job baseline. **Blocks Phase 1 PR.**
- Phase 0 verification of tester's SAC status. **Blocks Phase 6 handoff.**
- Repo secrets: `VITE_STRIPE_PRO_PRICE_ID`, `VITE_STRIPE_ENTERPRISE_PRICE_ID` need to be added to GitHub Actions secrets before Phase 1 ships.
- Supabase Dashboard write access to whitelist `http://127.0.0.1:*/auth-callback` redirect URL (Phase 4d).
- A Windows 11 24H2 VM (or physical machine) for developer-side smoke testing before tester handoff.

## Risk Analysis & Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| **OAuth/Stripe loopback rebuild breaks Mac DMG mid-flight** | High | Phase 0a verifies current Mac behavior. Phase 4g adds `scripts/smoke-oauth.cjs` to Mac CI as a permanent regression gate. |
| **Diagnostic log accidentally captures secrets** (Bearer/JWT/sk_*/sb_secret_*/refresh_token/email/path-with-username) | High (privacy) | Phase 5d expanded redaction (9 patterns) backed by `electron/lib/log-redact.test.ts` unit tests. CI fails on missing test coverage. |
| **`shell.openExternal` invoked with renderer-supplied URL** | High | Phase 4b builds Supabase URL entirely in main from env constants; validates `protocol === 'https:'` and hostname against `ALLOWED_AUTH_HOSTS` before launch. |
| **Loopback port-squat / state-replay** (CSRF on `127.0.0.1:<port>`) | High | Phase 4b: 16-byte state, single-shot enforcement (any second request → 410), Host header validation, `closeAllConnections()` on success/error/timeout, 3-min cap. |
| **Backend `routes/stripe.js` hardcodes `success_url`** (would silently keep `file://` redirect) | High | Phase 4c gate: verify backend accepts `success_url` from request body; if not, parameterize before Phase 4 ships. |
| **Windows Defender ML heuristic flags unsigned .exe** (~5-15% machines) | Medium | Submit each new build to https://www.microsoft.com/wdsi/filesubmission 24-72h before tester handoff. Documented in Phase 6c instructions. |
| Smart App Control on a tester machine without KB5083769 | Medium | Phase 0c.i requires OS Build ≥ 26100.8116 (April 2026). On older builds, SAC turn-off is one-way. Defer that tester or wait for them to install Windows Update. |
| Corporate WDAC/AppLocker policies (managed enterprise testers) | Medium | Phase 0c.ii enterprise-managed check. If present, no override possible; defer that tester until Microsoft Artifact Signing is in place. |
| `nsis.perMachine: false` breaks file associations (researcher conflict) | Medium | Phase 3d empirical test. If broken, switch to `perMachine: true` for tester build only. UAC at install acceptable for tester scenario. |
| Adaptive `awaitWriteFinish` threshold escalation introduces flaky save detection | Medium | Phase 2c starts at 500 ms; first EBUSY in session escalates to 1500 ms. Static 1500 ms is acceptable Phase-1 fallback if adaptive logic regresses. |
| Concurrent saves during EBUSY retry produce stale data flash | Medium | Phase 2e per-path state machine (`IDLE → READING → READING_STALE → IDLE`). Stale results are dropped, never dispatched to renderer. |
| `productName` / `name` mismatch causes log path inconsistency on Windows | Medium | Phase 2f empirical verification on first Windows build; set both to `"0studio"` if needed. |
| VITE_ secret accidentally embedded as empty string in CI | Medium | Phase 1c `vite-plugin-validate-env` Zod schema (build-time) + runtime startup guard (catches empty-string CI case). CI also greps for `VITE_*_SECRET_*` patterns to deny-list. |
| Single-instance lock collision with mid-OAuth flow | Medium | Phase 4 tracks all open loopback servers in `Set<http.Server>`; `before-quit` + `render-process-gone` + `webContents:destroyed` all close them. |

## Resource Requirements

- One developer for ~2 weeks across 7 phases (Phase 4 is the largest, ~3-4 days; Phases 0-2 + 5 each ~1-2 days; Phases 6-7 ~1 day each).
- One Windows 11 24H2 x64 VM (Parallels or UTM on Mac, or a friend's machine).
- One non-developer Windows tester for ~3 sessions of ~1 hour each.
- GitHub Actions minutes (negligible — `windows-latest` is in the standard runner pool).
- No new SaaS subscriptions. No code-signing cert required for this effort.

## Future Considerations

- **Code signing — Microsoft Azure Artifact Signing is the recommended path** (formerly "Trusted Signing"; rebranded and went GA in Q1 2026). $9.99/month for up to 5,000 signatures, 1 cert profile. Issues a cert in Microsoft's Trusted Root Program — satisfies SAC immediately, no reputation-building period, no hardware token. Eligibility expanded at GA: individuals (self-employed) accepted in US/CA/EU/UK with government photo ID. This is the highest-leverage signing path as of April 2026 and the recommended fallback if Phase 0c reveals testers under WDAC/AppLocker policies that block unsigned binaries outright. Traditional OV (~$129-226/yr) requires weeks of reputation-building and EV (~$249+/yr + FIPS hardware token) is overkill for current scale. (Sources: [Azure Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/), [InfoWorld](https://www.infoworld.com/article/2337355/understanding-microsofts-trusted-signing-service.html).)
- **Auto-update.** electron-builder NSIS supports `latest.yml` + GH Releases auto-update once code signing is in place. Defer to public-release effort.
- **Windows on ARM.** `windows-latest` runner is x64; ARM64 cross-compile of native modules is risky. Defer until there's user demand.
- **Linux.** Once Windows + Mac are clean, Linux .AppImage / .deb is a cheap follow-on. Out of scope for this plan.
- **Windows Mica title-bar / Window Controls Overlay.** Polish, not parity. Defer indefinitely.
- **Diagnostic upload.** Phase 5 produces a copy-pasteable text report. Future: a "Send report" button that POSTs to a backend endpoint. Privacy review required first.
- **`docs/solutions/`.** This effort produces a strong audit asset. Recommend creating `docs/solutions/` and seeding it with: cross-platform path normalization, OAuth loopback pattern, electron-log redaction pattern, chokidar Windows tuning. Turns this into the "compounding asset" the brainstorm promised.

## Documentation Plan

- `docs/windows-tester-checklist.md` — new, Phase 6a
- `docs/windows-tester-instructions.md` — new, Phase 6c
- `docs/windows-known-issues.md` — new, Phase 7b
- `docs/handoffs/<date>-windows-tester-round-<n>.md` — new, per round, Phase 6b
- `docs/GOOGLE_AUTH_SETUP.md` — updated, Phase 4f (loopback flow, deferred custom protocol)
- `docs/BUILD_GUIDE.md` — updated, document Windows build path + cross-platform script convention
- `CLAUDE.md` — minor update noting `electron-log` is the project logger
- `README.md` — Windows install instructions

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-23-windows-build-hardening-requirements.md](../brainstorms/2026-04-23-windows-build-hardening-requirements.md). Key decisions carried forward:
  1. Full feature parity, not core-only
  2. Audit + instrument before first tester session (Approach C)
  3. Unsigned .exe is fine for tester
  4. Static audit is the compounding asset
  5. Target: 3-or-fewer tester round-trips
  6. Explicit non-goals: code signing, auto-update, Windows on ARM, Linux, Win-specific UX redesign

### Internal References

- Prior packaging plan: `docs/plans/2026-04-05-001-feat-package-dmg-and-exe-plan.md` (status: completed) — established NSIS scaffolding, `icon.ico`, cross-platform `build:electron`
- Chokidar migration: `docs/plans/2026-04-05-002-fix-file-watcher-chokidar-migration-plan.md`
- rhino3dm WASM bundling: `docs/plans/2026-04-05-001-feat-bundle-rhino3dm-wasm-locally-plan.md`
- Build guide: `docs/BUILD_GUIDE.md`
- OAuth setup (currently inaccurate for packaged builds): `docs/GOOGLE_AUTH_SETUP.md`
- Code signing context: `docs/CODE_SIGNING_GUIDE.md` (macOS-only currently)
- Main process: `electron/main.ts:51-56` (Squirrel block, dead), `electron/main.ts:81-86` (open-file handler), `electron/main.ts:101-108` (argv parsing, replace), `electron/main.ts:454-456` (sidecar comparison)
- File watcher: `electron/services/file-watcher.ts:34-46`
- Path bug: `src/contexts/VersionControlContext.tsx:352`
- OAuth call site: `src/contexts/AuthContext.tsx:178-203`
- Stripe redirect: `src/pages/Checkout.tsx:50`
- Cloud sync (S3 keys correctly use `/`): `src/lib/cloud-sync-service.ts:301,316,327,336`
- CI workflow: `.github/workflows/release.yml:48-79`

### External References

- [electron-builder NSIS configuration](https://www.electron.build/nsis.html)
- [electron-builder fileAssociations](https://www.electron.build/electron-builder.interface.fileassociation)
- [Electron `requestSingleInstanceLock` + `second-instance`](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)
- [Electron `protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron `webContents.on('render-process-gone')`](https://www.electronjs.org/docs/latest/api/web-contents)
- [Vite Env Variables and Modes](https://vite.dev/guide/env-and-mode)
- [chokidar v4 README](https://github.com/paulmillr/chokidar)
- [electron-log v5 docs](https://github.com/megahertz/electron-log)
- [electron-log catch.md](https://github.com/megahertz/electron-log/blob/master/docs/catch.md)
- [electron-log v4→v5 migration](https://github.com/megahertz/electron-log/blob/master/docs/migration.md)
- [Supabase `signInWithOAuth`](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)
- [Supabase `exchangeCodeForSession`](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession)
- [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Stripe Checkout custom redirect](https://docs.stripe.com/payments/checkout/custom-success-page)
- [Microsoft Defender SmartScreen](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/)
- [vite-plugin-validate-env](https://github.com/Julien-R44/vite-plugin-validate-env)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [Bloomca — Electron custom protocols pitfalls](https://blog.bloomca.me/2025/07/20/electron-apps-custom-protocols.html)
- [2ality — Cross-platform npm scripts](https://2ality.com/2022/08/npm-package-scripts.html)

### Related Work

- April 5 packaging PR: #14 (commit `ebfc161`)
- Recent dual-artifact + multi-format work on current branch `feat/dual-artifact-phase-3-formats`: commits `d2a826b`, `061b235`, `d5150d8`
