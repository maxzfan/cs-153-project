# Codebase Refactor: Efficiency, Security & Cleanup

**Date:** 2026-03-13

## Goal

Comprehensive refactor of the 0studio codebase to close security gaps, remove dead code and redundant docs, and decompose oversized monoliths into focused modules. Executed in three sequential phases: security first, cleanup second, architecture third.

## Non-Goals

- No new features
- No migration away from Express, Supabase, or Electron
- No automated test suite (placeholder acknowledged, out of scope)
- No changes to the dev-only presence simulation dashboard (`src/dev/`)

---

## Phase 1: Credential Rotation & Security Hardening

### 1a. Credential Cleanup

**Problem:** `.env` and `backend/.env` contain real AWS IAM keys, Supabase service role key, Stripe test key, and Gemini API key committed to git history.

**Actions:**
1. Rotate all exposed keys in their respective services (AWS IAM, Supabase, Stripe, Google Cloud)
2. Verify `.env` and `backend/.env` are in their respective `.gitignore` files (root `.gitignore` covers root `.env`; `backend/.gitignore` covers `backend/.env`). Keep `.env.example` templates.
3. Scrub secrets from git history using `git filter-repo`

**Note:** `git filter-repo` rewrites all commit hashes and requires a force-push. Coordinate with any other clones, branches, or CI pipelines before running. All existing clones will need to be re-cloned after the history rewrite.

### 1b. IPC Path Validation

**Problem:** `readFileBuffer` and `writeFileBuffer` in `electron/main.ts` (lines 330-341) accept arbitrary file paths from the renderer with no validation.

**Actions:**
1. Add a `validateProjectPath(filePath)` helper that:
   - Resolves the path to absolute
   - Checks it falls within the current project directory (`this.currentProjectFile` parent) or the `.0studio/` storage directory
   - Rejects paths containing `..` after normalization
2. Apply validation in both `readFileBuffer` and `writeFileBuffer` before any `fs` operation
3. Throw a descriptive error on rejection

### 1c. Rate Limiting Expansion

**Problem:** `express-rate-limit` only covers `/api/aws` and `/api/projects/:projectId/sync` routes. Project CRUD, member management, and Stripe endpoints are unprotected.

**Actions:**
1. Apply rate limiter as global middleware on all `/api/*` routes (100 req / 15 min default)
2. Remove the existing per-route limiters on `/api/aws` and `/api/projects/:projectId/sync` (now redundant with the global limiter)
3. Add stricter limiter for auth-adjacent endpoints (e.g., invite acceptance) if needed
4. Exempt `/api/stripe/webhook` (Stripe retries on failure, must not be rate-limited)

### 1d. Orphaned Preload Handlers

**Problem:** 7 git-related IPC handlers declared in `electron/preload.ts` (lines 42-48) have no corresponding `ipcMain.handle()` in `main.ts`. Calling them from the renderer hangs indefinitely.

**Actions:**
1. Remove from `preload.ts`: `gitInit`, `gitStatus`, `gitCommit`, `gitPush`, `gitPull`, `gitLog`, `gitCheckout`
2. Remove corresponding wrapper methods from `src/lib/desktop-api.ts` (lines 69-112)
3. Remove corresponding type definitions if any
4. Keep `electron/services/git-service.ts` and `project-service.ts` files untouched (may be wired up later)

### 1e. IPC Listener Cleanup

**Problem:** Preload `on*` handlers (`onProjectOpened`, `onProjectClosed`, `onFileChanged`, etc.) register `ipcRenderer.on()` listeners but provide no way to remove them. Listeners accumulate if renderer components remount.

**Actions:**
1. Change each `on*` handler to return an unsubscribe function:
   ```typescript
   onProjectOpened: (callback) => {
     const handler = (_, project) => callback(project);
     ipcRenderer.on('project-opened', handler);
     return () => ipcRenderer.removeListener('project-opened', handler);
   }
   ```
2. Update `src/lib/desktop-api.ts` wrapper to propagate the unsubscribe pattern
3. Remove the existing `removeAllListeners` method from preload — the per-handler unsubscribe pattern replaces it
4. Update renderer consumers to call unsubscribe on cleanup (useEffect return)

---

## Phase 2: Dead Code & File Cleanup

### 2a. Delete Dead Source Files

| File | Lines | Reason |
|------|-------|--------|
| `src/contexts/VersionControlContext_old.tsx` | 554 | Not imported anywhere, superseded by current context |
| `src/components/VersionControl_old.tsx` | 318 | Not imported anywhere, superseded by current component |

### 2b. Delete Stray Root Files

| File | Reason |
|------|--------|
| `bun.lockb` | Project uses npm, not bun |
| `start.txt` | Redundant with README and CLAUDE.md |

### 2c. Clean Up Docs

| File | Reason |
|------|--------|
| `docs/LOCAL_SETUP.md` | Redundant with `docs/LOCAL_DEV_SETUP.md` |
| `docs/LOCAL_STORAGE_REVAMP.md` | Documents old architecture change, no longer relevant |
| `docs/BACKEND_SETUP_COMPLETE.md` | Redundant with README backend section |

### 2d. Deduplicate Shared Utilities

**Problem:** `getAuthHeaders()` is defined identically in both `src/lib/project-api.ts` (lines 7-20) and `src/lib/cloud-sync-service.ts` (lines 5-17).

**Actions:**
1. Create `src/lib/auth-utils.ts` with the shared `getAuthHeaders()` function
2. Update `project-api.ts` and `cloud-sync-service.ts` to import from `auth-utils.ts`
3. Remove the duplicate definitions

### 2e. Remove Console Statements

**Problem:** ~400+ `console.log`/`console.error`/`console.warn` calls across production source files.

**Actions:**
1. Remove all console statements from production source files (`src/`, `electron/`, `backend/`)
2. Leave console statements in dev-only files (`src/dev/`) untouched

---

## Phase 3: Architecture Decomposition

### 3a. VersionControlContext Split

**Problem:** `src/contexts/VersionControlContext.tsx` is 1,578 lines handling commits, branching, cloud sync, gallery mode, local persistence, and presence updates.

**Target structure (3 contexts):**

| Context | Responsibility | Estimated Size |
|---------|---------------|----------------|
| `VersionControlContext` | Commit tree, branches, current commit navigation, local `.0studio/` persistence via IPC, presence integration | ~700 lines |
| `CloudSyncContext` | Cloud project state, sync operations, `cloudSyncedCommitIds`, presigned URL orchestration. Consumes `VersionControlContext` for commit data. | ~500 lines |
| `GalleryContext` | Gallery mode selection state (compare up to 4 versions). Consumes `VersionControlContext` for commit references. | ~200 lines |

**Complete provider nesting in `App.tsx`:**
```
AuthProvider
  RecentProjectsProvider
    HashRouter
      PresenceProvider
        VersionControlProvider
          CloudSyncProvider
            GalleryProvider
              ModelProvider
                ...
```

`RecentProjectsProvider` and `HashRouter` are preserved from the current nesting — they do not depend on the new contexts.

**Interface boundaries:**
- `CloudSyncContext` reads commit tree and branch state from `VersionControlContext`, exposes sync status and operations
- `GalleryContext` reads commit list from `VersionControlContext`, exposes selection state and comparison operations
- Presence integration (3 calls to `usePresence()`) stays in `VersionControlContext`

### 3b. ModelViewer Extraction

**Problem:** `src/components/ModelViewer.tsx` is 1,160 lines with a nested `WelcomePanel` sub-component containing its own state management and shared project fetching.

**Actions:**
1. Extract `WelcomePanel` into `src/components/WelcomePanel.tsx`
2. Move associated state and project fetching logic with it
3. `ModelViewer` imports and renders `<WelcomePanel />` where it was previously inlined

### 3c. Backend Route Split

**Problem:** `backend/server.js` is 1,495 lines with all 26 routes, middleware, and business logic in one file.

**Target structure:**

```
backend/
  server.js              — app setup, global middleware, health endpoint, error handler, server start (~100 lines)
  middleware/
    auth.js              — verifyAuth(), validateS3Key(), checkProjectPermission()
  lib/
    utils.js             — escapeHtml(), resolvePendingInvites(), sendProjectInviteEmail(), ensureS3Cors()
  routes/
    s3.js                — GET /api/aws/presigned-upload, presigned-download, list-versions, DELETE delete-version
    projects.js          — POST/GET /api/projects, /api/projects/:projectId/members/*
    sync.js              — POST/GET /api/projects/:projectId/sync/*
    stripe.js            — POST /api/stripe/create-checkout-session, webhook, create-subscription-intent, GET payment-status
```

**Conventions:**
- Each route file exports an Express Router
- `server.js` imports and mounts routers: `app.use('/api/aws', s3Router)`, etc.
- `GET /health` and the global error handler stay in `server.js` (infrastructure, not business logic)
- `ensureS3Cors()` is called from `server.js` at startup, imported from `lib/utils.js`
- Shared middleware and helpers imported from `middleware/auth.js` and `lib/utils.js`
- No behavior changes — same API surface, same responses

**Stripe webhook caveat:** The webhook route requires `express.raw()` for Stripe signature verification. The global `express.json()` will consume the body before the stripe router sees it. To fix this, mount `app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))` in `server.js` _before_ the global `app.use(express.json())` call.

### 3d. AWS SDK Version Alignment

**Problem:** `@aws-sdk/client-ses` is at v3.988.0 while `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are at v3.490.0.

**Action:** Bump all three AWS SDK packages to the same latest version.

---

## Execution Order

All work happens on a single branch, committed phase by phase:

1. Phase 1a (credentials) — manual key rotation + git history scrub
2. Phase 1b-1e (security code changes) — single commit
3. Phase 2a-2c (deletions) — single commit
4. Phase 2d (dedup utilities) — single commit
5. Phase 2e (console removal) — single commit
6. Phase 3a (VersionControlContext split) — single commit
7. Phase 3b (ModelViewer extraction) — single commit
8. Phase 3c (backend route split) — single commit
9. Phase 3d (AWS SDK alignment) — single commit

Each commit should leave the app in a working state. Manual verification after each phase.

---

## Files Affected

### Modified
- `electron/main.ts` — path validation (1b), listener cleanup pattern (1e)
- `electron/preload.ts` — remove git handlers (1d), remove `removeAllListeners` (1e), unsubscribe pattern (1e)
- `src/lib/desktop-api.ts` — remove git wrapper methods and types (1d), propagate unsubscribe pattern (1e)
- `src/vite-env.d.ts` — update `removeAllListeners` type, update `on*` return types to unsubscribe functions (1e)
- `src/contexts/ModelContext.tsx` — migrate `removeAllListeners` calls to per-handler unsubscribe (1e), console removal (2e)
- `src/contexts/VersionControlContext.tsx` — decompose (3a), console removal (2e)
- `src/components/ModelViewer.tsx` — extract WelcomePanel (3b), console removal (2e)
- `src/components/VersionControl.tsx` — consume new CloudSyncContext and GalleryContext (3a), console removal (2e)
- `src/lib/project-api.ts` — use shared auth-utils (2d), console removal (2e)
- `src/lib/cloud-sync-service.ts` — use shared auth-utils (2d), console removal (2e)
- `src/App.tsx` — update provider nesting with CloudSyncProvider and GalleryProvider (3a)
- `backend/server.js` — route split (3c), rate limiting (1c), console removal (2e)
- `backend/package.json` — AWS SDK version bump (3d)
- `.gitignore` — ensure .env files listed (1a)
- All other `src/` and `electron/` files with console statements — console removal (2e)

### Created
- `src/lib/auth-utils.ts` (2d)
- `src/contexts/CloudSyncContext.tsx` (3a)
- `src/contexts/GalleryContext.tsx` (3a)
- `src/components/WelcomePanel.tsx` (3b)
- `backend/middleware/auth.js` (3c)
- `backend/lib/utils.js` (3c)
- `backend/routes/s3.js` (3c)
- `backend/routes/projects.js` (3c)
- `backend/routes/sync.js` (3c)
- `backend/routes/stripe.js` (3c)

### Deleted
- `src/contexts/VersionControlContext_old.tsx` (2a)
- `src/components/VersionControl_old.tsx` (2a)
- `bun.lockb` (2b)
- `start.txt` (2b)
- `docs/LOCAL_SETUP.md` (2c)
- `docs/LOCAL_STORAGE_REVAMP.md` (2c)
- `docs/BACKEND_SETUP_COMPLETE.md` (2c)
