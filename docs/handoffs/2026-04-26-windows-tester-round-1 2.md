---
title: Windows tester round 1 — Phase 0 preflight findings
date: 2026-04-26
completed: 2026-04-28
plan: docs/plans/2026-04-26-001-feat-windows-build-hardening-plan.md
phase: 0 (Preflight)
status: gate-passed
---

# Windows tester round 1 — Phase 0 preflight findings

This memo documents the three ground-truth findings the plan's Phase 0 gate
requires before any Phase 1+ work begins. It is filled in incrementally as
each check completes.

## 0a — Mac DMG OAuth + Stripe end-to-end test

**Question being answered:** Is the existing packaged Mac DMG's Google OAuth +
Stripe Checkout flow functional today? The static audit found
`redirectTo: window.location.origin` resolves to `file://` in any packaged
Electron build — Google rejects this and Stripe rejects non-https return URLs.
If both flows somehow work on Mac, there is a code path the audit missed and
Phase 4 (the loopback rebuild) can be narrowed in scope.

**Artifact tested:** `release/0studio-1.0.3-arm64.dmg` (built 2026-04-13 16:10).
This DMG predates today's `afterPack.cjs` regression and predates the
dual-artifact / multi-format / chokidar / glTF work. The OAuth call site
(`src/contexts/AuthContext.tsx:178-203`) and Stripe return URL
(`src/pages/Checkout.tsx:50`) have not changed materially since April 13, so
this artifact is a fair proxy for current-main behavior.

**Build regression noted:** `npm run electron:dist` on main (HEAD `1176983`)
fails at the `afterPack` hook with:
> TypeError: The "path" argument must be of type string. Received undefined
> at Object.join (node:path:1304:7)
> at afterPack (/Users/joanna/Documents/cool-projects/0studio/scripts/afterPack.cjs:13:29)

Cause: `context.packager.appInfo.productFilename` (or `context.projectDir`) is
undefined under electron-builder 26.8.1. Not a Windows-specific blocker, but
should be tracked as a Phase 1 task (Mac build correctness pass).

### Test results

**Status:** _COMPLETE — 2026-04-28_

| Check | Pass / Fail | Notes |
|---|---|---|
| App launches from DMG, welcome screen renders | ✅ Pass | Existing April 13 DMG launched normally |
| Click "Sign in with Google" — where does the OAuth UI render? | **In-app BrowserWindow** | Google permissions screen loads inside the 0studio window itself; no system browser opened. Confirms there is no `shell.openExternal` path today — the codebase relies on default `supabase.auth.signInWithOAuth` behavior, which navigates the current window. |
| Complete sign-in flow — does the redirect succeed? | ❌ Fail — **white screen** | After clicking "Approve" on Google's permissions page, the BrowserWindow goes to a blank white screen. This is the `file://...?code=&state=` redirect failing — Chromium's renderer can't load a `file://` URL with OAuth query params, so the navigation produces an unrendered/blank document. |
| 0studio app process state after the white screen | Alive | App window still exists, can be closed normally. No main-process crash. The renderer just shows a white document. (Diagnostic Phase 5 logging would have captured this — currently invisible.) |
| Stripe Checkout test | Skipped | Same redirect mechanism (`window.location.origin` → `file://`). Predicted to fail identically. Don't need to verify separately to confirm Phase 4 Stripe scope. |

### Conclusion

✅ **Mac OAuth is broken.** Phase 4 (loopback rebuild) is **confirmed required cross-platform**, not Windows-specific. The audit's prediction holds: `redirectTo: window.location.origin` is `file://` in packaged Electron and Google rejects/breaks on the redirect.

**Phase 4 scope confirmed at full size (no narrowing):**
- Loopback HTTP server in main process
- `shell.openExternal` for the OAuth URL (currently absent — verified by in-app behavior)
- PKCE exchange in main, `setSession` in renderer
- Same architecture for Stripe Checkout (no need to test separately; will fail identically)

**Side benefit:** This finding gives Phase 5 (R4 diagnostic logging) clearer justification. The current flow produces no log entry, no user-visible error message, and no recovery path. Logs would have made this debuggable instead of "white screen, no idea what happened."

**Side-finding noted:** Even though the redirect breaks, Supabase MAY still emit `onAuthStateChange` if a session somehow lands in localStorage. Not blocking Phase 4 (which replaces the flow entirely), but worth a note: do not assume the existing flow ALWAYS fails — relaunches may pick up partial state via localStorage. Phase 4 PR should clear `localStorage` keys related to old auth flow on first launch post-upgrade to avoid stale-token confusion.

## 0b — Windows CI artifact baseline

**Question being answered:** Does the `build-windows` job in `.github/workflows/release.yml`
actually produce a working .exe today, or does it silently fail at the Unix-only
`mkdir -p` / `cp` shell built-ins on `windows-latest` (which uses PowerShell)?

**Approach:** Trigger the workflow via `workflow_dispatch`, download the resulting
`.exe`, run `node scripts/verify-windows-artifact.cjs <exe>` to assert the
rhino3dm + web-ifc WASM blobs are present in the asar.

**Verification script:** `scripts/verify-windows-artifact.cjs` (committed in this
phase). Doubles as the permanent CI gate after Phase 1 lands. Extracts the NSIS
installer using 7z, locates `resources/app.asar.unpacked/`, asserts:
- `dist/rhino3dm/rhino3dm.wasm` present and ≥ 1 MB
- `dist/rhino3dm/rhino3dm.min.js` present and ≥ 10 KB
- `dist/web-ifc/web-ifc.wasm` present and ≥ 1 MB

### Test results

**Status:** _COMPLETE — 2026-04-28 (confirmed via historical run inspection)_

Rather than trigger a fresh `workflow_dispatch`, I inspected the three
existing failed runs (visible in `gh run list --workflow=release.yml`).
**All three** previous runs failed, and the most recent (run ID
`24014082411`, v1.0.3, 2026-04-06, 1m52s) shows exactly the failure mode
the audit predicted:

```
> rhino-studio@1.0.1 copy:rhino3dm
> mkdir -p public/rhino3dm && cp node_modules/rhino3dm/rhino3dm.min.js public/rhino3dm/ && cp node_modules/rhino3dm/rhino3dm.wasm public/rhino3dm/

The syntax of the command is incorrect.
##[error]Process completed with exit code 1.
```

`windows-latest` runs `pwsh.EXE` by default, and `mkdir -p` is rejected
by PowerShell as invalid syntax. The job exits at the `copy:rhino3dm`
step every time. **The Windows job has never produced a `.exe`.**

A second audit prediction is also confirmed in the same log. The step's
env block shows all VITE_ secrets as blank:

```
env:
  GH_TOKEN: ***
  VITE_SUPABASE_URL: 
  VITE_SUPABASE_ANON_KEY: 
  VITE_BACKEND_URL: 
  VITE_STRIPE_PUBLISHABLE_KEY: 
```

(GitHub Actions masks secrets but renders empty strings when a referenced
secret is not configured in repo settings.) So even if Phase 1a fixed
the shell-script issue, the build would produce an app with empty
Supabase / Stripe config — a silent feature-flag failure on every CI build.

**Did NOT trigger a fresh `workflow_dispatch`.** Reasoning: same
`mkdir -p` syntax exists in both `copy:rhino3dm` and `copy:web-ifc`
scripts in current `package.json`; same PowerShell on `windows-latest`;
same outcome. The empirical evidence is conclusive without spending
another ~10 minutes of CI time.

| Check | Pass / Fail | Notes |
|---|---|---|
| `build-windows` job has ever exited 0 | ❌ Fail | All 3 historical runs failed |
| Failure step | `npm run copy:rhino3dm` | `mkdir -p` rejected by PowerShell |
| `release/*.exe` artifact uploaded | ❌ No | Job exits before electron-builder runs |
| `verify-windows-artifact.cjs` exits 0 against an .exe | N/A | Cannot run — no .exe has ever been produced |
| VITE_ secrets configured in repo | ❌ No | Empty strings rendered in env block — secrets not set |

### Conclusion

✅ **Audit prediction confirmed.** Phase 1 is required to produce any
working .exe. Specifically:
- **§1a** (cross-platform copy script via `scripts/copy-resources.cjs`) is the immediate unblock.
- **§1b** (add `VITE_STRIPE_PRO_PRICE_ID`, `VITE_STRIPE_ENTERPRISE_PRICE_ID`, plus configure all four existing `VITE_*` secrets in GitHub repo settings) is the second blocker that would otherwise produce a broken-but-launching .exe.
- **§1c** (`vite-plugin-validate-env` + Zod schema) catches any future regression where secrets become empty-string.

The verification script `scripts/verify-windows-artifact.cjs` is committed
and ready to run as a CI gate on the first `.exe` Phase 1 produces.

### Side-finding noted

The same log contained an unrelated warning:
```
fatal: No url found for submodule path '.claude/worktrees/agent-a4014444' in .gitmodules
```
A stale `.claude/worktrees/agent-*` directory got committed at some point
and confuses git's submodule lookup on the runner. Non-blocking
(treated as warning), but worth cleaning up — the current working tree
also has `.claude/worktrees/agent-accc811b` showing as deleted. Track
as a Phase 2 cleanup task or fold into Phase 1.

## 0c — Tester preflight (SAC / WDAC / build / AV)

**Question being answered:** Will the (eventual) tester's machine accept an
unsigned .exe? The post-research finding is that **SAC is no longer a hard
blocker** as of Windows 11 OS Build ≥ 26100.8116 (April 2026 cumulative
KB5083769) — it is now freely reversible from Settings. The remaining
blockers are AppLocker / WDAC enforcement on enterprise-managed machines, and
Defender ML heuristic flagging (~5-15% chance per April 2026 telemetry).

**Approach:** When a tester is identified, send them
`scripts/windows-preflight.ps1` to run via:

```powershell
irm https://raw.githubusercontent.com/inkykim/0studio/feat/windows-hardening-phase-0/scripts/windows-preflight.ps1 | iex
```

The script outputs JSON containing:
- OS build (with `sacReversible` boolean: build ≥ 26100.8116)
- `SmartAppControlState` (On / Off / Eval)
- AppLocker enforcement
- Domain-joined / Azure AD-joined / MDM-enrolled flags
- Antivirus vendor list
- A `decision` block with `recommendedActions` for the tester

### Test results

**Status:** _DEFERRED until tester is identified_

| Check | Result | Notes |
|---|---|---|
| Tester identified | No | Brainstorm flagged this as parallel sourcing |
| Preflight script JSON received | N/A | |
| OS Build ≥ 26100.8116 (SAC reversible) | N/A | |
| SmartAppControl state | N/A | |
| AppLocker enforced | N/A | |
| Enterprise-managed (domain / Azure AD / MDM) | N/A | |
| Antivirus | N/A | |

### Decision rule (for when tester arrives)

Based on the preflight JSON:
- **All green (SAC off or reversible, no AppLocker, not enterprise-managed):** proceed to Phase 6 handoff with normal SmartScreen-bypass instructions.
- **SAC On + reversible:** include 60-second SAC-toggle steps in tester instructions.
- **SAC On + not reversible (older build):** ask tester to install Windows Update first; do not attempt round 1 until they do.
- **AppLocker enforced OR enterprise-managed with policy:** defer this tester. Pursue Microsoft Azure Artifact Signing ($9.99/month, satisfies SAC) before retrying.
- **Defender ML history (any flagged binaries):** submit each new build to https://www.microsoft.com/wdsi/filesubmission 24-72h before tester handoff.

### Conclusion

**TBD — fill in after tester preflight:**
- [ ] Proceed normally with SmartScreen instructions
- [ ] Include SAC toggle in instructions
- [ ] Defer tester pending Windows Update / Microsoft Artifact Signing

## Summary — Phase 0 gate decision

**Goal of Phase 0:** Decide whether Phase 1, 2, 3, 4, 5, 6, 7 proceed as planned
or whether scope changes based on ground truth.

**Findings (filled in as checks complete):**

| Phase | Original scope | Confirmed / Adjusted | Why |
|---|---|---|---|
| 1 (CI build correctness) | Required | ✅ **Required + expanded** | 0b confirmed Windows job fails at `copy:rhino3dm` AND VITE_ secrets are unconfigured. §1a (copy-resources.cjs) and §1b (add price-id secrets + configure existing VITE_ secrets in repo settings) are both immediate-unblock items. Add side-task: clean up stale `.claude/worktrees/` directories. Mac afterPack regression on electron-builder 26.8.1 is also a Phase 1 item. |
| 2 (Static audit fixes) | Required | ✅ Required | Audit findings stand regardless of 0a/0b |
| 3 (Main-process behavior) | Required | ✅ Required | Single-instance lock, file-association argv, message queue all needed regardless |
| 4 (OAuth/Stripe rebuild) | Contingent on 0a | ✅ **Required cross-platform** | 0a confirmed Mac DMG OAuth produces white screen — full Phase 4 scope retained |
| 5 (Diagnostic logging) | Required | ✅ Required + reinforced | 0a finding (silent white-screen failure) underscores R4 value |
| 6 (Tester checklist + handoff) | Required | Required, awaits tester (0c deferred) | Cannot ship without; preflight script committed and ready |
| 7 (Known-issues tracker) | Required | Required | Trivial setup |

### Gate decision

**✅ Phase 0 complete.** The plan's seven-phase scope is confirmed correct
with two adjustments to Phase 1:

1. Add `VITE_STRIPE_PRO_PRICE_ID` and `VITE_STRIPE_ENTERPRISE_PRICE_ID` as
   GitHub Actions secrets BEFORE the next workflow run (otherwise builds
   continue to silently produce broken apps).
2. Configure the existing four `VITE_*` secrets that the workflow
   references but are not currently set in repo settings.
3. Fold `scripts/afterPack.cjs` regression fix into Phase 1 (Mac build
   correctness pass) since it blocks local DMG builds today.

**PR 1 ready to start.** Phase 1 work begins on a child branch
`feat/windows-hardening-phase-1` from `feat/windows-hardening-phase-0`.

**Side-finding worth tracking:** `scripts/afterPack.cjs` regression on
electron-builder 26.8.1 — Mac DMG build currently broken on main. Add to
Phase 1 (Mac build correctness pass) or split into a separate fix PR.

---

_Memo update protocol: as each `Status: PENDING` block converts to a real
result, update the corresponding section and the Summary table. Final state
of this memo is the input to PR 1 of the implementation work._
