---
date: 2026-03-30
topic: delta-compression
---

# Delta Compression for Commit Storage

## Problem Frame

Every commit in 0studio stores a full `.3dm` binary snapshot — both locally in `.0studio/` and in S3 via cloud sync. For a project iterated 50 times on a 200MB model, this costs 10GB in S3 storage and makes push/pull painfully slow on large models. The primary pain is **S3 costs and sync speed** — cloud storage grows linearly with commit count regardless of how little changed between versions.

## Requirements

- R1. New commits store only the changed geometry objects relative to their parent commit, not a full `.3dm` snapshot. The delta is computed at the **object level** using rhino3dm's object enumeration (GUIDs, geometry type, vertex data), not binary diffing.

- R2. Each new branch starts with a **full base snapshot**. Deltas within a branch are computed relative to the branch's base snapshot (or the chain of deltas from it). No other periodic base snapshot scheduling is required.

- R3. Any commit can be **reconstructed** by applying its delta chain forward from the nearest base snapshot. Reconstruction must be transparent — gallery mode, restore, and export produce the same `.3dm` output as if the full file were stored.

- R4. Cloud sync uploads only the delta payload for delta commits and the full `.3dm` for base snapshots. Push/pull bandwidth is proportional to what changed, not the full file size.

- R5. The delta system is **forward-only** — existing commits already stored as full `.3dm` snapshots (locally and in S3) are not migrated. Only new commits use delta storage.

- R6. Delta compression is **invisible to the user**. No new UI surfaces, no "what changed" view. Same commit flow, same gallery mode, same restore behavior. The storage format is an internal optimization.

- R7. At commit time, a **per-object manifest** is extracted (object GUIDs + geometry hashes) and stored in `tree.json` or a sidecar. This manifest powers the delta comparison without needing to parse the full `.3dm` of the parent commit.

## Success Criteria

- S3 storage growth per commit drops by 70%+ for typical workflows (modify a few objects in a large model)
- Push time for a commit that changed 5% of objects is proportional to that 5%, not the full file
- No user-visible behavior change — commit, restore, gallery, and export work identically
- Graceful fallback: if delta reconstruction fails, the system can re-download or re-store the full `.3dm`

## Scope Boundaries

- No user-facing "what changed" view (future iteration can use the manifest data)
- No migration of existing commits — forward-only
- No STEP file conversion — rhino3dm object-level diffing is the approach (STEP was considered but rejected: requires OpenCascade WASM, lossy round-trip, and .3dm files must be preserved anyway)
- No auto-commit integration in this scope (auto-commit can build on this later)
- No local storage optimization in this scope — primary target is S3/cloud sync (local deltas are a bonus)

## Key Decisions

- **Object-level delta via rhino3dm over binary delta**: Object GUIDs are stable in the target user workflow (users mostly modify existing geometry, not delete-and-recreate). This gives semantic deltas with high compression ratios. Binary diff (bsdiff/xdelta) was rejected because patches are opaque and compression ratio is unpredictable for structured binary formats.
- **STEP as diffable layer rejected**: rhino3dm WASM doesn't support STEP export. Would require OpenCascade WASM (heavy dependency). .3dm-to-STEP round-trip is lossy (render meshes, user data, custom attributes lost). STEP files can be larger than .3dm for mesh-heavy models. Full .3dm must still be stored for fidelity, so STEP adds cost without replacing .3dm.
- **Base snapshots on branch creation only**: Maps cleanly to the existing branch model. Each branch is self-contained. Avoids arbitrary cadence tuning. Tradeoff: long-lived branches with many commits will have longer delta chains — acceptable given stable-GUID workflows produce small deltas.
- **Forward-only migration**: No risk of corrupting existing data. Simplifies rollout. Old commits remain as full snapshots indefinitely.

## Dependencies / Assumptions

- rhino3dm v8.4.0 WASM can reliably enumerate object GUIDs and geometry data at commit time (needs validation during planning)
- Object GUIDs are stable across typical Rhino save cycles (confirmed by user for target workflow)
- tree.json schema can be extended to include per-commit manifests without breaking existing clients
- S3 presigned URL pipeline can handle variable-size payloads (delta blobs vs full .3dm) without changes to the backend signing logic

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R1][Needs research] What is the exact rhino3dm API for enumerating objects and their GUIDs from a `.3dm` buffer in the Electron/WASM context? Can geometry be hashed deterministically?
- [Affects R1][Technical] What format should delta payloads use — partial `.3dm` files containing only changed objects, or a custom serialization of individual geometry blobs?
- [Affects R3][Technical] How should delta reconstruction work in the renderer — reassemble a full `.3dm` buffer before loading into Three.js, or load base + apply object-level patches to the scene graph directly?
- [Affects R4][Technical] Should delta payloads be compressed (e.g., zstd) before S3 upload for additional bandwidth savings?
- [Affects R7][Technical] Where should the per-object manifest live — inline in tree.json, or in a separate `.manifest.json` sidecar per commit?
- [Affects R2][Technical] Should the delta chain length be capped (e.g., max 20 deltas before forcing a new base) as a safety valve for very long-lived branches?

## Next Steps

-> `/ce:plan` for structured implementation planning
