---
date: 2026-04-09
topic: multi-format-support
---

# Multi-Format CAD File Support (Phase 1: Mesh Formats)

## Problem Frame

0studio is currently hardwired to Rhino 3D (.3dm) files — from file dialogs and drag-drop validation to the WASM-based loader and version control storage. Users working with other CAD tools (Revit, SketchUp, Blender, etc.) cannot use 0studio at all. Expanding to a multi-format CAD platform is the strategic direction. Phase 1 targets mesh formats (OBJ, STL, glTF/GLB) that have mature Three.js loaders, establishing the pluggable architecture that future formats (IFC, Revit via conversion) will use.

## Requirements

- R1. **Pluggable loader architecture**: The file loading pipeline must be format-agnostic. A new format should be addable by implementing a loader interface without modifying core version control, cloud sync, or UI code.
- R2. **OBJ file support**: Users can open, view, commit, branch, and cloud-sync `.obj` files with full parity to the current `.3dm` experience.
- R3. **STL file support**: Users can open, view, commit, branch, and cloud-sync `.stl` files (both ASCII and binary STL) with full parity to `.3dm`.
- R4. **glTF/GLB file support**: Users can open, view, commit, branch, and cloud-sync `.gltf` and `.glb` files with full parity to `.3dm`, including embedded textures and PBR materials.
- R5. **File open and drag-drop**: The Electron file open dialog, drag-drop zones, and OS file associations accept all supported formats. The format is auto-detected from the file extension.
- R6. **Format-aware rendering**: Each format renders with appropriate materials and coordinate system transformations (e.g., Z-up vs Y-up) without user intervention.
- R7. **Version control parity**: Commits, branches, and the commit tree work identically regardless of file format. A project's format is determined by the file it was created with.
- R8. **Cloud sync parity**: Push/pull to S3 and Supabase metadata work for all supported formats, not just `.3dm`.

## Success Criteria

- A user can open an OBJ, STL, or glTF file through any entry point (file dialog, drag-drop, OS file association) and have it render correctly
- The user can create commits, branches, and sync to cloud with non-3dm files — the workflow is indistinguishable from the current .3dm experience
- Adding a new format in the future requires implementing a loader only, with no changes to version control, cloud sync, or core UI
- Existing .3dm functionality is unaffected

## Scope Boundaries

- **In scope**: OBJ, STL, glTF/GLB loading, rendering, version control, and cloud sync
- **Out of scope**: Revit (.rvt/.rfa), IFC, STEP, and other BIM/CAD formats (future phases)
- **Out of scope**: Format conversion between types (e.g., OBJ to glTF)
- **Out of scope**: Multi-file projects (a single project = a single model file, same as today)
- **Out of scope**: Export to formats other than the project's native format

## Key Decisions

- **Start with mesh formats**: OBJ/STL/glTF chosen because Three.js has production-ready loaders, minimizing risk while establishing the multi-format architecture
- **Full parity, not view-only**: Non-3dm formats get the complete version control + cloud sync experience from day one
- **Phase 1 only**: Revit/IFC support is the strategic goal but will be a separate brainstorm once the pluggable architecture is proven
- **One project = one format**: Projects are single-format; mixing formats in one project is not planned

## Dependencies / Assumptions

- Three.js loaders for OBJ (`OBJLoader`), STL (`STLLoader`), and glTF (`GLTFLoader`) are stable and sufficient
- The existing delta compression approach can work with non-3dm binary data (or an alternative storage strategy will be identified during planning)
- Cloud sync presigned URL flow is format-agnostic (no `.3dm`-specific assumptions in the backend)

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R7][Technical] Should non-3dm files be stored natively or converted to a common internal format for version control?
- [Affects R1][Needs research] How does the current delta compression (fossil-delta) perform on OBJ (text), STL (binary), and glTF (JSON+binary) files? Are per-format compression strategies needed?
- [Affects R7][Technical] The current `.0studio/commits/<id>.3dm` path assumes `.3dm` — what's the cleanest way to make this format-aware?
- [Affects R4][Needs research] glTF files can reference external textures/bins. Should we require GLB (single-file) only, or support multi-file glTF with dependency tracking?
- [Affects R6][Technical] Each format has different coordinate conventions and material models. How should the loader interface abstract these differences?
- [Affects R5][Technical] How should Electron file associations be structured to register multiple formats without conflicts?

## Future Direction

Phase 2 will target BIM/architectural formats. The likely path is IFC first (open standard, `web-ifc` parser exists), then Revit via a server-side conversion pipeline (Autodesk APS or similar). The pluggable architecture from Phase 1 should make adding these straightforward from a UI/version-control perspective — the complexity will be in parsing and conversion.

## Next Steps

-> `/ce:plan` for structured implementation planning
