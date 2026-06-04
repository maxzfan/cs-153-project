---
title: "feat: Dual-Artifact Commit Model"
type: feat
status: completed
date: 2026-04-22
completed: 2026-04-23
origin: docs/brainstorms/2026-04-22-dual-artifact-commit-model-requirements.md
---

# feat: Dual-Artifact Commit Model

## Enhancement Summary

**Deepened on:** 2026-04-22
**Sections enhanced:** All phases + new Phase 0
**Research agents used:** architecture-strategist, performance-oracle, julik-frontend-races-reviewer, data-integrity-guardian, pattern-recognition-specialist, security-sentinel, framework-docs-researcher, best-practices-researcher

### Key Improvements
1. **Added Phase 0 (Prerequisites)** — commit mutex, path traversal fixes, and tree.json version bump must land before dual-artifact work begins
2. **Scene reuse optimization** — reuse the already-loaded Three.js scene from ModelContext at commit time instead of re-parsing via rhino3dm WASM. Eliminates 1-3s and ~100MB peak memory per commit.
3. **Moved defensive tasks earlier** — file watcher `.glb` exclusion to Phase 1, storage folder collision guard and `downloadFullProject` update to Phase 3 (from Phase 4)
4. **Explicit derivative sync tracking** — `derivativeSyncedCommitIds` set in CloudSyncContext for partial-upload recovery
5. **Security hardening** — IPC path validation, IFC sidecar symlink checks, web-ifc sandboxing in Web Worker, GLTFLoader URI restriction

### New Considerations Discovered
- No commit mutex exists — double-commit race condition widens with async glTF generation
- Gallery mode never disposes Three.js GPU resources (pre-existing memory leak)
- Old app versions will silently strip new tree.json fields — requires version bump to `1.1`
- IPC ArrayBuffer transfers use structured clone (full copy) — use temp file for large .glb buffers
- `downloadFullProject` has a pre-existing bug: ignores delta `storageType`, saves everything as `.3dm`

---

## Overview

Change every commit to store two artifacts: the **original native file** (.3dm, .rvt, .ifc) preserved byte-for-byte, and a **lightweight glTF derivative** (.glb) for uniform in-app viewing. The viewer becomes a single-format glTF renderer. New file formats only need a conversion-to-glTF step.

This decouples "what we version" (original file) from "what we render" (glTF derivative), enabling multi-format support without building a separate viewer pipeline per format.

(see origin: `docs/brainstorms/2026-04-22-dual-artifact-commit-model-requirements.md`)

## Problem Statement

The current architecture conflates storage and viewing — the same `.3dm` binary is both the versioned artifact and the input for 3D rendering via `Rhino3dmLoader`. This makes it impossible to support formats like `.rvt` (no browser-side parser) without giving every format full viewer integration. The `.3dm` format is hardcoded in ~15 places across file dialogs, storage, loaders, and contexts.

## Proposed Solution

### Commit Storage

Each commit produces up to 3 files on disk:

```
0studio_building/
  commit-{id}.3dm          # Original (snapshot)    — OR —
  commit-{id}.delta         # Original (delta)
  commit-{id}.glb           # glTF derivative (always standalone, never delta-compressed)
```

tree.json commit schema extends with:

```typescript
{
  // ... existing fields (id, message, timestamp, parentCommitId, branchId, starred, storageType, baseCommitId, fullHash, deltaChainLength, authorId, authorEmail) ...

  // NEW: Dual-artifact fields
  originalFormat?: '.3dm' | '.rvt' | '.ifc',  // absent = '.3dm' for backward compat
  derivativeStatus?: 'present' | 'missing',   // absent = 'missing' for backward compat
  derivativeSize?: number,                     // bytes, for integrity check on read
}
```

### Research Insights: Schema Design

- **Use string literal union for `originalFormat`**, not plain `string`. Matches the existing `storageType: 'snapshot' | 'delta'` precedent.
- **Only persist `derivativeStatus` when `'present'`**. Absence means `'missing'`, matching the conditional-write pattern used for `storageType`/`baseCommitId`.
- **Add `derivativeSize`** for integrity checking. On read, verify file size matches before parsing. Catches truncation (the most common corruption mode) cheaply.
- **Consider `generatorVersion`** (e.g., `"gltf-export-v1"`) for future cache invalidation when the GLB pipeline improves.
- **Bump tree.json `version` from `'1.0'` to `'1.1'`** when dual-artifact fields are present. Old app versions silently strip unknown fields during save (the `saveTreeFile` callback reconstructs from React state). A version mismatch warning prevents silent data loss for teams with mixed versions.
- **Update `FileStorageService` inline types** at lines 186-211 and 224-249 — these explicitly type the tree schema and will reject new fields at compile time if not updated.

### Conversion Pipeline

All conversion happens client-side at commit time:

| Source format | Conversion path | Library |
|---|---|---|
| `.3dm` | Reuse loaded Three.js scene from ModelContext → .glb (GLTFExporter) | three |
| `.ifc` | .ifc → Three.js geometry (web-ifc) → .glb (GLTFExporter) | web-ifc + three |
| `.rvt` | Auto-detect .ifc sidecar → same as .ifc path | web-ifc + three |

### Research Insights: GLTFExporter

- **Use `parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 1024 })`** — returns `Promise<ArrayBuffer>` directly as a `.glb` file.
- **userData survives the round-trip** via glTF `extras` field. Rhino object properties (layer name, attributes) are preserved as JSON-serializable `extras` on each node.
- **Material support**: MeshStandardMaterial (which Rhino3dmLoader produces) is fully supported. DoubleSide exports correctly. Vertex colors via `COLOR_0` attribute are preserved.
- **Coordinate system**: glTF spec is Y-up (same as Three.js). The Z-up → Y-up rotation already applied by `load3dmFile` is baked into the exported node transforms. GLTFLoader will NOT re-apply transforms — this is correct, but must be validated in Phase 1.
- **File size**: Raw GLB is 2-5x larger than original .3dm without compression. Consider glTF-Transform with Meshopt compression in a future pass for 60-90% reduction.

### Research Insights: web-ifc

- **Use `web-ifc@0.0.77` directly** — not `web-ifc-three` (which pins an outdated `web-ifc@^0.0.39` and conflicts with Three.js v0.160.1).
- **Use `StreamAllMeshes`** for memory-efficient processing of large IFC files (processes one mesh at a time).
- **Vertex data is interleaved**: position + normal, 6 floats per vertex. Must be separated into two `Float32Array`s for Three.js `BufferGeometry`.
- **CRITICAL: Call `.delete()` on `FlatMesh` and `IfcGeometry` objects** — these are WASM heap allocations NOT garbage-collected by JavaScript.
- **Settings**: `COORDINATE_TO_ORIGIN: true` handles large Revit coordinate offsets. `CIRCLE_SEGMENTS: 12` controls curve tessellation quality.
- **Known Revit IFC issues**: Missing geometry on complex families/curtain walls, flipped normals (use DoubleSide), large coordinate offsets, extraneous elements. Use `DoubleSide` material universally.

### Viewer Change

The viewer switches from `Rhino3dmLoader` (format-specific) to `GLTFLoader` (universal) for rendering committed versions. Before the first commit (initial open), the app still renders directly via the format-specific loader to avoid conversion latency.

### Research Insights: GLTFLoader

- **`parse(data, path, onLoad, onError)`** accepts `ArrayBuffer` directly. For self-contained `.glb`, set `path` to `''`.
- **No WASM dependency** — pure JavaScript parsing. Dramatically faster than rhino3dm WASM for loading committed versions.
- **Object UUIDs change** after the round-trip. Object `name` properties and `userData` are preserved.
- **Security**: Configure GLTFLoader to reject external URI references. Only allow embedded data from the binary chunk. Set resource path to a non-existent directory to prevent external fetches.

### Cloud Sync

Both artifacts upload to S3 per commit. Team members get instant viewing without local regeneration:

```
projects/{projectId}/commits/{commitId}.3dm    # or .rvt, .ifc, .delta
projects/{projectId}/commits/{commitId}.glb    # derivative
```

### Research Insights: Cloud Sync Patterns

- **Preview-first pull ordering**: Download .glb first (small, gives user something to see immediately), then download original in background. This is the Figma pattern.
- **Use `Promise.allSettled`** for the two uploads per commit — record which succeeded and which failed independently.
- **Add `derivativeSyncedCommitIds`** set parallel to `cloudSyncedCommitIds`. Without this, there is no way to retry failed derivative uploads.
- **Add `pushDerivativeFile` / `pullDerivativeFile`** as separate methods on CloudSyncService rather than overloading `pushCommitFile`. Maintains conceptual separation.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────┐
│ Renderer Process                                │
│                                                 │
│  ModelContext ──→ FormatService.loadFile()       │
│       │              ├── rhino3dm (for .3dm)     │
│       │              ├── web-ifc  (for .ifc)     │
│       │              └── (sidecar detection for .rvt)
│       │                                         │
│       ├──→ GLTFExporter.parseAsync(scene) → .glb│
│       │    (reuses already-loaded scene)         │
│       │                                         │
│       └──→ GLTFLoader.parse(.glb) ──→ Viewer    │
│                                                 │
│  CloudSyncContext ──→ pushOriginal + pushDerivative
│  GalleryContext   ──→ GLTFLoader for all slots   │
└─────────────────────────┬───────────────────────┘
                          │ IPC
┌─────────────────────────┴───────────────────────┐
│ Main Process                                    │
│                                                 │
│  FileStorageService                              │
│    ├── saveCommitFile()      (original)          │
│    ├── saveDeltaFile()       (original delta)    │
│    ├── saveDerivativeFile()  (NEW: .glb)         │
│    ├── readDerivativeFile()  (NEW: .glb)         │
│    └── derivativeFileExists()(NEW)               │
│                                                 │
│  FileWatcher                                     │
│    ├── watches primary file (.3dm / .rvt)        │
│    └── watches IFC sidecar (NEW, for .rvt)       │
└─────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 0: Prerequisites (Fix Pre-Existing Issues)

**Goal:** Address pre-existing bugs and security issues that the dual-artifact work would amplify.

**Tasks:**

- [ ] **Add commit mutex** — `commitModelChanges` is async with multiple awaits but has no guard against concurrent invocations. Adding glTF generation widens the race window to 1-3s. Add a `useRef(false)` mutex that prevents overlapping commits:
  ```typescript
  const isCommittingRef = useRef(false);
  // At top of commitModelChanges:
  if (isCommittingRef.current) { toast.warning("Commit in progress"); return; }
  isCommittingRef.current = true;
  try { /* ... */ } finally { isCommittingRef.current = false; }
  ```
  - File: `src/contexts/VersionControlContext.tsx`

- [ ] **Fix IPC path traversal** — All commit storage IPC handlers (`save-commit-file`, `read-commit-file`, `save-delta-file`, etc.) accept arbitrary `filePath` from the renderer without calling `validateProjectPath()`. The validation is only applied to `readFileBuffer` and `writeFileBuffer`. Apply `validateProjectPath()` to all storage IPC handlers.
  - File: `electron/main.ts`

- [ ] **Add gallery mode resource disposal** — Gallery mode (`ModelViewer.tsx:484-527`) loads up to 4 models into a Map but never `.dispose()`s Three.js geometries/materials when selections change, causing GPU memory leaks. Add a `disposeLoadedModel()` utility that traverses and disposes all resources before setting new gallery data.
  - File: `src/components/ModelViewer.tsx`

- [ ] **Add gallery mode load cancellation** — The gallery `useEffect` has no cancellation token. Rapid selection changes cause stale data races. Add a `cancelled` flag in the cleanup function.
  - File: `src/components/ModelViewer.tsx`

- [ ] **Debounce tree.json auto-save** — The `useEffect` at line 516 fires on every state change (`branches`, `commits`, `activeBranchId`, `currentCommitId`). A single commit triggers 2-4 tree.json writes with intermediate states. Add a 100ms debounce.
  - File: `src/contexts/VersionControlContext.tsx`

**Success criteria:** Commits cannot race. Gallery mode does not leak GPU memory. tree.json writes are atomic per logical operation.

#### Phase 1: Foundation — Storage + IPC + glTF Pipeline

**Goal:** Establish the dual-artifact storage layer and validate the .3dm → .glb conversion pipeline.

**Tasks:**

- [ ] **Validate GLTFExporter pipeline** — Write a standalone test: load a `.3dm` via `Rhino3dmLoader`, pass through `GLTFExporter.parseAsync(scene, { binary: true })`, save `.glb`, reload via `GLTFLoader.parse(buffer)`, visually compare. Test with: simple geometry, complex NURBS model, model with materials. **Also validate coordinate transforms**: confirm bounding boxes match between original and round-tripped model (programmatic comparison, not just visual).
  - File: create `scripts/test-gltf-export.ts`

- [ ] **Extend FileStorageService** — Add `.glb` derivative methods following the `.delta` pattern:
  - `getDerivativeFilePath(filePath, commitId)` → `commit-{id}.glb`
  - `saveDerivativeFile(filePath, commitId, buffer)`
  - `readDerivativeFile(filePath, commitId)` → `ArrayBuffer | null`
  - `derivativeFileExists(filePath, commitId)` → `boolean` (note: `-file-` infix for IPC naming consistency with `commit-file-exists`)
  - Update `listCommitFiles()` to recognize `.glb` files
  - **Update the inline TypeScript type definitions** at lines 186-211 and 224-249 to include `originalFormat`, `derivativeStatus`, `derivativeSize`
  - File: `electron/services/file-storage-service.ts`

- [ ] **Add IPC channels** — Register new handlers in main process, expose in preload, wrap in desktop-api:
  - `save-derivative-file(filePath, commitId, buffer)`
  - `read-derivative-file(filePath, commitId)` → `ArrayBuffer | null`
  - `derivative-file-exists(filePath, commitId)` → `boolean`
  - **Apply `validateProjectPath()` to all three handlers**
  - Files: `electron/main.ts`, `electron/preload.ts`, `src/lib/desktop-api.ts`

- [ ] **Extend tree.json schema** — Add `originalFormat`, `derivativeStatus`, and `derivativeSize` fields to commit metadata. Bump tree.json `version` from `'1.0'` to `'1.1'`. Add a version mismatch warning when loading a `1.1` tree from an old app. Ensure backward compatibility (absent fields = `.3dm` original, no derivative).
  - Files: `src/contexts/VersionControlContext.tsx` (type definitions + save/load + conditional serialization)

- [ ] **Build glTF conversion service** — New module (function module pattern, matching rhino3dm-service.ts style):
  - `sceneToGlb(scene: THREE.Scene): Promise<ArrayBuffer>` — uses `GLTFExporter.parseAsync` with `{ binary: true, onlyVisible: true, maxTextureSize: 1024 }`
  - `loadGlbFile(buffer: ArrayBuffer): Promise<LoadedModel>` — uses `GLTFLoader.parse` with empty resource path
  - **Generalize LoadedModel metadata**: introduce `ModelMetadata` base interface with `objectCount`, `fileName`, `fileSize`, then extend as `Rhino3dmMetadata` and `GltfMetadata` (adding `meshCount`, `triangleCount`)
  - File: create `src/lib/gltf-service.ts`
  - Also update: `src/contexts/ModelContext.tsx` (LoadedModel type)

- [ ] **Exclude .glb from file watcher** — Add `.glb` to the watcher's ignore pattern. Even though the current watcher only watches the primary file (not the `0studio_` folder), this prevents issues if the watcher scope is later extended for IFC sidecar detection.
  - File: `electron/services/file-watcher.ts`

**Success criteria:** A `.3dm` file can be committed and the `0studio_` folder contains both `commit-{id}.3dm` and `commit-{id}.glb`. The `.glb` can be loaded back via `GLTFLoader` and looks correct. Coordinate transforms are validated.

#### Phase 2: Commit Flow + Viewer Switch

**Goal:** Wire dual-artifact generation into the commit flow and switch the viewer to glTF.

**Tasks:**

- [ ] **Modify commit flow** — In `commitModelChanges`, after reading the native file:
  1. **Reuse the already-loaded scene** from `ModelContext.loadedModel` — do NOT call `load3dmFile()` again. This eliminates 1-3s WASM parse and ~100MB peak memory.
  2. Convert scene to `.glb` via `sceneToGlb(loadedModel.objects)`
  3. If `sceneToGlb` succeeds AND `desktopAPI.saveDerivativeFile()` resolves: set `derivativeStatus: 'present'`, record `derivativeSize`
  4. If conversion fails OR disk write fails: log error, set `derivativeStatus: 'missing'`, continue commit (R5: never block)
  5. Save original file (existing flow, unchanged)
  6. Update tree.json with new fields
  - **Suppress `hasUnsavedChanges` transitions while commit is in progress** (use the mutex from Phase 0 as the signal)
  - File: `src/contexts/VersionControlContext.tsx`

- [ ] **Build glTF viewer** — Wire `loadGlbFile` from gltf-service.ts:
  - Returns same `{ objects, metadata }` shape with GltfMetadata
  - For metadata: mesh count, triangle count, bounding box
  - **Configure GLTFLoader** to reject external URI references (set resource path to non-existent directory)
  - File: `src/lib/gltf-service.ts`

- [ ] **Switch restoreToCommit to prefer glTF** — When viewing a commit:
  1. Check if derivative exists (via IPC `derivative-file-exists`)
  2. If yes: verify `derivativeSize` matches file on disk, read `.glb`, load via `loadGlbFile()` — fast, no WASM
  3. If no (or size mismatch): fall back to existing `.3dm` loading path (backward compat)
  - **Treat `derivativeStatus: 'present'` as a hint, not a guarantee** — always fall back gracefully
  - File: `src/contexts/VersionControlContext.tsx`

- [ ] **Switch gallery mode to glTF** — Gallery comparison loads `.glb` for each slot:
  - Replace `load3dmFile` calls in gallery loading with `loadGlbFile`
  - Handle mixed states: placeholder for commits without derivatives
  - **Do NOT trigger lazy migration in gallery mode** — only show "Generate preview" placeholder
  - File: `src/components/ModelViewer.tsx`

- [ ] **Keep pullFromCommit on originals** — Disk restore continues to write the original native file (not the glTF). No change needed to the pull-to-disk path.

- [ ] **Update stats overlay** — For glTF-loaded models, show mesh count + triangle count instead of Curves/Surfaces/Polysurfaces. Key on the metadata type to determine which stats to display.
  - File: `src/components/ModelViewer.tsx` (SceneStatsCalculator)

**Success criteria:** Committing a `.3dm` generates both artifacts using the already-loaded scene. The viewer renders from `.glb`. Gallery mode works with resource disposal. Commits with missing derivatives show a placeholder. Pull-to-disk writes the original `.3dm`.

### Research Insights: Performance Budget

| Operation | Current | After (with scene reuse) |
|---|---|---|
| Commit (50MB .3dm) | ~2s (read + delta) | ~2.5s (read + delta + GLTFExporter ~0.5s) |
| Commit memory peak | ~150MB | ~180MB (existing scene + .glb buffer, NO re-parse) |
| View commit | ~2s (rhino3dm WASM) | ~0.1s (GLTFLoader, pure JS) |
| Gallery (4 commits) | ~8s | ~0.4s |

Without scene reuse, commit memory peak would be 210-280MB and time would be 3-5s. Scene reuse is critical.

#### Phase 3: Cloud Sync + Multi-Format Support

**Goal:** Sync derivatives to cloud. Add .ifc and .rvt format support.

**Tasks:**

- [ ] **Update backend S3 validation** — Extend the file key regex to allow `.glb`, `.rvt`, `.ifc`. Also set explicit `Content-Type: application/octet-stream` and `Content-Disposition: attachment` on presigned URLs to prevent browser rendering of uploaded files.
  ```
  /^(tree\.json|commits\/[a-zA-Z0-9_-]+\.(3dm|delta|glb|rvt|ifc))$/
  ```
  - File: `backend/routes/sync.js`

- [ ] **Add server-side tree.json validation** — Validate `originalFormat` is one of `['.3dm', '.rvt', '.ifc']` and `derivativeStatus` is one of `['present', 'missing']` before accepting push. Prevents a compromised client from injecting path-traversal values into `originalFormat`.
  - File: `backend/routes/sync.js`

- [ ] **Extend cloud sync for dual artifacts** — Add `pushDerivativeFile` / `pullDerivativeFile` methods on CloudSyncService (separate from `pushCommitFile`):
  - Use `Promise.allSettled` for original + derivative uploads per commit
  - Add `derivativeSyncedCommitIds` set in CloudSyncContext for tracking partial uploads
  - **Preview-first pull**: when pulling, download .glb first (small), then original in background
  - Use `originalFormat` from tree.json to determine the correct extension for the original
  - If derivative download fails: set local `derivativeStatus: 'missing'`, viewer falls back
  - Files: `src/lib/cloud-sync-service.ts`, `src/contexts/CloudSyncContext.tsx`

- [ ] **Update `downloadFullProject` and `downloadLatestSnapshot`** — These are the entry points for shared project downloads (used by WelcomePanel). Must be updated to:
  1. Read `storageType` from each remote commit to download correct extension (`.3dm` or `.delta` — this is a pre-existing bug)
  2. Download `.glb` derivatives for commits with `derivativeStatus: 'present'`
  - Files: `src/lib/cloud-sync-service.ts`, `src/components/WelcomePanel.tsx`

- [ ] **Add web-ifc dependency** — Install `web-ifc@0.0.77`, bundle WASM to `public/web-ifc/`:
  - Add `copy:web-ifc` npm script (follow rhino3dm bundling pattern)
  - Add to `asarUnpack` in electron-builder config
  - **Initialize lazily** (only when an IFC/RVT file is first opened), NOT eagerly in App.tsx — avoids ~500MB WASM memory when user only works with .3dm
  - Files: `package.json`, `vite.config.ts`

- [ ] **Build IFC conversion service** — Load IFC via web-ifc directly (NOT web-ifc-three):
  - `loadIfcFile(buffer: ArrayBuffer): Promise<LoadedModel>` using `StreamAllMeshes` for memory efficiency
  - **Run IFC parsing in a Web Worker** to isolate from renderer (web-ifc WASM crashes would only kill the worker, not the app)
  - Set timeout (30s) on parsing to prevent infinite loops from malformed IFC
  - **Call `.delete()` on all FlatMesh and IfcGeometry objects** to prevent WASM memory leaks
  - Geometry-only: tessellated mesh + `MeshStandardMaterial` with `DoubleSide`, no BIM properties
  - Then pass scene through existing `sceneToGlb()` for derivative
  - File: create `src/lib/ifc-service.ts`

- [ ] **IFC sidecar auto-detection** — When a `.rvt` is opened, scan the same directory for a matching `.ifc`:
  - Match by basename: `building.rvt` → look for `building.ifc`
  - If multiple candidates: use the one with the matching basename; if none match, pick the most recently modified `.ifc`
  - Re-detect on each commit (the sidecar may have been re-exported)
  - **Security: resolve symlinks with `fs.realpath()` and verify resolved path is within the project directory**
  - **Validate IFC magic bytes** (`ISO-10303-21;` or `STEP;` header) before reading
  - Files: `electron/services/file-storage-service.ts` or new utility

- [ ] **Extend file watcher for IFC sidecar** — Watch both the primary file and IFC sidecar:
  - When the `.ifc` changes: trigger "unsaved changes" indicator
  - Watch only one sidecar file (the detected match), not all `.ifc` files
  - Resolve symlinks before setting up watcher; reject symlinks
  - File: `electron/services/file-watcher.ts`, `electron/main.ts`

- [ ] **Update file dialogs and format gates** — Accept `.rvt` and `.ifc` alongside `.3dm`:
  - Open dialog: `extensions: ['3dm', 'rvt', 'ifc']`
  - `importFile` validation: accept all three
  - Drag-drop filter: accept all three
  - File input `accept` attribute: `.3dm,.rvt,.ifc`
  - macOS `open-file` handler: accept all three
  - CLI arg handler: accept all three
  - Files: `electron/main.ts`, `src/contexts/ModelContext.tsx`, `src/components/ModelViewer.tsx`

- [ ] **Format-aware commit storage** — Use the correct extension for originals:
  - .3dm originals: `commit-{id}.3dm` (unchanged)
  - .rvt originals: `commit-{id}.rvt`
  - .ifc originals: `commit-{id}.ifc`
  - Store `originalFormat` in tree.json per commit
  - **Update `getCommitFilePath`** to accept a format parameter with **strict allowlist validation** inside FileStorageService: `['.3dm', '.rvt', '.ifc', '.delta']`. Strip any path separators.
  - **Cascade the format parameter** through `saveCommitFile`, `readCommitFile`, `commitFileExists`, and the IPC interface
  - Also update `CommitReconstructionService` to pass `originalFormat` through to file reads
  - Files: `electron/services/file-storage-service.ts`, `electron/main.ts`, `electron/preload.ts`, `src/lib/desktop-api.ts`

- [ ] **Storage folder collision guard** — If `building.3dm` and `building.rvt` are in the same directory, both would get `0studio_building/`. Change naming to include extension: `0studio_building_3dm/`, `0studio_building_rvt/`. **Add migration**: on project open, check for old folder name, rename to new naming scheme.
  - File: `electron/services/file-storage-service.ts`

**Success criteria:** A team member can push a project with `.glb` derivatives to cloud, and another team member can pull and immediately view all commits. A `.rvt` file with an IFC sidecar can be opened, committed, viewed, and synced. IFC parsing is isolated in a Web Worker.

#### Phase 4: Migration + Polish

**Goal:** Handle existing projects gracefully. Clean up edge cases.

**Tasks:**

- [ ] **Lazy migration for old commits** — When the viewer loads a commit with no derivative:
  1. Check if a `.3dm` snapshot or delta exists
  2. **If delta: reconstruct the full .3dm first** via `reconstructCommit` before conversion
  3. Convert to `.glb` on-the-fly, save the derivative, update tree.json
  4. Show a brief loading indicator during conversion
  5. If conversion fails: show placeholder
  - **Throttle to concurrency 1** — use a `migratingCommitIds` ref Set to prevent duplicate migrations
  - **Do NOT trigger migration in gallery mode** — only for the single commit being actively viewed
  - Files: `src/contexts/VersionControlContext.tsx`

- [ ] **Derivative retry mechanism** — For commits with `derivativeStatus: 'missing'`:
  - Add a "Regenerate preview" button in the commit detail view
  - On click: read the original (reconstructing from delta chain if needed), run conversion, save derivative, update status
  - Files: `src/components/VersionControl.tsx`

- [ ] **Handle .rvt without IFC sidecar** — When a `.rvt` is opened with no `.ifc`:
  - Allow commits (consistent with R5: never block commits)
  - Show banner: "Export an IFC file from Revit to enable 3D preview"
  - Commits have `derivativeStatus: 'missing'`
  - If IFC appears later: auto-detect on next commit
  - Files: `src/contexts/ModelContext.tsx`, UI component

**Success criteria:** Old projects open without errors; commits lazily generate derivatives (one at a time). Users can retry failed derivatives. `.rvt` files without IFC sidecars degrade gracefully.

## System-Wide Impact

### Interaction Graph

```
User commits → commitModelChanges() [mutex guard]
  → readFileBuffer() (original to disk)
  → sceneToGlb(ModelContext.loadedModel) [reuse loaded scene]
  → saveDerivativeFile() [only if conversion succeeds AND write succeeds]
  → saveCommitFile() (original)
  → updateTreeJson() → debounced auto-save

User views commit → restoreToCommit()
  → derivativeFileExists() → readDerivativeFile() → loadGlbFile()
  → [fallback if missing] → readCommitFile() → load3dmFile()
  → ModelContext.setLoadedModel() → ModelViewer re-renders

Cloud push → pushToCloud() → for each unsyncedCommit:
  → Promise.allSettled([pushCommitFile(original), pushDerivativeFile(glb)])
  → track successes in cloudSyncedCommitIds + derivativeSyncedCommitIds
  → pushTreeJson with ETag lock
```

### Error Propagation

- GLTFExporter failure → caught in commit flow → `derivativeStatus: 'missing'` → commit succeeds → viewer shows placeholder
- `saveDerivativeFile` disk write failure → same path (separate from conversion success)
- web-ifc parse failure → same path. WASM crash in Web Worker → only worker dies, renderer continues
- S3 derivative upload failure → `derivativeSyncedCommitIds` does not include this commit → retry on next push → original sync is not blocked
- Derivative read failure on view → fall back to original file loading path → if that also fails, show error
- Stale `derivativeStatus: 'present'` (file missing) → `derivativeSize` mismatch OR file read returns null → fall back to original

### State Lifecycle Risks

- **Partial commit:** If original saves but derivative write crashes → tree.json should NOT say `derivativeStatus: 'present'`. Mitigation: set `derivativeStatus` only after confirmed `saveDerivativeFile` resolves successfully.
- **Stale derivative:** If user modifies the `.3dm` after committing but before the tree.json save → derivative matches a slightly different version. Mitigation: derivative is generated from the same in-memory scene read at commit time, not from disk again. The commit mutex prevents concurrent modifications.
- **Cloud sync inconsistency:** If original uploads but derivative upload fails → remote has original but no derivative. Mitigation: `derivativeSyncedCommitIds` tracks per-artifact status. Pull side: if `derivativeStatus: 'present'` in tree.json but .glb download returns 404, set local status to `'missing'`.
- **Old app version strips new fields:** If a team member runs an old app that doesn't know about `originalFormat`/`derivativeStatus`, it will strip these fields when saving tree.json. Mitigation: tree.json version bump to `1.1` + warning on version mismatch.

### API Surface Parity

- IPC channels: all new channels (save/read/exists derivative-file) must be added to `preload.ts` AND `desktop-api.ts` AND have `validateProjectPath()` applied
- Cloud sync service: new `pushDerivativeFile` and `pullDerivativeFile` methods (not overloaded `pushCommitFile`)
- Backend: S3 validation regex must allow `.glb` and new original formats. tree.json push must validate `originalFormat` against allowlist.

### Security Considerations

| Area | Risk | Mitigation |
|---|---|---|
| IPC path traversal | Commit storage handlers accept arbitrary paths without validation | Apply `validateProjectPath()` to all storage IPC handlers (Phase 0) |
| IFC sidecar symlinks | Symlinked .ifc could read sensitive files | Resolve symlinks, verify path is within project directory (Phase 3) |
| web-ifc WASM parsing | Malformed IFC could crash renderer or cause OOM | Run in Web Worker with 30s timeout (Phase 3) |
| GLTFLoader URI resolution | Crafted .glb could reference local/external resources | Set empty resource path, reject external URIs (Phase 2) |
| `originalFormat` injection | Malicious tree.json value could cause path traversal | Allowlist validation in FileStorageService AND backend (Phase 3) |
| S3 content type | Uploaded files could be served as HTML (stored XSS) | Set Content-Type: application/octet-stream, Content-Disposition: attachment (Phase 3) |

## Acceptance Criteria

### Functional Requirements

- [ ] A `.3dm` commit produces both `commit-{id}.3dm` and `commit-{id}.glb` in the `0studio_` folder
- [ ] A `.rvt` + `.ifc` sidecar commit produces `commit-{id}.rvt` and `commit-{id}.glb`
- [ ] The viewer renders all commits from `.glb` derivatives, not original format
- [ ] Gallery mode comparison works identically across formats (all comparing glTF)
- [ ] Gallery mode disposes previous Three.js resources before loading new selections
- [ ] Pull-to-disk restores the original native file, not the glTF
- [ ] Cloud sync uploads both original + derivative; pull downloads both
- [ ] Team member pulling sees the viewable immediately (no local regeneration)
- [ ] A commit with failed derivative generation still appears in the commit tree
- [ ] Commits with missing derivatives show a placeholder in the viewer
- [ ] Old projects (pre-dual-artifact) open without errors; derivatives generate lazily (one at a time)
- [ ] `.rvt` files without IFC sidecar can still be committed (derivative missing)
- [ ] Concurrent commit attempts are blocked by the mutex
- [ ] tree.json version is bumped to `1.1`; old app shows warning on version mismatch

### Non-Functional Requirements

- [ ] Commit time increase from glTF generation is < 1 second (with scene reuse)
- [ ] glTF derivative file size is < 20% of original `.3dm` size for typical models (future: Meshopt compression)
- [ ] Viewer load time from `.glb` is faster than current `.3dm` parsing via rhino3dm WASM
- [ ] IFC parsing runs in a Web Worker, not the renderer main thread
- [ ] All storage IPC handlers validate project paths

## Dependencies & Prerequisites

- **Three.js GLTFExporter** must produce acceptable output from rhino3dm-loaded scenes (validate in Phase 1)
- **web-ifc@0.0.77** must support IFC2x3 and IFC4 from Revit exports (validate in Phase 3)
- **GLTFExporter** is available at `three/examples/jsm/exporters/GLTFExporter.js` — already part of the three.js dependency
- **Phase 0 must complete before Phase 1 begins** — commit mutex and gallery fixes are prerequisites

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GLTFExporter produces bad output from rhino3dm scenes | Medium | Critical | Validate in Phase 1 with real user files. Compare bounding boxes programmatically. If it fails, investigate GLTFExporter options or alternative format. |
| Coordinate system double-transform | Medium | High | Phase 1 validation must confirm GLTFLoader does not re-apply Y-up conversion on .glb files that already have it baked in. |
| web-ifc crashes on real Revit IFC exports | Medium | High | Run in Web Worker with timeout. Known issues: missing geometry on complex families, flipped normals. Use DoubleSide material. Graceful failure (R5) limits blast radius. |
| Double-commit race condition | High | High | Phase 0 adds commit mutex. Without it, every added millisecond of glTF conversion widens the race window. |
| Commit time increase is noticeable | Low | Medium | Scene reuse eliminates the WASM re-parse (~1-3s savings). GLTFExporter is ~100-500ms for most models. Well within budget. |
| IPC ArrayBuffer copy overhead | Medium | Medium | For typical models (<50MB .glb), structured clone is acceptable (~100ms). For very large files, consider temp-file IPC pattern in a future optimization pass. |
| chokidar self-triggers on .glb writes | Low | Low | File watcher only watches primary file, not `0studio_` folder. `.glb` exclusion added in Phase 1 as a safety net. |
| Old app version strips tree.json fields | Medium | High | Version bump to `1.1` + warning. Teams should coordinate upgrades. |
| Storage folder naming collision | Low | Low | Guard added in Phase 3 alongside multi-format support. Migration renames old folders. |
| Gallery mode GPU memory leak | High | Medium | Fixed in Phase 0. Without fix, 4 undisposed scenes = 400MB+ GPU memory leak per gallery reload. |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-22-dual-artifact-commit-model-requirements.md](docs/brainstorms/2026-04-22-dual-artifact-commit-model-requirements.md) — Key decisions: glTF as unified viewable format, mesh fidelity acceptable for viewing, IFC sidecar auto-detection for .rvt, never block commits on derivative failure, derivatives synced to cloud.

### Internal References

- Commit storage service: `electron/services/file-storage-service.ts`
- Commit flow: `src/contexts/VersionControlContext.tsx:543-747`
- Model loading: `src/lib/rhino3dm-service.ts`
- Cloud sync: `src/lib/cloud-sync-service.ts`
- Backend S3 validation: `backend/routes/sync.js:12`
- Delta file pattern (template for .glb methods): `electron/services/file-storage-service.ts:57-82`
- WASM bundling pattern: `docs/plans/2026-04-05-001-feat-bundle-rhino3dm-wasm-locally-plan.md`
- Delta compression requirements: `docs/brainstorms/2026-03-30-delta-compression-requirements.md`
- Revit support ideation: `docs/ideation/2026-04-22-revit-support-ideation.md`
- Performance notes (chokidar self-trigger): `docs/ideation/2026-04-05-app-performance-ideation.md`
- Gallery mode loading: `src/components/ModelViewer.tsx:484-527`
- IPC path validation: `electron/main.ts:419-431`

### External References

- Three.js GLTFExporter docs: `node_modules/three/examples/jsm/exporters/GLTFExporter.js`
- Three.js GLTFLoader docs: `node_modules/three/examples/jsm/loaders/GLTFLoader.js`
- web-ifc API (v0.0.77): `StreamAllMeshes`, `GetGeometry`, `SetWasmPath`
- glTF-Transform (future optimization): https://gltf-transform.dev/
- Speckle dual-artifact pattern: https://docs.speckle.systems/developers/server/architecture
- Khronos Asset Creation Guidelines 2.0 (Meshopt recommendation)
