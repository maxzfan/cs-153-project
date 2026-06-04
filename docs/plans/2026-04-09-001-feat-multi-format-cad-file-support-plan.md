---
title: "feat: Multi-Format CAD File Support (Phase 1: Mesh Formats)"
type: feat
status: active
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-multi-format-support-requirements.md
---

# feat: Multi-Format CAD File Support (Phase 1: Mesh Formats)

## Overview

Transform 0studio from a Rhino-only tool into a multi-format CAD platform by adding OBJ, STL, and glTF/GLB support with full version control and cloud sync parity. The core deliverable is a pluggable loader architecture that makes adding future formats (IFC, Revit) a single-module change.

Currently, `.3dm` is hardcoded in 25+ locations across the Electron main process, React renderer, and Express backend. This plan replaces those hardcoded references with a format-agnostic pipeline while preserving existing `.3dm` functionality.

## Problem Statement / Motivation

Users working with non-Rhino CAD tools (Blender, SketchUp, FreeCAD, etc.) cannot use 0studio at all. The strategic direction is a multi-format CAD platform (see origin: `docs/brainstorms/2026-04-09-multi-format-support-requirements.md`). Phase 1 targets OBJ, STL, and glTF/GLB because Three.js ships production-ready loaders for all three — no new dependencies needed — allowing the pluggable architecture to be built and validated with minimal risk.

Key decisions carried forward from brainstorm:
- **Start with mesh formats** — easy wins that prove the architecture
- **Full parity, not view-only** — version control + cloud sync from day one
- **One project = one format** — no mixing formats in a single project
- **Phase 1 only** — Revit/IFC deferred until architecture is proven

## Proposed Solution

### Architecture: Loader Registry Pattern

Replace the monolithic `rhino3dm-service.ts` with a loader registry that maps file extensions to loader implementations. Each loader conforms to a shared interface and produces the same `LoadedModel` output type that the rest of the app already consumes.

```
                    ┌─────────────────┐
                    │  Loader Registry │
  file extension →  │  (format-map.ts) │ → LoadedModel
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐──────────────┐
              │              │              │              │
        ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
        │  3dm       │ │  OBJ      │ │  STL      │ │  glTF/GLB │
        │  Loader    │ │  Loader   │ │  Loader   │ │  Loader   │
        └───────────┘ └───────────┘ └───────────┘ └───────────┘
```

### Deferred Question Resolutions

These questions were deferred from brainstorming. Resolutions based on codebase analysis:

**Q: Native format storage vs common internal format?**
→ **Native format storage.** Commit files use native extensions (`commit-<id>.obj`, `.stl`, `.glb`). Reasons: most debuggable approach; avoids lossy conversion; delta compression already operates on raw `ArrayBuffer` regardless of format; `tree.json` gains a `format` field for loader dispatch.

**Q: Where is project format recorded?**
→ **`tree.json` gains a top-level `format` field** (e.g., `"format": "obj"`). Set on initial commit, immutable for project lifetime. Absent field defaults to `"3dm"` for backward compatibility with existing projects.

**Q: Delta compression on text vs binary formats?**
→ **Use `fossil-delta` for all formats uniformly.** The existing heuristic (delta-worker.ts:37) already falls back to snapshot when delta >= 60% of full size. This naturally handles text-format OBJ/ASCII STL where deltas may be large. No per-format compression strategy needed for Phase 1.

**Q: glTF multi-file vs GLB only?**
→ **GLB only for Phase 1.** Multi-file `.gltf` with external textures/bins would break the "one commit = one file" assumption across FileStorageService, cloud sync, and delta compression. The file dialog accepts both `.gltf` and `.glb` but opening a `.gltf` with external dependencies shows a clear error directing the user to export as GLB.

**Q: OBJ companion .mtl files?**
→ **Best-effort materials.** If an `.mtl` file exists alongside the `.obj`, load it for rendering. But version control stores only the `.obj` file. Material loss on commit restore is a documented limitation. This avoids the multi-file storage problem while giving acceptable initial rendering.

**Q: Export for non-3dm formats?**
→ **Out of scope for Phase 1.** The export menu item is disabled/hidden for non-3dm projects. The working file on disk is already in native format — "export" is redundant since the user can simply copy it. Three.js exporters (`STLExporter`, `GLTFExporter`) can be added in a future phase.

**Q: `exportModelToBuffer` fallback for non-3dm?**
→ **Disable for non-3dm formats.** The Priority 4 fallback in `restoreToCommit` / `pullFromCommit` uses rhino3dm to reconstruct a `.3dm` buffer from the Three.js scene. For non-3dm projects, this path must error explicitly rather than produce a corrupt buffer. The commit file on disk should always be the source of truth.

**Q: Electron file associations for multiple formats?**
→ **Register all supported extensions in package.json.** electron-builder supports multiple `fileAssociations` entries. Each format gets its own entry with appropriate name/description.

## Technical Approach

### Architecture

#### Loader Interface

```typescript
// src/lib/loaders/types.ts

export interface FormatMetadata {
  objectCount: number;
  fileName: string;
  fileSize: number;
  format: SupportedFormat;
}

export type SupportedFormat = '3dm' | 'obj' | 'stl' | 'gltf' | 'glb';

export interface ModelLoader {
  /** File extensions this loader handles (without dot) */
  readonly extensions: readonly string[];

  /** Human-readable format name for UI */
  readonly formatName: string;

  /** Load a file buffer into Three.js objects */
  load(buffer: ArrayBuffer, fileName: string): Promise<{
    objects: THREE.Object3D[];
    metadata: FormatMetadata;
  }>;

  /** Whether this loader supports exporting back to native format */
  readonly canExport: boolean;

  /** Export Three.js scene to native format (optional) */
  export?(objects: THREE.Object3D[]): Promise<ArrayBuffer>;
}
```

#### Loader Registry

```typescript
// src/lib/loaders/loader-registry.ts

const loaders: Map<string, ModelLoader> = new Map();

export function registerLoader(loader: ModelLoader): void { ... }
export function getLoaderForFile(fileName: string): ModelLoader | null { ... }
export function getSupportedExtensions(): string[] { ... }
export function getFileDialogFilters(): { name: string; extensions: string[] }[] { ... }
export function isSupportedFormat(fileName: string): boolean { ... }
```

#### Individual Loaders

Each loader is a separate module:
- `src/lib/loaders/rhino3dm-loader.ts` — wraps existing `rhino3dm-service.ts` logic
- `src/lib/loaders/obj-loader.ts` — wraps Three.js `OBJLoader` + best-effort `MTLLoader`
- `src/lib/loaders/stl-loader.ts` — wraps Three.js `STLLoader` (auto-detects ASCII/binary)
- `src/lib/loaders/gltf-loader.ts` — wraps Three.js `GLTFLoader` (GLB only in Phase 1)

### Implementation Phases

#### Phase 1: Loader Architecture + Format Infrastructure (Foundation)

Build the pluggable loader system and make the storage/sync layers format-aware. No new formats yet — `.3dm` continues to work through the new architecture.

**Tasks:**

- [ ] Create `src/lib/loaders/types.ts` — `ModelLoader` interface, `SupportedFormat` type, `FormatMetadata` type
- [ ] Create `src/lib/loaders/loader-registry.ts` — registry with `registerLoader()`, `getLoaderForFile()`, `getSupportedExtensions()`, `getFileDialogFilters()`, `isSupportedFormat()`
- [ ] Create `src/lib/loaders/rhino3dm-loader.ts` — extract loading logic from `rhino3dm-service.ts` into a `ModelLoader` implementation. Keep `rhino3dm-service.ts` for WASM init and export (the loader delegates to it).
- [ ] Create `src/lib/loaders/index.ts` — registers all loaders on import, exports the registry API
- [ ] Update `tree.json` schema — add top-level `format` field. Absent = `"3dm"` for backward compat. Set on initial commit via `VersionControlContext`.
- [ ] Update `electron/services/file-storage-service.ts`:
  - `getCommitFilePath(filePath, commitId, format?)` — use `format` param for extension instead of hardcoded `.3dm` (line 51)
  - `listCommitFiles(filePath)` — scan for `commit-*.*` instead of `commit-*.3dm` only (line 102)
  - All callers pass format from `tree.json` or working file extension
- [ ] Update `src/lib/cloud-sync-service.ts`:
  - `pushCommitFile` / `pullCommitFile` — accept `format` param for S3 key extension (lines 275, 286)
- [ ] Update `backend/routes/sync.js`:
  - `VALID_FILE_KEY` regex (line 12) — accept `.3dm`, `.obj`, `.stl`, `.glb`, `.gltf`, and `.delta`

**Success criteria:** Existing `.3dm` workflow works identically through the new loader registry. `tree.json` for new projects includes `format: "3dm"`. Old projects without `format` field continue working.

#### Phase 2: File Entry Points (All the Gates)

Update every location that filters or validates file extensions to use the loader registry.

**Tasks:**

- [ ] `electron/main.ts` — update `open-file` handler (line 70), CLI arg check (line 90), open dialog filters (lines 303-306), save dialog filters (lines 323-326), menu label (line 166) to use `getSupportedExtensions()` / `getFileDialogFilters()`
- [ ] `src/contexts/ModelContext.tsx`:
  - `importFile()` (line 456) — replace `.endsWith(".3dm")` with `isSupportedFormat()`
  - `reloadModelFromDisk()` (line 256) — replace `load3dmFile()` call with `getLoaderForFile(fileName).load()`
  - `handleProjectOpened()` (line 179) — same loader dispatch
  - Fallback filename (line 255) — use actual file extension, not `'model.3dm'`
  - `exportScene()` (line 516) — check `loader.canExport`; disable for non-3dm
- [ ] `src/components/ModelViewer.tsx`:
  - Drag-drop filter (line 568) — use `isSupportedFormat()`
  - File input `accept` (line 593) — use `getSupportedExtensions()` joined
  - UI text "Drop .3dm file here" (line 603) → "Drop 3D model here"
  - Hint text (line 612) → "Drag & drop a 3D model file"
  - Gallery mode loading (lines 509, 515) — use loader registry instead of `load3dmFile()`
  - Scene stats (lines 318-349) — show generic mesh stats for non-3dm formats (vertex count, face count) instead of Rhino-specific object types
- [ ] `src/components/WelcomePanel.tsx`:
  - Save dialog (line 119) — use `getFileDialogFilters()` for shared project download
  - Suggested name (line 116) — use project's actual format extension
  - UI text (lines 214, 235) — "Import 3D model" / "Open a 3D model to get started"
- [ ] `src/contexts/VersionControlContext.tsx`:
  - `restoreToCommit` (line 842) — use format from `tree.json` for `File` name and loader dispatch
  - `pullFromCommit` (line 949) — same
  - Disable `exportModelToBuffer` fallback (Priority 4) for non-3dm formats — show error instead
- [ ] `src/contexts/CloudSyncContext.tsx`:
  - `pushToCloud` / `pullFromCloud` — pass format to `pushCommitFile` / `pullCommitFile`
- [ ] `src/pages/Settings.tsx`:
  - Project name extraction (line 306) — replace `.replace('.3dm', '')` with generic extension stripping
- [ ] `package.json`:
  - Add file associations for `.obj`, `.stl`, `.glb`, `.gltf` on both macOS and Windows
  - Update app description

**Success criteria:** All file entry points (dialog, drag-drop, OS association, CLI) accept all supported formats. UI text is format-neutral. Export is disabled for non-3dm.

#### Phase 3: New Format Loaders

Implement the three new loaders. This should be straightforward since Phase 1-2 established the architecture.

**Tasks:**

- [ ] Create `src/lib/loaders/obj-loader.ts`:
  - Import `OBJLoader` from `three/examples/jsm/loaders/OBJLoader.js`
  - Import `MTLLoader` from `three/examples/jsm/loaders/MTLLoader.js`
  - `load()`: parse OBJ buffer, apply default `MeshStandardMaterial` (gray) if no `.mtl`
  - Best-effort `.mtl` loading: check if `.mtl` file exists at same path, load if present
  - Coordinate transform: OBJ is commonly Z-up but not universally — apply Z-up to Y-up by default (matches Rhino behavior, sensible for most CAD exports)
  - `canExport: false`
- [ ] Create `src/lib/loaders/stl-loader.ts`:
  - Import `STLLoader` from `three/examples/jsm/loaders/STLLoader.js`
  - `load()`: parse buffer (STLLoader auto-detects ASCII vs binary), wrap geometry in `MeshStandardMaterial`
  - Coordinate transform: Z-up to Y-up (most STL exports from CAD tools are Z-up)
  - `canExport: false`
- [ ] Create `src/lib/loaders/gltf-loader.ts`:
  - Import `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`
  - `load()`: parse buffer. For `.gltf` files, detect if external resources are referenced — if so, show error directing user to export as GLB
  - No coordinate transform needed (glTF spec is Y-up, matches Three.js)
  - Preserve PBR materials and embedded textures (GLTFLoader handles this natively)
  - `canExport: false`
- [ ] Register all new loaders in `src/lib/loaders/index.ts`

**Success criteria:** Each format loads, renders correctly with appropriate materials and coordinate system, and integrates with the version control and cloud sync pipeline established in Phases 1-2.

#### Phase 4: Integration Testing + Polish

Verify the full pipeline end-to-end for each format.

**Tasks:**

- [ ] Test matrix — for each format (OBJ, STL ASCII, STL binary, GLB):
  - Open via file dialog
  - Open via drag-drop
  - Create initial commit
  - Create subsequent commits (verify delta compression works)
  - Branch and switch branches
  - Restore to previous commit
  - Cloud sync push
  - Cloud sync pull (from a fresh local state)
  - Gallery mode comparison
  - File watcher reload (edit in external app)
- [ ] Test backward compatibility:
  - Open existing `.3dm` project with old `tree.json` (no `format` field)
  - Verify all `.3dm` workflows are unaffected
- [ ] Test edge cases:
  - `.gltf` with external textures → user-friendly error
  - OBJ with `.mtl` → materials load; without `.mtl` → gray geometry
  - Very large files (>100MB) for each format
  - Empty/corrupt files for each format → graceful error
- [ ] Update WelcomePanel shared project download to handle all formats

## System-Wide Impact

### Interaction Graph

1. **File open** → `ModelContext.importFile()` → `LoaderRegistry.getLoaderForFile()` → specific loader → `LoadedModel` → React state update → Three.js scene re-render
2. **Commit create** → `VersionControlContext` → reads working file buffer via IPC → `FileStorageService.saveCommitFile()` (now format-aware) → stores as `commit-<id>.<ext>`
3. **Commit restore** → `VersionControlContext.restoreToCommit()` → `FileStorageService.getCommitFilePath()` (format from tree.json) → reads buffer → `LoaderRegistry.getLoaderForFile()` → `LoadedModel`
4. **Cloud sync push** → `CloudSyncContext` → reads commit file → `cloudSyncService.pushCommitFile(commitId, format)` → S3 key `commits/<id>.<ext>`
5. **Cloud sync pull** → `CloudSyncContext` → `cloudSyncService.pullCommitFile(commitId, format)` → `FileStorageService.saveCommitFile(path, id, buffer, format)`
6. **File watcher** → chokidar fires → `ModelContext.reloadModelFromDisk()` → loader registry dispatch

### Error Propagation

- **Unsupported format**: `getLoaderForFile()` returns `null` → `importFile()` shows user-facing error toast
- **Corrupt file**: Individual loader's `load()` throws → caught in `ModelContext` → error toast, no state change
- **glTF with external deps**: `gltf-loader.ts` detects external references → throws descriptive error → caught in `ModelContext` → error toast suggesting GLB
- **Missing commit file on restore**: `FileStorageService` returns null → `restoreToCommit` shows error (no more silent `.3dm` fallback for non-3dm projects)
- **Backend rejects new extension**: 400 from `sync.js` → `CloudSyncContext` shows sync error. **Must deploy backend before client.**

### State Lifecycle Risks

- **tree.json migration**: Old projects lack `format` field. Resolution: absent field defaults to `"3dm"`. No migration needed — backward compatible.
- **Partial cloud sync**: If backend is updated but client is not (or vice versa), S3 keys may mismatch. Resolution: backend and client must be deployed in lockstep. The regex change is additive (accepts more extensions), so backend-first is safe.
- **Format field immutability**: Once set in tree.json, `format` should never change. If a user somehow tries to open a different format in the same project folder, show an error.

### API Surface Parity

These interfaces expose file-format logic and all need updating:

| Interface | Current state | Change needed |
|-----------|--------------|---------------|
| `rhino3dm-service.ts` | Monolithic `.3dm` loader | Extract into `rhino3dm-loader.ts` implementing `ModelLoader` |
| `FileStorageService` | Hardcoded `.3dm` extension | Accept `format` parameter |
| `cloud-sync-service.ts` | Hardcoded `.3dm` in S3 keys | Accept `format` parameter |
| `backend/routes/sync.js` | Regex allows `.3dm` + `.delta` only | Expand regex |
| `desktop-api.ts` / `preload.ts` | Format-agnostic (pass-through) | No change needed |
| `window.electronAPI` IPC channels | Mostly format-agnostic | No change needed (callers pass format) |

### Integration Test Scenarios

1. **Open OBJ → commit → close app → reopen → restore commit** — verifies format persists in tree.json across sessions and the correct loader is dispatched on restore
2. **Open STL → commit → push to cloud → fresh install → pull from cloud → render** — verifies end-to-end cloud sync with non-3dm format, including backend regex acceptance
3. **Open GLB → create branch → commit on each branch → gallery compare** — verifies gallery mode dispatches the correct loader per commit
4. **Open existing .3dm project (no `format` field in tree.json) → commit → verify still works** — backward compatibility
5. **Open .gltf with external textures → verify user-friendly error** — graceful degradation

## Acceptance Criteria

### Functional Requirements

- [ ] OBJ files can be opened, viewed, committed, branched, cloud-synced, and restored
- [ ] STL files (ASCII and binary) can be opened, viewed, committed, branched, cloud-synced, and restored
- [ ] GLB files can be opened, viewed, committed, branched, cloud-synced, and restored with PBR materials
- [ ] `.gltf` files with external dependencies show a clear error suggesting GLB
- [ ] OBJ files with co-located `.mtl` render with materials; without `.mtl` render as gray geometry
- [ ] All file entry points (dialog, drag-drop, OS association) accept all supported formats
- [ ] Export menu is disabled for non-3dm projects
- [ ] Scene stats show format-appropriate metadata (mesh vertex/face counts for non-3dm)
- [ ] `tree.json` includes `format` field for new projects
- [ ] Existing `.3dm` projects without `format` field continue working identically

### Non-Functional Requirements

- [ ] Adding a new format requires only implementing `ModelLoader` and registering it — no changes to version control, cloud sync, or core UI
- [ ] File loading performance is comparable to current `.3dm` loading (< 2s for typical files)
- [ ] Delta compression works for all formats (fallback to snapshot when delta is larger than full file)

## Dependencies & Prerequisites

- Three.js 0.160.1 (already installed) ships `OBJLoader`, `MTLLoader`, `STLLoader`, `GLTFLoader`
- No new npm dependencies required
- Backend `sync.js` regex update must deploy before (or simultaneously with) client changes
- `fossil-delta` 2.0 (already installed) works on any `ArrayBuffer` — format-agnostic

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Backend/client deploy timing mismatch | Medium | Cloud sync broken for new formats | Backend regex change is additive — deploy backend first, it's backward compatible |
| Delta compression poor for text formats | Medium | Storage bloat | Existing 60% threshold (delta-worker.ts:37) already handles this — falls back to snapshot |
| `.mtl` loading fails silently | Low | OBJ renders without materials | Acceptable for Phase 1 — geometry-only rendering is still useful |
| Large GLB files with embedded textures | Low | Memory pressure | Three.js GLTFLoader handles this; same risk profile as large `.3dm` files |
| Breaking existing `.3dm` projects | Low | Data loss | `format` field defaults to `"3dm"` when absent — zero migration needed |

## Future Considerations

- **Phase 2: BIM formats** — IFC via `web-ifc` parser, Revit via server-side Autodesk APS conversion. The loader registry from Phase 1 makes adding these straightforward.
- **Export for non-3dm** — Three.js has `STLExporter`, `GLTFExporter`, `OBJExporter`. Can be added per-format when demand justifies it.
- **Multi-file format support** — Full `.gltf` with external deps would require bundling files into a single commit blob (tar/zip). Architecturally possible but deferred.
- **Format conversion** — Convert between formats (e.g., OBJ → glTF). Not planned but the loader/exporter pattern supports it.
- **Per-format delta strategies** — Object-level delta for `.3dm` (using rhino3dm GUIDs, per docs/brainstorms/2026-03-30-delta-compression-requirements.md) could coexist with binary delta for other formats. The `ModelLoader` interface could gain an optional `computeDelta()` method.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-09-multi-format-support-requirements.md](docs/brainstorms/2026-04-09-multi-format-support-requirements.md) — Key decisions: mesh formats first (OBJ/STL/glTF), full parity not view-only, one project = one format, Phase 1 only.

### Internal References

- `src/lib/rhino3dm-service.ts` — current monolithic loader, to be wrapped
- `electron/services/file-storage-service.ts:51` — hardcoded `.3dm` commit extension
- `electron/services/file-storage-service.ts:102` — hardcoded `.3dm` in file listing
- `src/lib/cloud-sync-service.ts:275,286` — hardcoded `.3dm` in S3 keys
- `backend/routes/sync.js:12` — `VALID_FILE_KEY` regex
- `electron/workers/delta-worker.ts:37` — 60% threshold for delta fallback
- `src/contexts/ModelContext.tsx:456` — file validation entry point
- `src/contexts/VersionControlContext.tsx:842,949` — commit restore with `load3dmFile`
- `docs/brainstorms/2026-03-30-delta-compression-requirements.md` — delta compression architecture (future rhino3dm-specific object-level delta)
- `docs/brainstorms/2026-04-05-rhino3dm-local-wasm-requirements.md` — WASM bundling gotchas (asarUnpack, version mismatch pattern)

### Learnings Applied

- rhino3dm WASM has two separate code paths (`getLoader()` for display, `getRhino3dm()` for export) — both must be handled when refactoring
- `asarUnpack` config is required for WASM files — new loaders are pure JS so this doesn't apply
- Lazy-to-eager init pattern (pre-warm during `app.whenReady()`) should be applied to new loader initialization if any have heavy setup
- The `0studio_` storage folder naming uses `extname()` stripping which is already format-agnostic — no change needed for folder naming
