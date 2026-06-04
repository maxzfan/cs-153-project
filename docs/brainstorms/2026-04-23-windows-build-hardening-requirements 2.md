---
date: 2026-04-23
topic: windows-build-hardening
---

# Windows Build Hardening

## Problem Frame

0studio's Windows packaging was scaffolded on 2026-04-05 (`ebfc161`): NSIS
installer target, `icon.ico`, cross-platform build scripts, platform guards in
`electron/main.ts`, and a `build-windows` CI job. None of it has been
end-to-end tested on real Windows hardware, and six large features have
shipped since (dual-artifact commit model Phases 0-3A, cloud sync Phase 3A,
file watcher rewrite on chokidar, rhino3dm local WASM, delta compression,
glTF derivative conversion). Any of these may have introduced
Windows-incompatible assumptions.

The goal of this brainstorm is to reach a **working, full-parity Windows
.exe** that a developer can install on a Windows machine and use exactly as
they would use the Mac build — not a public release. Distribution, code
signing, and auto-update are explicitly deferred.

## Requirements

- **R1. Installable .exe produced by CI.** `build-windows` job on `windows-latest`
  produces an NSIS installer that installs, launches, and shuts down cleanly on
  Windows 11 x64. Tester-side confirmation, not just a green CI build.
- **R2. Full feature parity with the macOS build.** Everything the Mac app does
  works on Windows: local VCS (open/commit/branch/history), file watcher,
  cloud sync (S3 + Supabase), Google OAuth, Stripe checkout surfaces, team
  presence, Gallery mode, file associations (double-click .3dm), rhino3dm
  model loading, glTF derivative conversion.
- **R3. Static Windows-unsafe pattern audit complete.** Before the first
  tester handoff, audit the codebase for: manual path string manipulation
  (`/` vs `\`), platform-guard gaps, macOS-only APIs (`app.on('open-file')`),
  file-locking assumptions (Windows blocks delete/rename on open files), CRLF
  vs LF in `simple-git` output parsing, `userData` path assumptions,
  chokidar Windows-specific quirks, and git-on-PATH assumption. Fix
  everything found before shipping to tester.
- **R4. Diagnostic logging baked into Windows build.** A rotating file log
  written to `%APPDATA%\0studio\logs\` capturing: app start/stop, unhandled
  renderer errors, main-process exceptions, IPC errors, file operation
  errors, cloud sync errors. UI affordance to "Copy diagnostic report" (log
  tail + system info + app version).
- **R5. Parity checklist walkthrough.** A written, ordered checklist the
  tester walks through in a single session, producing a single structured
  report. Covers install, first-launch, each R2 feature, uninstall. Every
  item has a clear pass/fail criterion so the tester does not have to make
  judgment calls.
- **R6. Tester handoff artifacts.** Each tester round produces (a) a signed
  GitHub Actions artifact URL for the .exe, (b) the checklist pre-filled
  with the current build version, (c) an instructions page explaining how to
  bypass SmartScreen ("More info → Run anyway") and where to find the
  diagnostic log.
- **R7. Known-issues tracker.** A living doc (or issue label) tracking every
  Windows-specific issue found during tester rounds, with resolution status.
  Closes out when every R2 item passes.

## Success Criteria

- A non-developer Windows user (the friend tester) can install the .exe,
  open a .3dm, make commits, sign in, sync to cloud, and uninstall — without
  hitting crashes or needing to be walked through workarounds.
- Every item on the parity checklist passes on Windows 11 x64.
- The diagnostic log is useful enough that any future Windows bug report
  includes actionable information without a back-and-forth.
- Total tester round-trips to reach "all pass": **3 or fewer** (target; if
  more, the static audit in R3 was under-scoped).

## Scope Boundaries

Explicit non-goals for this effort:

- **Code signing / EV certificate.** Ship unsigned; tester clicks through
  SmartScreen. Signing is a separate future effort tied to public release.
- **Public download page or marketing.** Tester gets the artifact from
  GitHub Actions directly.
- **Auto-update (Squirrel / `latest.yml`).** Tester reinstalls manually each round.
- **Windows on ARM.** x64 only, matching current `win.target` config.
- **Linux.** Out of scope; may become a cheap follow-on once cross-platform
  correctness is real, but not part of this work.
- **Windows-specific UX redesign.** Keyboard shortcut relabeling, native menu
  reorganization, and Windows accent-color theming are polish, not parity.
  Only fix items that are broken or confusing on Windows.
- **Stripe webhook testing on Windows.** Backend is cross-platform Node and
  runs unchanged; webhook testing is not Windows-specific.

## Key Decisions

- **Full parity target, not core-only.** Rationale: a "demo-only" Windows
  build creates a two-tier user experience and long-lived forks in the
  codebase. Full parity is the only target that avoids ongoing carrying cost.
- **Audit + instrument before first tester session (Approach C).** Rationale:
  CI-to-tester iteration loop is measured in days. A thorough static audit
  plus diagnostic logging drops expected round-trips from ~8 to ~3. The
  logging infra is also reusable for packaged macOS debugging, which is
  currently hard.
- **Unsigned .exe is fine for tester.** Rationale: one friendly tester who
  can click through SmartScreen once is zero-friction; paying for and wiring
  up an EV cert is weeks of its own work and a public-release concern.
- **Static audit is the compounding asset.** Rationale: findings become
  tests/lints/platform-guard utilities that prevent Windows regressions on
  every future feature. The audit is not throwaway work.

## Dependencies / Assumptions

- A Windows 11 x64 tester is available and willing to do ~3 sessions of ~1
  hour each. Identity of tester is unresolved but not blocking — planning
  can begin while this is sourced.
- Git for Windows is either assumed on the tester's PATH or bundled/gracefully
  handled. (`simple-git` shells out to `git`; behavior without git installed
  needs verification — tagged as a planning question, not a brainstorm question.)
- The existing `build-windows` CI job actually produces a working .exe today;
  if it doesn't, fixing CI becomes a prerequisite task under R1.

## Outstanding Questions

### Resolve Before Planning

*(None blocking planning start.)*

### Deferred to Planning

- [Affects R2][Technical] How should double-click-while-running behave on
  Windows? (`open-file` event is macOS-only; Windows passes the path via a
  second-instance argv. Requires single-instance lock decision.)
- [Affects R2][Technical] Does Google OAuth's redirect mechanism work on
  Windows? (Custom protocol handler registration differs from macOS.)
- [Affects R2][Needs research] chokidar on Windows: confirm the April 5
  chokidar-4 rewrite handles Windows polling fallback and delete detection
  correctly, or whether `usePolling: true` is needed on Windows specifically.
- [Affects R3][Technical] Where in the codebase does path-string manipulation
  happen? Produce a list during audit; each item is a fix ticket.
- [Affects R3][Technical] `simple-git` parses command output; does the parser
  handle CRLF line endings emitted by Git for Windows?
- [Affects R4][Needs research] Pick a rotating file log library (or roll a
  ~30-line one). Must work in both main and renderer process via IPC.
- [Affects R6][Technical] SmartScreen bypass instructions — verify the exact
  click path on Windows 11 24H2 (may have changed from earlier builds).
- [Affects R7] Where should the known-issues tracker live — GitHub issues
  with a `platform:windows` label, or a living doc in `docs/`?

## Next Steps

→ `/ce:plan` for structured implementation planning
