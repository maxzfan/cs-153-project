---
date: 2026-03-30
topic: open-ideation
focus: none
---

# Ideation: 0studio Open-Ended Improvement Ideas

## Codebase Context

0studio is an Electron desktop app for Rhino 3D model version control with cloud sync. React 18 + Three.js frontend, Express backend, Supabase auth/realtime, Stripe payments, S3 storage. Three-process architecture (Electron main, renderer, Express backend). Seven nested React Contexts. IPC bridge requires 3-file edits per channel. No automated tests. Commits stored as full .3dm snapshots locally (.0studio/) and in S3.

## Ranked Ideas

### 1. Geometric Diff Visualization
**Description:** When comparing two commits in gallery mode, compute and highlight the actual geometric difference — new surfaces in green, removed in red, unchanged in grey. The rhino3dm SDK and Three.js scene graphs are already loaded per-commit in gallery mode.
**Rationale:** Version control without diff is just a backup system. Core differentiator for 3D-native VCS.
**Downsides:** Mesh-level diffing for complex NURBS geometry is non-trivial. Object identity across saves isn't guaranteed.
**Confidence:** 75%
**Complexity:** High
**Status:** Unexplored

### 2. Auto-Commit on File Save
**Description:** Wire the existing FileWatcherService to auto-snapshot on every detected file change (debounced), generating commits like "Auto-save 2:34 PM." Users can retroactively promote auto-saves to named commits.
**Rationale:** Biggest adoption barrier for VCS in creative tools is the interruption cost. Passive capture matches how designers work.
**Downsides:** Disk usage compounds fast without delta compression. Commit tree noise needs UI distinction.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 3. Delta Compression for Commit Storage
**Description:** Replace full .3dm snapshots per commit with binary deltas from periodic base snapshots. Applies to both local .0studio/ storage and S3 uploads.
**Rationale:** Existential for scaling. 50 iterations on a 200MB model = 10GB. Ceiling for auto-commit, long histories, and team use.
**Downsides:** Reconstruction latency for deep delta chains. Binary .3dm diffing may have poor compression ratios.
**Confidence:** 60%
**Complexity:** High
**Status:** Explored

### 4. Shareable Web Viewer ("Proposal Mode")
**Description:** One-click export of any branch/commit to a read-only web URL with a lightweight Three.js viewer. Uses CDN-hosted rhino3dm WASM and signed S3 URLs. No Rhino license required.
**Rationale:** Turns 0studio from internal version tracker into client communication tool. Clear premium feature.
**Downsides:** Public-facing security surface. Signed URL expiration management.
**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

### 5. Offline-First Sync Queue with Auto-Drain
**Description:** Persistent commit queue buffers local commits when offline. CloudSyncContext auto-drains when connectivity resumes with conflict detection.
**Rationale:** Architects work on-site with spotty connectivity. The seam between FileStorageService and CloudSyncContext already exists.
**Downsides:** Conflict resolution at drain time is the hard problem.
**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

### 6. tree.json Integrity Guard + Cloud Recovery
**Description:** Atomic writes (tmp + rename) plus "rebuild tree from cloud" via Supabase commit metadata.
**Rationale:** tree.json is the single point of failure for local version history. Unrecoverable data loss is existential.
**Downsides:** Cloud rebuild requires Supabase metadata to be authoritative.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 7. Commit-time Layer/Object Manifest
**Description:** Extract lightweight JSON manifest (layer names, object GUIDs, types, bounding boxes) at commit time. Enables searching, diffing, and summaries without parsing full .3dm.
**Rationale:** Foundation for every future semantic feature (diff, search, summaries). Highest-leverage infrastructure.
**Downsides:** Increases commit time slightly. Schema must be forward-compatible.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | IPC Channel Code Generator | Low leverage for a small team |
| 2 | Unified Build Pipeline | Dev comfort, not product value |
| 3 | Context Collapse to Zustand/Jotai | Internal refactor, no user-facing value alone |
| 4 | Commit Message Suggestions | Low urgency, won't change behavior |
| 5 | Presence Follow Mode | Teams rarely online simultaneously |
| 6 | Grasshopper Parameter Capture | Niche — most users don't use GH |
| 7 | Git-Friendly .0studio Metadata | Confuses product identity |
| 8 | Invert Sync (Auto-Push) | Silent conflict risk for multi-user |
| 9 | Persistent Authorship on Commits | Too small standalone |
| 10 | Gallery Timeline Export | Lower leverage than web viewer |
| 11 | Unified Feature Flag Registry | Internal tooling |
| 12 | Dev Bootstrap Script | Contributor DX, not user value |
| 13 | Backend Schema Validation | Hygiene, not product idea |
| 14 | Complexity Velocity Metric | No proven demand |
| 15 | Uniform Rate Limiting | Security hygiene |
| 16 | Collapse Backend into Electron | Massive risk for working system |
| 17 | Storage Pruning UI | Reactive to unproven problem |
| 18 | Presence Conflict Warnings | Overlaps offline sync queue |
| 19 | Speculative Background Upload | Complex for marginal gain |
| 20 | Gallery Streaming LOD | Premature optimization |
| 21 | Docs Consolidation | Low leverage relative to survivors |

## Session Log
- 2026-03-30: Initial ideation — 48 raw candidates from 6 frames, 28 unique after dedupe, 7 survived. Brainstorming #3 (Delta Compression) with STEP file angle.
