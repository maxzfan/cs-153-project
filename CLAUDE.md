# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`

## Commands

### Frontend / Electron (root)
```bash
npm run electron:dev       # Start dev mode: Vite (port 5173) + Electron with hot reload
npm run build:electron     # Compile TypeScript in electron/ → dist-electron/
npm run electron:dist      # Full production build → macOS DMG/ZIP in dist-electron/
npm run lint               # ESLint
```

### Backend (separate process, separate directory)
```bash
cd backend && npm run dev  # Start Express API server with --watch (port 3000)
cd backend && npm start    # Production start
```

There are no automated tests — the backend `test` script is a placeholder.

### Build pipeline detail
`build:electron` runs two `tsc` compilations (main + preload tsconfigs) then renames `preload.js` → `preload.cjs`. This rename **must happen** before running Electron. The `electron:dev` script handles this automatically.

## Architecture

### Process Model
Three separate runtime processes:

1. **Electron main** (`electron/main.ts` → `dist-electron/main.js`) — Node.js process. Manages the BrowserWindow, handles IPC, file I/O, and file watching. All filesystem and git operations run here.

2. **Renderer / React** (`src/`) — Runs in the Electron BrowserWindow. Uses `HashRouter` (required for Electron's file:// protocol). Communicates with the main process exclusively through `window.electronAPI`.

3. **Express backend** (`backend/server.js`) — Separate Node.js process, split into route modules. The frontend calls this over HTTP at `localhost:3000`.

### IPC Bridge
`electron/preload.ts` defines the `window.electronAPI` surface via `contextBridge`. The frontend wrapper is `src/lib/desktop-api.ts`. When adding new IPC channels: define handler in `electron/main.ts`, expose in `electron/preload.ts`, wrap in `src/lib/desktop-api.ts`.

IPC event listeners (`on*` methods) return unsubscribe functions. Use the returned function in React effect cleanups instead of `removeAllListeners`.

### State Management
Seven React Contexts wrap the entire app (see nesting order in `src/App.tsx`):
- **AuthContext** — Supabase auth session, payment plan, Google OAuth
- **RecentProjectsContext** — Recent file list (persisted in localStorage)
- **PresenceContext** — Real-time team presence via Supabase Realtime
- **VersionControlContext** — Commit tree, branches, core version control logic
- **CloudSyncContext** — Cloud sync state and operations (push/pull to S3/Supabase)
- **GalleryContext** — Gallery mode selection state (compare up to 4 versions)
- **ModelContext** — Loaded 3D model geometry and Three.js scene state

`VersionControlContext` owns the commit tree (a JSON structure persisted locally via IPC to `.0studio/` inside the project folder) and branch management. Cloud sync and gallery mode are in their own contexts.

### Shared Utilities
- `src/lib/auth-utils.ts` — shared `getAuthHeaders()` for authenticated API calls (used by project-api and cloud-sync-service)

### Commit Storage (two layers)
- **Local**: `.0studio/commits/<commitId>.3dm` + `.0studio/tree.json` written by `FileStorageService` in `electron/services/file-storage-service.ts` via IPC.
- **Cloud**: S3 via presigned URLs (browser uploads directly to S3). Metadata recorded in Supabase. Orchestrated by `src/lib/cloud-sync-service.ts`.

### TypeScript compilation split
- `tsconfig.json` — compiles `src/` (Vite handles this at build time)
- `electron/tsconfig.json` — compiles `electron/main.ts` and services
- `electron/preload-tsconfig.json` — compiles `electron/preload.ts` separately (outputs CJS)

Path alias `@/` maps to `src/` in all configs.

### Backend structure
The backend is split into modules:
- `backend/server.js` — thin shell: client init, middleware, route mounting
- `backend/middleware/auth.js` — `verifyAuth`, `validateS3Key`, `checkProjectPermission`
- `backend/lib/utils.js` — `escapeHtml`, `resolvePendingInvites`, `sendProjectInviteEmail`, `ensureS3Cors`
- `backend/routes/s3.js` — legacy per-user S3 presigned URL routes (`/api/aws`)
- `backend/routes/projects.js` — project CRUD + member management (`/api/projects`)
- `backend/routes/sync.js` — cloud sync routes (`/api/projects/:projectId/sync`)
- `backend/routes/stripe.js` — Stripe payment + webhook routes (`/api/stripe`)

Each route file exports a factory function that receives dependencies and returns an Express Router. All routes require a Supabase JWT in `Authorization: Bearer` except Stripe webhooks.

**Important backend details:**
- Rate limiting is scoped to `/api/aws` and `/api/projects/:projectId/sync` only
- The Stripe webhook path (`/api/stripe/webhook`) must receive a raw body for signature verification — `express.raw()` is mounted for this path before `express.json()` in server.js. Do not reorder these.
- `WelcomePanel` is a standalone component in `src/components/WelcomePanel.tsx` (extracted from ModelViewer)

## Build configuration

- `env.ts` (root) — single source of truth for required `VITE_*` build-time env vars. Consumed by `@julr/vite-plugin-validate-env` from `vite.config.ts`. Anything new in `src/` that uses `import.meta.env.VITE_FOO` must be added to `env.ts` or the build fails.
- `assets/source-icon.png` — 1024×1024 source for `assets/icon.png` (Mac) and `assets/icon.ico` (Win). Regenerate via your Mac icon pipeline; the working `.iconset` directory it produces is gitignored.
- `homebrew/0studio.rb.template` — Homebrew formula template consumed by `scripts/release.sh` for the `homebrew-0studio` tap.

## Tests

- No frontend / Electron tests yet (placeholder script in `package.json`).
- Backend `test` script in `backend/package.json` is also a placeholder. Real fixtures live in `backend/test-fixtures/digest/` for the digest pipeline.
