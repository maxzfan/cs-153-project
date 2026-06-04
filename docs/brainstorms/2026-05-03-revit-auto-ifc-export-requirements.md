---
date: 2026-05-03
topic: revit-auto-ifc-export
---

# Revit Auto-IFC Export

## Problem Frame

On Windows, .rvt version control works — the file watcher commits every Revit save — but the 3D preview only refreshes if the user manually re-exports an .ifc sidecar from Revit. In practice users forget, so commits land with stale (or missing) previews and .rvt feels like a second-class format. Auto-generating the .ifc on every save is the missing piece that turns Revit support from "version history works" into "save → fresh preview, no manual step."

## Requirements

- R1. Ship a Revit add-in (.NET DLL + .addin manifest) that subscribes to Revit's `DocumentSaved` event and exports an IFC of the saved project to disk.
- R2. The add-in is bundled with the 0studio Windows installer and auto-installed: the installer detects supported Revit versions and drops the manifest + DLL into the per-version Revit Addins folder. No separate user download.
- R3. Target Revit 2024 and Revit 2025 for v1. Older versions fall back to the existing manual sidecar workflow.
- R4. The auto-exported .ifc is written next to the .rvt with the same basename (`building.rvt` → `building.ifc`), reusing the current `ifc-sidecar-service` detection logic without modification.
- R5. The add-in always overwrites any existing same-basename .ifc. The first time 0studio would clobber a pre-existing user-maintained .ifc for a given project, surface a one-time dismissible notice ("0studio is now managing this .ifc").
- R6. When the file watcher detects a .rvt change while the add-in is active, hold the new commit until the matching .ifc lands or a timeout (default 90s) elapses. On timeout, create the commit with current behavior (stale or missing preview) — version control must never be blocked.
- R7. The add-in writes the .ifc atomically from the watcher's perspective (temp file + rename, or equivalent) so chokidar never sees a half-written file.
- R8. 0studio shows a subtle status chip in the commit panel reflecting auto-preview state: `active` / `in-progress` / `unavailable`. The first time a user opens a .rvt and the add-in is not detected, show a one-time dismissible banner with a link to enable it.
- R9. macOS and Windows-without-Revit users see no regression: the existing manual sidecar workflow (drop `.ifc` next to `.rvt`, `redetect-ifc-sidecar` IPC) continues to work unchanged.

## Success Criteria

- A Windows user installs 0studio, opens Revit 2024/2025, edits a .rvt, hits Save, and sees a fresh 3D preview in 0studio with zero manual IFC export.
- The commit created from that save carries a glTF derivative generated from the just-exported IFC, not a stale one.
- A user with a hand-maintained .ifc receives a one-time notice when 0studio first overwrites it, never silent clobbering.
- Manual-sidecar users on macOS, Windows-without-Revit, or unsupported Revit versions experience the same behavior as today.

## Scope Boundaries

- Not building a cloud / server-side conversion path (APS Model Derivative API) for v1.
- Not supporting Revit 2022 / 2023 in v1.
- Not exposing IFC export settings in 0studio's UI; the add-in uses a fixed geometry-focused preset.
- Not building a bidirectional IPC channel between Revit and 0studio. The add-in is a "dumb" file writer; coupling stays at the filesystem boundary.
- Not preserving BIM properties or non-geometry metadata in the IFC (consistent with the dual-artifact model: derivatives are geometry-only).
- Not changing the existing single-basename sidecar convention.

## Key Decisions

- **Revit add-in over headless Revit and cloud APS**: only path that delivers "save → fresh preview" with no per-save user action and no paid Autodesk dependency. Reverses the earlier "second product, not a feature" judgment from the Revit ideation, because .rvt support has now shipped and the missing-preview pain is concrete.
- **Trigger on every `DocumentSaved`**: matches the file watcher's per-save commit cadence; idle-debounced or batched triggers reintroduce staleness windows.
- **Same-folder, same-basename sidecar**: zero changes to `ifc-sidecar-service`, file watcher, or the dual-artifact pipeline. Manual-export users on unsupported configurations stay on the same code path.
- **Always overwrite**: keeps the mental model simple — when the add-in is active, 0studio owns that .ifc. The one-time notice covers the meaningful edge case without a sprawling collision UI.
- **Wait-for-.ifc commit gating with timeout fallback**: every commit either gets a fresh preview or falls back gracefully; version control is never blocked on Revit.
- **Atomic temp + rename write**: standard hygiene to keep chokidar from emitting an event on a half-written file.
- **Bundle with the Windows installer**: maximizes "just works" feel; per-project opt-in or separate installer downloads add friction without payoff.

## Dependencies / Assumptions

- Revit 2024 + 2025 cover the bulk of active 0studio Revit users (assumed; worth validating during planning).
- Revit's `DocumentSaved` event fires reliably after the .rvt write completes, on local and (ideally) workshared models.
- A geometry-focused IFC preset (e.g., IFC2x3 Coordination View 2.0) yields acceptable mesh quality through web-ifc → glTF.
- Typical IFC export latency is 10–60s; the 90s default timeout is workable for v1.
- The 0studio Windows installer can write to per-user Revit Addins folders without admin escalation in the common case.

## Outstanding Questions

### Resolve Before Planning

(none — scope is defined, planning can proceed)

### Deferred to Planning

- [Affects R1][Needs research] Which IFC export preset (IFC2x3 Coordination View 2.0 vs IFC4 Reference View vs custom) yields the best web-ifc geometry quality at the smallest size? Validate against real Revit models.
- [Affects R2][Technical] Per-user (`%AppData%\Autodesk\Revit\Addins\<year>\`) vs machine-wide (`%ProgramData%\...`) install path. What does the 0studio installer write to under a non-admin install, and how does it handle both Revit years?
- [Affects R2][Technical] If both Revit 2024 and Revit 2025 are installed, does the add-in DLL need year-specific API bindings, or can a single DLL target both? Implications for the .addin manifest layout.
- [Affects R6][Technical] How does 0studio detect that the add-in is "active" (so it knows whether to wait vs. commit immediately)? Candidates: presence of the .addin manifest, a heartbeat file written by the add-in on Revit startup, or a per-project marker on first auto-export.
- [Affects R6][Technical] How is the wait timeout tuned for very large models (multi-hundred-MB .rvt) where IFC export can exceed 60s? Static default vs. learned-per-project.
- [Affects R7][Technical] What's the right atomic-write strategy on Windows given chokidar's `ReadDirectoryChangesW` semantics — `.tmp` + rename in the same directory, or write outside and `MoveFile`?
- [Affects R8][Technical] What surface(s) does "auto-preview unavailable" link to — docs page, in-app reinstall flow, or both?
- [Affects R3][Needs research] Actual Revit-version distribution among 0studio's Windows users (telemetry, support tickets, customer interviews) — confirms whether 2024+2025 is the right v1 cut.
- [Affects R5][Technical] How is the "first-time overwrite" notice de-duplicated across projects — per-project marker file, a list in user settings, or a single global "I've seen this" preference?
- [Affects R1][Edge case] Behavior on Save As / Detached / Save to Central / file rename: does `DocumentSaved` fire correctly, and does the .ifc land next to the new .rvt path?
- [Affects R9][Technical] Confirm the existing manual sidecar path (and `redetect-ifc-sidecar`) is unaffected by the new auto-export wait gate.

## Next Steps

→ `/ce:plan` for structured implementation planning
