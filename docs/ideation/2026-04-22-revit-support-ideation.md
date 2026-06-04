---
date: 2026-04-22
topic: revit-support
focus: Revit (.rvt) file support for 0studio
---

# Ideation: Revit (.rvt) Support

## Codebase Context

- **Project**: Electron + React/Vite + Three.js desktop app for .3dm version control (macOS-only)
- **Backend**: Express (plain JS), Supabase auth, S3 cloud sync, Stripe billing
- **Format coupling**: .3dm hardcoded in ~15 places across file dialogs, storage naming, loaders, watchers, and contexts. No format abstraction layer exists.
- **Key constraints**: .rvt files have no browser-side WASM parser. Revit API is Windows-only. .rvt files are 100MB-1GB+. Product identity is "version control for Rhino."
- **Bright spots**: Cloud layer (S3 presigned URLs, backend APIs) is already format-agnostic. WASM bundling patterns exist from rhino3dm work. IFC (`building.ifc`) was used as example filename in AWS_SETUP.md, suggesting early consideration.
- **IFC opportunity**: IFC (Industry Foundation Classes) is an open BIM interchange standard. web-ifc parses IFC in browser via WASM. Revit exports to IFC. Every major BIM tool exports IFC.
- **Past learnings**: Zero prior exploration of multi-format support. Delta compression is .3dm-specific (uses rhino3dm GUIDs). Git-native VCS was tried and abandoned for binary files.

## Ranked Ideas

### 1. IFC-First Visual Stack
**Description:** Add IFC as a second viewable format via web-ifc WASM. Users export IFC from Revit, 0studio renders the geometry. Format abstraction is built reactively alongside this work (not speculatively before). Geometry-only -- strip BIM properties, keep triangulated mesh. Position honestly as "visual version comparison," not "BIM version control." Phased: (A) build format abstraction alongside IFC work, (B) integrate web-ifc WASM for geometry rendering, (C) validate with real Revit-exported IFC files.
**Rationale:** The only technically viable path to visual Revit model support. web-ifc runs client-side in WASM (same pattern as rhino3dm), IFC is an ISO standard every BIM tool exports, and geometry-only scoping keeps complexity manageable. The format abstraction created here pays dividends for any future format (STEP, glTF, OBJ).
**Downsides:** IFC export quality from Revit varies wildly (IFC2x3 vs IFC4, tessellation differences). web-ifc has known brittleness on real-world IFC files. Requires users to manually export IFC until automated conversion exists. Geometry-only rendering is weaker than free IFC viewers that show properties. Estimated 6-10 weeks, not 2-3.
**Confidence:** 70%
**Complexity:** Medium-High
**Status:** Unexplored

### 2. Dual-Artifact Commit Model
**Description:** Each commit stores two artifacts: the original native file (.rvt, .3dm) as an opaque blob for exact restoration, plus a derived lightweight viewable (IFC, glTF) for rendering and comparison. VCS layer versions the blob; viewer consumes the derivative. Decouples "what we version" from "what we render."
**Rationale:** The current architecture conflates storage and rendering -- rhino3dm-service.ts both parses .3dm for viewing AND exports back to .3dm for storage. This conflation is what makes multi-format support impossible. A dual-artifact model cleanly separates concerns. Both feasibility and strategy reviewers agreed this is the right architectural pattern.
**Downsides:** Doubles storage per commit. Creates consistency problems (derivative generation failures, corruption, re-derivation strategy needed). More complex cloud sync.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 3. Design Handoff Tracking (Narrow Scope)
**Description:** Lightweight feature: tag a Rhino commit as "handed off to BIM team" with metadata (recipient, date, IFC export hash). Track the Rhino-to-Revit boundary without parsing .rvt. Optionally trigger an IFC export from the tagged .3dm commit so the BIM team gets a specific, versioned snapshot.
**Rationale:** Solves the real coordination pain (architects lose visibility after handoff to Revit) without entering Autodesk's ecosystem. No .rvt parsing needed. No Windows dependency. Builds on existing commit metadata. The only defensible "Revit adjacency" move according to strategic review.
**Downsides:** Narrow feature -- won't satisfy users who actually want to open .rvt files. IFC export from .3dm is lossy (NURBS to mesh). May not generate enough user excitement.
**Confidence:** 65%
**Complexity:** Low
**Status:** Unexplored

### 4. "Stay Rhino, Deepen the Moat" (Strategic Alternative)
**Description:** Don't build Revit support. Instead, deepen Rhino version control -- Grasshopper definition versioning, better visual diffs, offline WASM bundling, smart commit messages from geometry changes. Make the .3dm experience so good that Revit users wish they had something similar, creating pull rather than pushing into Autodesk's turf.
**Rationale:** 0studio's differentiation is Rhino-native version control. Every Revit idea either competes on Autodesk's turf, requires Windows infrastructure, or depends on lossy IFC conversion. The product is pre-PMF for Rhino VCS -- the highest-value work is proving that market first. Highest confidence score of all survivors.
**Downsides:** Limits TAM to Rhino users (~1M licenses vs Revit's ~5M+). Doesn't address cross-tool coordination pain. Risk of missing timing window if a competitor ships multi-format AEC version control.
**Confidence:** 80%
**Complexity:** N/A (strategic decision)
**Status:** Unexplored

### 5. Cloud Conversion via APS (Optional Accelerant)
**Description:** Use Autodesk Platform Services (Model Derivative API) to generate viewable IFC/glTF derivatives from uploaded .rvt files. Eliminates the manual IFC export friction -- users drop in a .rvt and 0studio handles the rest via server-side conversion. Pairs with Dual-Artifact model (#2).
**Rationale:** Only path to "just works" .rvt support without Revit installed. Removes the manual IFC export step that kills adoption.
**Downsides:** Paid API (APS pricing), 5-15 minute conversion latency for large files, hard Autodesk dependency for a core pipeline step. If Autodesk changes terms or pricing, you're exposed. Requires new backend infrastructure (S3 event trigger, conversion job queue, derivative storage).
**Confidence:** 55%
**Complexity:** Medium-High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Opaque Binary Blob VCS | No viewer = no differentiation over Dropbox/Git LFS |
| 2 | Revit Add-In / Windows Sidecar | Second product, not a feature. macOS team with zero C#/.NET |
| 3 | Element-Level Semantic BIM Diffing | Research project masquerading as a feature. Unreliable GUID matching |
| 4 | Multi-File Federated Project | Fundamental architecture rewrite. v3 concern |
| 5 | Speckle Integration | Third-party dependency for core functionality |
| 6 | Worksharing Awareness | Undocumented binary format on inaccessible platform (Windows) |
| 7 | Plugin Architecture for Parsers | YAGNI. One parser doesn't need a plugin system |
| 8 | Progressive/Streaming Loading | Premature optimization for unintegrated format |
| 9 | Format-Neutral Spatial Diff | Intractable due to tessellation/tolerance differences across formats |
| 10 | APS Cloud Thumbnails | Paying competitor for table-stakes functionality |
| 11 | IFC Property Preservation | Competes directly with BIM 360, Speckle, BIMcollab |
| 12 | Cross-Model Clash Detection | Navisworks/Solibri market. Requires multi-file which was cut |
| 13 | Linked Reference Files | Multi-file in disguise with worse UX |
| 14 | Worksharing Rescue | Wrong platform, wrong cost model, file-lock conflicts |
| 15 | Revit-to-Rhino Sync Loop | Bidirectional NURBS/parametric BIM sync is unsolved |
| 16 | "Ship-Tomorrow MVP" (blob VCS) | Timestamped backup folder with extra steps. Brand damage risk |
| 17 | "AEC Collaboration Platform" | Three infeasible ideas combined. Multi-year, large-team effort |
| 18 | "Smart Sync Bridge" | Combines fantasy positioning with impossible features |

## Session Log
- 2026-04-22: Initial ideation -- 48 raw ideas from 6 divergent agents, deduped to 25 unique candidates + combinations, 2 adversarial critics (feasibility + strategy), 5 survivors
