# Codebase Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close security gaps, remove dead code and redundant docs, and decompose oversized monoliths into focused modules across the Electron, React, and Express layers.

**Architecture:** Three sequential phases — security hardening first, dead code cleanup second, architecture decomposition third. Each phase produces one or more commits, and the app should remain functional after each.

**Tech Stack:** Electron, React (TypeScript), Express (Node.js), Supabase, AWS S3, Stripe

**Spec:** `docs/superpowers/specs/2026-03-13-codebase-refactor-design.md`

---

## File Structure

### Files to Create
- `src/lib/auth-utils.ts` — shared `getAuthHeaders()` function
- `src/contexts/CloudSyncContext.tsx` — cloud sync state and operations (extracted from VersionControlContext)
- `src/contexts/GalleryContext.tsx` — gallery mode selection state (extracted from VersionControlContext)
- `src/components/WelcomePanel.tsx` — welcome panel component (extracted from ModelViewer)
- `backend/middleware/auth.js` — `verifyAuth()`, `validateS3Key()`, `checkProjectPermission()`
- `backend/lib/utils.js` — `escapeHtml()`, `resolvePendingInvites()`, `sendProjectInviteEmail()`, `ensureS3Cors()`
- `backend/routes/s3.js` — S3 presigned URL routes
- `backend/routes/projects.js` — project CRUD + member management routes
- `backend/routes/sync.js` — cloud sync routes
- `backend/routes/stripe.js` — Stripe payment + webhook routes

### Files to Modify
- `electron/main.ts` — add path validation helper, update listener pattern
- `electron/preload.ts` — remove git handlers, update `on*` to return unsubscribe, remove `removeAllListeners`
- `src/vite-env.d.ts` — remove git types, update `on*` return types, remove `removeAllListeners` type
- `src/lib/desktop-api.ts` — remove git methods/types, update `on*` to return unsubscribe, remove `removeAllListeners`
- `src/contexts/VersionControlContext.tsx` — migrate `removeAllListeners`, extract cloud sync + gallery → decompose
- `src/contexts/ModelContext.tsx` — migrate `removeAllListeners` to per-handler unsubscribe
- `src/components/VersionControl.tsx` — consume new CloudSyncContext and GalleryContext
- `src/components/ModelViewer.tsx` — extract WelcomePanel
- `src/lib/project-api.ts` — use shared auth-utils
- `src/lib/cloud-sync-service.ts` — use shared auth-utils
- `src/App.tsx` — add CloudSyncProvider + GalleryProvider to nesting
- `backend/server.js` — global rate limiting, route split to shell
- `backend/package.json` — AWS SDK version alignment
- `.gitignore` — verify .env coverage
- All `src/`, `electron/`, `backend/` files — console statement removal

### Files to Delete
- `src/contexts/VersionControlContext_old.tsx`
- `src/components/VersionControl_old.tsx`
- `bun.lockb`
- `start.txt`
- `docs/LOCAL_SETUP.md`
- `docs/LOCAL_STORAGE_REVAMP.md`
- `docs/BACKEND_SETUP_COMPLETE.md`

---

## Chunk 1: Phase 1 — Security Hardening

### Task 0: Credential Rotation (Manual — Out of Band)

**Note:** This task requires manual action in external service dashboards and is not automatable. The implementer should complete this before starting code changes.

- [ ] **Step 1: Rotate AWS IAM credentials** — Go to AWS IAM console, deactivate the exposed key (`AKIAX2HNZFYR4B377C5A`), create a new access key, update `backend/.env`
- [ ] **Step 2: Rotate Supabase service role key** — Go to Supabase Dashboard → Settings → API, regenerate the service role key, update `backend/.env`
- [ ] **Step 3: Rotate Stripe test key** — Go to Stripe Dashboard → Developers → API keys, roll the test secret key, update `backend/.env`
- [ ] **Step 4: Rotate Gemini API key** — Go to Google Cloud Console → API & Services → Credentials, delete the exposed key, create a new one, update `.env`
- [ ] **Step 5: Rotate Supabase anon key** — Go to Supabase Dashboard → Settings → API, regenerate anon key, update `.env`
- [ ] **Step 6: Scrub secrets from git history**

```bash
pip install git-filter-repo  # if not installed
git filter-repo --path .env --path backend/.env --invert-paths --force
git push --force --all
```

**Warning:** This rewrites all commit hashes. All existing clones must be re-cloned after this.

---

### Task 1: Verify .gitignore Coverage

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Check .gitignore for .env coverage**

Open `.gitignore` and verify it contains `.env` (it does — line 7). The root `.gitignore` pattern `.env` matches at any directory level in git, so `backend/.env` is also covered. Also verify `backend/.gitignore` exists and covers `.env`.

Run: `cat .gitignore | grep -i env && cat backend/.gitignore | grep -i env`

- [ ] **Step 2: Verify .env files are not tracked**

Run: `git ls-files --cached | grep '.env'`
Expected: No output (files are not tracked). If files appear, run `git rm --cached .env backend/.env`.

- [ ] **Step 3: Commit if any changes were needed**

```bash
git add .gitignore
git commit -m "fix: ensure .env files are properly gitignored"
```

---

### Task 2: IPC Path Validation

**Files:**
- Modify: `electron/main.ts:326-341`

- [ ] **Step 1: Add validateProjectPath helper**

Add this method to the `RhinoStudio` class in `electron/main.ts`, before the `readFileBuffer` method (before line 330):

Note: `resolve` and `dirname` are already imported at the top of `main.ts` from `'path'` (as `join` and `dirname`). Add `resolve` to that import if not present.

```typescript
private validateProjectPath(filePath: string): void {
  if (!this.currentProjectFile) {
    throw new Error('No project is currently open');
  }

  const { resolve } = await import('path');
  const projectDir = dirname(this.currentProjectFile);
  const resolvedPath = resolve(filePath);
  const resolvedProjectDir = resolve(projectDir);

  // Allow the project file itself, or any path within the project directory
  if (resolvedPath !== resolve(this.currentProjectFile) &&
      !resolvedPath.startsWith(resolvedProjectDir + '/')) {
    throw new Error(`Path "${filePath}" is outside the project directory`);
  }
}
```

- [ ] **Step 2: Apply validation in readFileBuffer**

Replace `readFileBuffer` at line 330-334 with:

```typescript
private async readFileBuffer(filePath: string): Promise<ArrayBuffer> {
  this.validateProjectPath(filePath);
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
```

- [ ] **Step 3: Apply validation in writeFileBuffer**

Replace `writeFileBuffer` at line 336-341 with:

```typescript
private async writeFileBuffer(filePath: string, buffer: ArrayBuffer): Promise<void> {
  this.validateProjectPath(filePath);
  const fsPromises = await import('fs/promises');
  const nodeBuffer = Buffer.from(buffer);
  await fsPromises.writeFile(filePath, nodeBuffer);
}
```

- [ ] **Step 4: Verify Electron compiles**

Run: `npm run build:electron`
Expected: Compiles without errors.

---

### Task 3: Rate Limiting Expansion

**Files:**
- Modify: `backend/server.js:198-205`

- [ ] **Step 1: Apply global rate limiter and exempt webhook**

In `backend/server.js`, replace lines 198-205:

```javascript
// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/aws', limiter);
```

With:

```javascript
// Rate limiting — global for all API routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  // req.path is relative to mount point, so /api/stripe/webhook becomes /stripe/webhook
  skip: (req) => req.originalUrl === '/api/stripe/webhook',
});

app.use('/api', limiter);
```

- [ ] **Step 2: Remove the per-route sync limiter**

Search for any other `limiter` usage on sync routes (around line 847) and remove it. The global limiter now covers all `/api/*` routes.

- [ ] **Step 3: Verify backend starts**

Run: `cd backend && node server.js`
Expected: Server starts without errors. Ctrl+C to stop.

---

### Task 4: Remove Orphaned Git IPC Handlers

**Files:**
- Modify: `electron/preload.ts:15-30, 42-48, 113-119`
- Modify: `src/lib/desktop-api.ts:16-34, 69-112`
- Modify: `src/vite-env.d.ts:15-32, 42-48`

- [ ] **Step 1: Remove git handlers from preload.ts**

In `electron/preload.ts`, remove lines 42-48 (the 7 git handler declarations):

```typescript
  // DELETE THESE LINES:
  gitInit: (projectPath: string) => ipcRenderer.invoke('git-init', projectPath),
  gitStatus: () => ipcRenderer.invoke('git-status'),
  gitCommit: (message: string, files: string[]) => ipcRenderer.invoke('git-commit', message, files),
  gitPush: () => ipcRenderer.invoke('git-push'),
  gitPull: () => ipcRenderer.invoke('git-pull'),
  gitLog: () => ipcRenderer.invoke('git-log'),
  gitCheckout: (commitHash: string) => ipcRenderer.invoke('git-checkout', commitHash),
```

- [ ] **Step 2: Remove git type interfaces from preload.ts**

Remove the `GitStatus` interface (lines 15-23) and `GitCommit` interface (lines 25-30).

Also remove the git type declarations from the `Window` interface block (lines 113-119):

```typescript
  // DELETE THESE LINES:
  gitInit: (projectPath: string) => Promise<void>;
  gitStatus: () => Promise<GitStatus>;
  gitCommit: (message: string, files: string[]) => Promise<void>;
  gitPush: () => Promise<void>;
  gitPull: () => Promise<void>;
  gitLog: () => Promise<GitCommit[]>;
  gitCheckout: (commitHash: string) => Promise<void>;
```

- [ ] **Step 3: Remove git types and methods from desktop-api.ts**

In `src/lib/desktop-api.ts`, remove:
- `GitStatus` interface (lines 16-25)
- `GitCommit` interface (lines 27-34)
- All git methods (lines 68-112): `gitInit`, `gitStatus`, `gitCommit`, `gitPush`, `gitPull`, `gitLog`, `gitCheckout`

- [ ] **Step 4: Remove git types from vite-env.d.ts**

In `src/vite-env.d.ts`, remove:
- `GitStatus` interface (lines 15-25)
- `GitCommit` interface (lines 27-32)
- Git type declarations in the Window interface (lines 42-48):

```typescript
  // DELETE THESE LINES:
  gitInit: (projectPath: string) => Promise<void>;
  gitStatus: () => Promise<GitStatus>;
  gitCommit: (message: string, files: string[]) => Promise<void>;
  gitPush: () => Promise<void>;
  gitPull: () => Promise<void>;
  gitLog: () => Promise<GitCommit[]>;
  gitCheckout: (commitHash: string) => Promise<void>;
```

- [ ] **Step 5: Verify compilation**

Run: `npm run build:electron && npx tsc --noEmit`
Expected: No errors.

---

### Task 5: IPC Listener Unsubscribe Pattern

**Files:**
- Modify: `electron/preload.ts:78-101`
- Modify: `src/lib/desktop-api.ts:183-212`
- Modify: `src/vite-env.d.ts:65-70`
- Modify: `src/contexts/VersionControlContext.tsx:621-625, 1034-1038`
- Modify: `src/contexts/ModelContext.tsx:218-222, 244-248`

- [ ] **Step 1: Update preload.ts on* handlers to return unsubscribe functions**

In `electron/preload.ts`, replace the event listener section (lines 78-101) with:

```typescript
  // Event listeners — each returns an unsubscribe function
  onProjectOpened: (callback: (project: ProjectInfo) => void) => {
    const handler = (_: any, project: ProjectInfo) => callback(project);
    ipcRenderer.on('project-opened', handler);
    return () => ipcRenderer.removeListener('project-opened', handler);
  },

  onProjectClosed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('project-closed', handler);
    return () => ipcRenderer.removeListener('project-closed', handler);
  },

  onFileChanged: (callback: (event: FileChangeEvent) => void) => {
    const handler = (_: any, event: FileChangeEvent) => callback(event);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },

  onShowCommitDialog: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('show-commit-dialog', handler);
    return () => ipcRenderer.removeListener('show-commit-dialog', handler);
  },

  onGitOperationComplete: (callback: (operation: string) => void) => {
    const handler = (_: any, operation: string) => callback(operation);
    ipcRenderer.on('git-operation-complete', handler);
    return () => ipcRenderer.removeListener('git-operation-complete', handler);
  },
```

Remove the `removeAllListeners` method (lines 99-101).

- [ ] **Step 2: Update preload.ts Window interface types**

In the `declare global` block of `electron/preload.ts`, update the `on*` return types from `void` to `() => void` and remove `removeAllListeners`:

```typescript
  onProjectOpened: (callback: (project: ProjectInfo) => void) => () => void;
  onProjectClosed: (callback: () => void) => () => void;
  onFileChanged: (callback: (event: FileChangeEvent) => void) => () => void;
  onShowCommitDialog: (callback: () => void) => () => void;
  onGitOperationComplete: (callback: (operation: string) => void) => () => void;
  // removeAllListeners: REMOVED
```

- [ ] **Step 3: Update vite-env.d.ts types**

In `src/vite-env.d.ts`, update the `on*` return types from `void` to `() => void` and remove `removeAllListeners`:

```typescript
  onProjectOpened: (callback: (project: ProjectInfo) => void) => () => void;
  onProjectClosed: (callback: () => void) => () => void;
  onFileChanged: (callback: (event: FileChangeEvent) => void) => () => void;
  onShowCommitDialog: (callback: () => void) => () => void;
  onGitOperationComplete: (callback: (operation: string) => void) => () => void;
  // removeAllListeners line: DELETE
```

- [ ] **Step 4: Update desktop-api.ts on* methods to return unsubscribe**

In `src/lib/desktop-api.ts`, update each `on*` method to return `(() => void) | undefined` and propagate the unsubscribe. Also remove `removeAllListeners`:

```typescript
  // Event Listeners
  onProjectOpened(callback: (project: ProjectInfo) => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onProjectOpened(callback);
  }

  onProjectClosed(callback: () => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onProjectClosed(callback);
  }

  onFileChanged(callback: (event: FileChangeEvent) => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onFileChanged(callback);
  }

  onShowCommitDialog(callback: () => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onShowCommitDialog(callback);
  }

  onGitOperationComplete(callback: (operation: string) => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onGitOperationComplete(callback);
  }

  // DELETE removeAllListeners method entirely (lines 209-212)
```

- [ ] **Step 5: Migrate VersionControlContext.tsx removeAllListeners calls**

In `src/contexts/VersionControlContext.tsx`, update the two `removeAllListeners` cleanup patterns.

At line ~621-625, replace:
```typescript
    return () => {
      desktopAPI.removeAllListeners('file-changed');
    };
```
With a pattern that captures the unsubscribe from the registration. Find where `desktopAPI.onFileChanged(...)` is called earlier in the same useEffect, and capture the return:
```typescript
    const unsubFileChanged = desktopAPI.onFileChanged(/* existing callback */);
    // ... rest of effect ...
    return () => {
      unsubFileChanged?.();
    };
```

At line ~1034-1038, replace:
```typescript
    return () => {
      desktopAPI.removeAllListeners('project-closed');
    };
```
With:
```typescript
    const unsubProjectClosed = desktopAPI.onProjectClosed(/* existing callback */);
    // ... rest of effect ...
    return () => {
      unsubProjectClosed?.();
    };
```

- [ ] **Step 6: Migrate ModelContext.tsx removeAllListeners calls**

In `src/contexts/ModelContext.tsx`, same pattern for two effects:

At line ~218-222 (project-opened listener), capture unsubscribe:
```typescript
    const unsubProjectOpened = desktopAPI.onProjectOpened(/* existing callback */);
    return () => {
      unsubProjectOpened?.();
    };
```

At line ~244-248 (file-changed listener), capture unsubscribe:
```typescript
    const unsubFileChanged = desktopAPI.onFileChanged(/* existing callback */);
    return () => {
      unsubFileChanged?.();
    };
```

- [ ] **Step 7: Verify compilation**

Run: `npm run build:electron && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit Phase 1 security changes**

```bash
git add electron/main.ts electron/preload.ts src/lib/desktop-api.ts src/vite-env.d.ts src/contexts/VersionControlContext.tsx src/contexts/ModelContext.tsx backend/server.js .gitignore
git commit -m "security: add IPC path validation, global rate limiting, listener cleanup, remove orphaned git handlers"
```

---

## Chunk 2: Phase 2 — Dead Code & File Cleanup

### Task 6: Delete Dead Files

**Files:**
- Delete: `src/contexts/VersionControlContext_old.tsx`
- Delete: `src/components/VersionControl_old.tsx`
- Delete: `bun.lockb`
- Delete: `start.txt`
- Delete: `docs/LOCAL_SETUP.md`
- Delete: `docs/LOCAL_STORAGE_REVAMP.md`
- Delete: `docs/BACKEND_SETUP_COMPLETE.md`

- [ ] **Step 1: Verify files are unused**

Run: `grep -r "VersionControlContext_old\|VersionControl_old" src/ --include="*.ts" --include="*.tsx" | grep -v "_old.tsx"`
Expected: No output (not imported anywhere).

- [ ] **Step 2: Delete all dead files**

```bash
rm src/contexts/VersionControlContext_old.tsx
rm src/components/VersionControl_old.tsx
rm bun.lockb
rm start.txt
rm docs/LOCAL_SETUP.md
rm docs/LOCAL_STORAGE_REVAMP.md
rm docs/BACKEND_SETUP_COMPLETE.md
```

- [ ] **Step 3: Verify compilation still works**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit deletions**

```bash
git add -u
git commit -m "cleanup: remove dead code, stray files, and redundant docs"
```

---

### Task 7: Deduplicate getAuthHeaders

**Files:**
- Create: `src/lib/auth-utils.ts`
- Modify: `src/lib/project-api.ts:7-20`
- Modify: `src/lib/cloud-sync-service.ts:5-17`

- [ ] **Step 1: Create shared auth-utils.ts**

Create `src/lib/auth-utils.ts`:

```typescript
export async function getAuthHeaders(): Promise<HeadersInit> {
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}
```

- [ ] **Step 2: Update project-api.ts**

In `src/lib/project-api.ts`, replace the local `getAuthHeaders` function (lines 7-20) with an import:

```typescript
import { getAuthHeaders } from './auth-utils';
```

Remove the entire `async function getAuthHeaders()` block.

- [ ] **Step 3: Update cloud-sync-service.ts**

In `src/lib/cloud-sync-service.ts`, replace the local `getAuthHeaders` function (lines 5-17) with an import:

```typescript
import { getAuthHeaders } from './auth-utils';
```

Remove the entire `async function getAuthHeaders()` block.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-utils.ts src/lib/project-api.ts src/lib/cloud-sync-service.ts
git commit -m "refactor: extract shared getAuthHeaders to auth-utils.ts"
```

---

### Task 8: Remove Console Statements

**Files:**
- Modify: All `src/`, `electron/`, `backend/` files (excluding `src/dev/`)

- [ ] **Step 1: Remove console statements from src/ (excluding dev/)**

Use a find-and-remove approach. For each file in `src/` (not `src/dev/`), remove lines that are pure console.log/error/warn statements. **Guidelines:**
- Remove the `console.*` statement line only
- If removing a console call leaves an empty `catch` block, leave the empty block (it was a silent catch)
- If a console call is part of a return expression or conditional, only remove the console line, not surrounding logic
- Multi-line console calls (template literals spanning lines) should be removed entirely

Target files (by grep count, highest first):
- `src/contexts/VersionControlContext.tsx`
- `src/contexts/ModelContext.tsx`
- `src/components/ModelViewer.tsx`
- `src/components/VersionControl.tsx`
- `src/components/Settings.tsx`
- `src/lib/cloud-sync-service.ts`
- `src/lib/project-api.ts`
- `src/lib/rhino3dm-service.ts`
- `src/lib/supabase-api.ts`
- `src/lib/presence-service.ts`
- `src/contexts/AuthContext.tsx`
- `src/contexts/PresenceContext.tsx`
- `src/contexts/RecentProjectsContext.tsx`
- `src/pages/Checkout.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/Settings.tsx`
- All other files with console statements

- [ ] **Step 2: Remove console statements from electron/**

Target files:
- `electron/main.ts` (1 console.log at line 340 — already removed in Task 2)
- `electron/services/file-storage-service.ts`
- `electron/services/file-watcher.ts`
- `electron/services/git-service.ts` (keep this file, just remove console statements)
- `electron/services/project-service.ts` (keep this file, just remove console statements)

- [ ] **Step 3: Remove console statements from backend/**

Target file: `backend/server.js` — has ~123 console statements. Remove all `console.log`, `console.error`, `console.warn` calls. This includes the startup logging, auth error logging, and per-route logging.

- [ ] **Step 4: Verify everything still compiles and starts**

Run: `npx tsc --noEmit && npm run build:electron`
Expected: No errors.

Run: `cd backend && node --check server.js`
Expected: No syntax errors.

- [ ] **Step 5: Commit**

```bash
git add src/ electron/ backend/server.js
git commit -m "cleanup: remove all console statements from production code"
```

---

## Chunk 3: Phase 3 — Architecture Decomposition (VersionControlContext)

### Task 9: Create CloudSyncContext

**Files:**
- Create: `src/contexts/CloudSyncContext.tsx`
- Modify: `src/contexts/VersionControlContext.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/VersionControl.tsx`

This is the largest task. Extract all cloud sync–related state and logic from `VersionControlContext.tsx` into a new `CloudSyncContext.tsx`.

- [ ] **Step 1: Identify cloud sync state in VersionControlContext**

Read `src/contexts/VersionControlContext.tsx` and identify all state, effects, and callbacks related to cloud sync. Look for:
- `cloudProject` state
- `cloudSyncedCommitIds` state and ref
- `isCloudSyncing` state
- All functions that call cloud-sync-service or project-api for sync operations
- `pushToCloud`, `pullFromCloud`, `syncCommit`, any presigned URL logic
- Effects that respond to `cloudProject` changes

- [ ] **Step 2: Create CloudSyncContext.tsx**

Create `src/contexts/CloudSyncContext.tsx` with:
- All cloud sync state moved from VersionControlContext
- `useVersionControl()` hook to read commit tree, branches, current commit
- All cloud sync functions
- Provider component
- `useCloudSync()` hook export

The context should expose at minimum:
```typescript
interface CloudSyncContextType {
  cloudProject: CloudProject | null;
  setCloudProject: (project: CloudProject | null) => void;
  cloudSyncedCommitIds: Set<string>;
  isCloudSyncing: boolean;
  pushToCloud: () => Promise<void>;
  pullFromCloud: () => Promise<void>;
  // ... other sync-related functions
}
```

- [ ] **Step 3: Remove cloud sync state from VersionControlContext**

Remove all cloud sync state, effects, and callbacks from `VersionControlContext.tsx`. The context should no longer import from cloud-sync-service or project-api for sync operations.

- [ ] **Step 4: Update App.tsx provider nesting**

In `src/App.tsx`, add the CloudSyncProvider import and nest it:

```tsx
import { CloudSyncProvider } from "@/contexts/CloudSyncContext";

// In the JSX:
<VersionControlProvider>
  <CloudSyncProvider>
    <ModelProvider>
      ...
    </ModelProvider>
  </CloudSyncProvider>
</VersionControlProvider>
```

- [ ] **Step 5: Update VersionControl.tsx to use CloudSyncContext**

In `src/components/VersionControl.tsx`, find all cloud sync–related values that were destructured from `useVersionControl()` and change them to use `useCloudSync()` instead.

- [ ] **Step 6: Update any other consumers**

Search for any other files that import cloud sync values from VersionControlContext and update them.

Run: `grep -rn "useVersionControl" src/ --include="*.tsx" --include="*.ts"`

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Manual smoke test**

Run: `npm run electron:dev`
Verify:
- App opens without errors
- Version control sidebar works (commit, branch, navigate)
- Cloud sync still works (if you have a cloud project to test with)

---

### Task 10: Create GalleryContext

**Files:**
- Create: `src/contexts/GalleryContext.tsx`
- Modify: `src/contexts/VersionControlContext.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/VersionControl.tsx`

- [ ] **Step 1: Identify gallery state in VersionControlContext**

Read the current `VersionControlContext.tsx` and identify gallery mode state:
- `galleryMode` boolean
- `gallerySelections` (array of up to 4 commit IDs)
- `toggleGalleryMode`, `addGallerySelection`, `removeGallerySelection`, `clearGallerySelections`
- Any effects related to gallery mode

- [ ] **Step 2: Create GalleryContext.tsx**

Create `src/contexts/GalleryContext.tsx` with:
- All gallery state moved from VersionControlContext
- `useVersionControl()` hook to read commit references if needed
- Provider component
- `useGallery()` hook export

- [ ] **Step 3: Remove gallery state from VersionControlContext**

Remove all gallery state, callbacks, and related logic from `VersionControlContext.tsx`.

- [ ] **Step 4: Update App.tsx provider nesting**

```tsx
import { GalleryProvider } from "@/contexts/GalleryContext";

// Nest inside CloudSyncProvider:
<CloudSyncProvider>
  <GalleryProvider>
    <ModelProvider>
      ...
    </ModelProvider>
  </GalleryProvider>
</CloudSyncProvider>
```

- [ ] **Step 5: Update VersionControl.tsx to use GalleryContext**

Replace gallery-related destructuring from `useVersionControl()` with `useGallery()`.

- [ ] **Step 6: Update any other consumers**

Search for gallery usage across the codebase and update imports.

- [ ] **Step 7: Verify compilation and smoke test**

Run: `npx tsc --noEmit`
Run: `npm run electron:dev` — verify gallery mode still works.

- [ ] **Step 8: Commit the VersionControlContext decomposition**

```bash
git add src/contexts/CloudSyncContext.tsx src/contexts/GalleryContext.tsx src/contexts/VersionControlContext.tsx src/App.tsx src/components/VersionControl.tsx
git commit -m "refactor: decompose VersionControlContext into CloudSyncContext and GalleryContext"
```

---

## Chunk 4: Phase 3 — Architecture Decomposition (ModelViewer + Backend)

### Task 11: Extract WelcomePanel from ModelViewer

**Files:**
- Create: `src/components/WelcomePanel.tsx`
- Modify: `src/components/ModelViewer.tsx`

- [ ] **Step 1: Identify WelcomePanel boundaries**

Read `src/components/ModelViewer.tsx` and find the `WelcomePanel` component definition (it's an inline component with its own state). Identify:
- The component function and its JSX
- All state hooks it uses
- All imports it needs
- Props it receives from ModelViewer (if any)

- [ ] **Step 2: Create WelcomePanel.tsx**

Create `src/components/WelcomePanel.tsx` with:
- The WelcomePanel component extracted as the default export
- All its state, hooks, and logic moved with it
- Necessary imports added
- Props interface defined if it receives props from ModelViewer

- [ ] **Step 3: Update ModelViewer.tsx**

In `src/components/ModelViewer.tsx`:
- Remove the inline WelcomePanel component definition and its associated state
- Import WelcomePanel: `import WelcomePanel from './WelcomePanel';`
- Render `<WelcomePanel />` (with any needed props) where the inline version was used

- [ ] **Step 4: Verify compilation and smoke test**

Run: `npx tsc --noEmit`
Run: `npm run electron:dev` — verify the welcome panel renders correctly when no project is open.

- [ ] **Step 5: Commit**

```bash
git add src/components/WelcomePanel.tsx src/components/ModelViewer.tsx
git commit -m "refactor: extract WelcomePanel from ModelViewer"
```

---

### Task 12: Backend Route Split

**Files:**
- Create: `backend/middleware/auth.js`
- Create: `backend/lib/utils.js`
- Create: `backend/routes/s3.js`
- Create: `backend/routes/projects.js`
- Create: `backend/routes/sync.js`
- Create: `backend/routes/stripe.js`
- Modify: `backend/server.js`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p backend/middleware backend/lib backend/routes
```

- [ ] **Step 2: Create middleware/auth.js**

Extract from `backend/server.js`:
- `verifyAuth()` function (lines 128-161)
- `validateS3Key()` function (lines 190-196)
- `checkProjectPermission()` function (lines 524-572 approximately)

Each function needs access to `supabase` — pass it as a parameter or export a factory:

```javascript
export function createAuthMiddleware(supabase) {
  async function verifyAuth(req, res, next) { /* ... */ }
  function validateS3Key(s3Key, userId) { /* ... */ }
  async function checkProjectPermission(projectId, userId, requiredRole) { /* ... */ }
  return { verifyAuth, validateS3Key, checkProjectPermission };
}
```

- [ ] **Step 3: Create lib/utils.js**

Extract from `backend/server.js`:
- `escapeHtml()` function
- `resolvePendingInvites()` function (needs `supabase`)
- `sendProjectInviteEmail()` function (needs `sesClient`, `INVITE_FROM_EMAIL`)
- `ensureS3Cors()` function (needs `s3Client`, `BUCKET_NAME`)

```javascript
export function createUtils({ supabase, sesClient, s3Client, BUCKET_NAME, INVITE_FROM_EMAIL }) {
  function escapeHtml(str) { /* ... */ }
  async function resolvePendingInvites(user) { /* ... */ }
  async function sendProjectInviteEmail(...) { /* ... */ }
  async function ensureS3Cors() { /* ... */ }
  return { escapeHtml, resolvePendingInvites, sendProjectInviteEmail, ensureS3Cors };
}
```

- [ ] **Step 4: Create routes/s3.js**

Extract the 4 S3 routes. Each route file exports a function that receives dependencies and returns an Express Router:

```javascript
import { Router } from 'express';

export function createS3Router({ s3Client, BUCKET_NAME, verifyAuth, validateS3Key }) {
  const router = Router();
  // GET /presigned-upload
  // GET /presigned-download
  // GET /list-versions
  // DELETE /delete-version
  return router;
}
```

- [ ] **Step 5: Create routes/projects.js**

Extract all project CRUD and member management routes (7 routes total).

```javascript
import { Router } from 'express';

export function createProjectsRouter({ supabase, verifyAuth, checkProjectPermission, resolvePendingInvites, sendProjectInviteEmail }) {
  const router = Router();
  // POST / (create project)
  // GET /user-projects
  // GET /by-path
  // GET /:projectId/members
  // POST /:projectId/members (also handles invite flow)
  // PUT /:projectId/members/:memberId/role
  // DELETE /:projectId/members/:memberId
  return router;
}
```

**Note:** The invite functionality (referenced in CLAUDE.md as separate `/api/invites` routes) is actually handled through the member endpoints above. There are no separate invite route files needed.
```

- [ ] **Step 6: Create routes/sync.js**

Extract the 4 sync routes.

```javascript
import { Router } from 'express';

export function createSyncRouter({ s3Client, BUCKET_NAME, supabase, verifyAuth, checkProjectPermission }) {
  const router = Router();
  // POST /:projectId/sync/push-url
  // POST /:projectId/sync/pull-url
  // POST /:projectId/sync/pull-content
  // GET /:projectId/sync/list
  return router;
}
```

- [ ] **Step 7: Create routes/stripe.js**

Extract the 4 Stripe routes. **Important:** The webhook route needs `express.raw()` for body parsing.

```javascript
import { Router } from 'express';
import express from 'express';

export function createStripeRouter({ stripe, supabase, verifyAuth }) {
  const router = Router();
  // POST /webhook — uses express.raw({ type: 'application/json' }) as route-specific middleware
  // POST /create-checkout-session
  // POST /create-subscription-intent
  // GET /payment-status
  return router;
}
```

- [ ] **Step 8: Rewrite server.js as the shell**

Replace `backend/server.js` with a minimal shell (~100 lines):

```javascript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { SESClient } from '@aws-sdk/client-ses';
import { createClient } from '@supabase/supabase-js';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { createAuthMiddleware } from './middleware/auth.js';
import { createUtils } from './lib/utils.js';
import { createS3Router } from './routes/s3.js';
import { createProjectsRouter } from './routes/projects.js';
import { createSyncRouter } from './routes/sync.js';
import { createStripeRouter } from './routes/stripe.js';

// ... env loading, client initialization (S3, SES, Supabase, Stripe) ...

const { verifyAuth, validateS3Key, checkProjectPermission } = createAuthMiddleware(supabase);
const { escapeHtml, resolvePendingInvites, sendProjectInviteEmail, ensureS3Cors } = createUtils({ supabase, sesClient, s3Client, BUCKET_NAME, INVITE_FROM_EMAIL });

// Stripe webhook raw body — MUST come before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

// Global rate limiting
const limiter = rateLimit({ /* ... */ skip: (req) => req.path === '/api/stripe/webhook' });
app.use('/api', limiter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Mount routers
app.use('/api/aws', createS3Router({ s3Client, BUCKET_NAME, verifyAuth, validateS3Key }));
app.use('/api/projects', createProjectsRouter({ supabase, verifyAuth, checkProjectPermission, resolvePendingInvites, sendProjectInviteEmail }));
app.use('/api/projects', createSyncRouter({ s3Client, BUCKET_NAME, supabase, verifyAuth, checkProjectPermission }));
app.use('/api/stripe', createStripeRouter({ stripe, supabase, verifyAuth }));

// Error handler
app.use((err, req, res, next) => { res.status(500).json({ error: 'Internal server error' }); });

ensureS3Cors();
app.listen(PORT, () => { /* ... */ });
```

- [ ] **Step 9: Verify backend starts and responds**

Run: `cd backend && node server.js`
Expected: Server starts without errors.

Test health: `curl http://localhost:3000/health`
Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "refactor: split backend server.js into route modules"
```

---

### Task 13: AWS SDK Version Alignment

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Update AWS SDK packages**

```bash
cd backend && npm install @aws-sdk/client-s3@latest @aws-sdk/s3-request-presigner@latest @aws-sdk/client-ses@latest
```

- [ ] **Step 2: Verify versions match**

Run: `cd backend && npm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/client-ses`
Expected: All three at the same major.minor version.

- [ ] **Step 3: Verify backend starts**

Run: `cd backend && node server.js`
Expected: Server starts without errors.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: align AWS SDK package versions"
```

---

### Task 14: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture section**

Update the CLAUDE.md to reflect:
- New backend file structure (routes/, middleware/, lib/)
- New frontend contexts (CloudSyncContext, GalleryContext)
- WelcomePanel extraction
- Shared auth-utils.ts
- IPC unsubscribe pattern

- [ ] **Step 2: Update backend endpoints section**

Remove the outdated invite routes and ensure the endpoint list matches the current route files.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect refactored architecture"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run build:electron` — Electron compiles
- [ ] `npx tsc --noEmit` — TypeScript type-checks
- [ ] `npm run lint` — ESLint passes
- [ ] `cd backend && node -e "import('./server.js')"` — Backend loads without runtime errors (checks all route module imports too)
- [ ] `npm run electron:dev` — App opens and works (manual test)
- [ ] `cd backend && npm run dev` — Backend serves requests (manual test)
- [ ] No console statements in production code: `grep -rn "console\." src/ electron/ backend/server.js --include="*.ts" --include="*.tsx" --include="*.js" | grep -v node_modules | grep -v "src/dev/"` — should return nothing
