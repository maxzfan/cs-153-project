---
date: 2026-04-22
topic: dual-artifact-commit-model
---

# Dual-Artifact Commit Model

## Problem Frame

0studio's commit model currently conflates storage and viewing — the same `.3dm` binary is both the versioned artifact and the source for 3D rendering. This makes it impossible to support formats like `.rvt` (no browser-side parser) or `.ifc` without giving every format full viewer integration. Adding Revit support under the current model would require building a separate viewer pipeline per format.

The dual-artifact model decouples these concerns: every commit stores the **original native file** (for fidelity and round-tripping) alongside a **lightweight glTF derivative** (for uniform in-app viewing). The viewer becomes a single-format glTF renderer, and new file formats only need to provide a conversion-to-glTF step.

## Requirements

- R1. Every commit stores two artifacts: the **original file** (`.3dm`, `.rvt`, `.ifc`, etc.) preserved byte-for-byte, and a **glTF derivative** generated from the original for in-app viewing.

- R2. The glTF derivative is generated **at commit time**, before the commit is finalized. The viewer always renders from the derivative, never from the original file directly.

- R3. The dual-artifact model applies to **all formats**, including `.3dm`. The current rhino3dm-based viewer is replaced by a uniform glTF viewer. The rhino3dm library is still used for `.3dm` → glTF conversion at commit time.

- R4. For `.rvt` files, 0studio **auto-detects a matching IFC sidecar** file alongside the `.rvt` (e.g., `building.rvt` + `building.ifc`). The IFC is converted to glTF client-side via web-ifc to produce the viewable derivative. The `.rvt` is stored as the original artifact.

- R5. If derivative generation **fails** (corrupt IFC, parser crash, unsupported geometry), the commit still succeeds with only the original file. The derivative is marked as missing in commit metadata. The viewer shows a placeholder for that commit.

- R6. Both the original file and glTF derivative are **synced to the cloud** (S3). Team members get instant viewing without needing to regenerate derivatives locally.

- R7. Delta compression continues to operate on **original files** (not derivatives). The derivative for a delta-compressed commit is stored as a standalone glTF — no delta chain for derivatives.

## Success Criteria

- A `.3dm` commit produces both a `.3dm` original and a `.glb` derivative, and the viewer renders from the `.glb`
- A `.rvt` + `.ifc` sidecar commit produces a `.rvt` original and a `.glb` derivative
- Gallery mode comparison works identically across formats (all comparing glTF)
- Cloud sync transfers both artifacts; a team member pulling sees the viewable immediately
- A commit with a failed derivative still appears in the commit tree and can be restored to disk

## Scope Boundaries

- **Not building a .rvt parser** — Revit viewing depends entirely on user-provided IFC sidecar exports
- **Not preserving BIM properties** — the glTF derivative is geometry-only (mesh + materials). Property/metadata viewing is out of scope
- **Not building server-side conversion** — all conversion happens client-side (rhino3dm for .3dm, web-ifc for .ifc)
- **Not changing the commit tree structure** — commits remain single-parent, single-branch. The tree.json schema extends but does not restructure
- **Not building a plugin/extension system** — format support is built-in, not dynamically loaded

## Key Decisions

- **glTF/GLB as the unified viewable format**: Three.js has native GLTFLoader. glTF is compact, widely supported, and captures mesh + materials. The viewer only needs to understand one format.
- **Mesh fidelity is acceptable for viewing**: The in-app viewer is for visual comparison and diffing, not precision modeling. Users open originals in Rhino/Revit for precision work. NURBS are tessellated during conversion.
- **IFC sidecar auto-detection for .rvt**: Relies on naming conventions (same base name, `.ifc` extension). Revit users can automate IFC export via Dynamo. Avoids manual dual-file import UX.
- **Never block commits on derivative failure**: Version control is the primary value. A missing viewable is degraded UX, not a broken workflow.
- **Derivatives are synced, not regenerated**: Avoids requiring every client to have every parser. Costs more S3 storage but guarantees instant viewing.

## Dependencies / Assumptions

- web-ifc WASM library can parse real-world Revit IFC exports with acceptable geometry quality
- rhino3dm can export Three.js scenes to glTF (or an intermediate step via Three.js GLTFExporter)
- glTF derivatives for typical architectural models are significantly smaller than originals (expected 5-20x reduction for .rvt)
- IFC sidecar naming convention is reliable enough for auto-detection in practice

## Outstanding Questions

### Resolve Before Planning
(none)

### Deferred to Planning
- [Affects R1][Technical] What is the exact file naming convention for derivatives on disk? (e.g., `commit-{id}.glb` alongside `commit-{id}.3dm`)
- [Affects R2][Needs research] Can Three.js `GLTFExporter` produce acceptable glTF from rhino3dm-loaded scenes, or is an intermediate conversion step needed?
- [Affects R4][Needs research] What IFC sidecar naming conventions are reliable? Same basename, same directory? How to handle multiple `.ifc` files?
- [Affects R4][Needs research] What web-ifc version/configuration produces the best geometry quality from Revit IFC exports? What IFC flavors (IFC2x3 vs IFC4) should be supported?
- [Affects R6][Technical] Should derivatives use a separate S3 prefix (e.g., `commits/{id}.glb`) or be stored alongside originals?
- [Affects R7][Technical] How does the format abstraction layer integrate with the existing delta compression pipeline? Does `FileStorageService` need a format-aware storage strategy?
- [Affects R3][Technical] What is the migration path for existing .3dm-only commits that have no glTF derivative? Generate on first access, or batch-generate?
- [Affects R5][Technical] How should "retry derivative generation" work? Manual trigger in UI, or automatic on next app launch?

## Next Steps

-> `/ce:plan` for structured implementation planning
