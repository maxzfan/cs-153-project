# 0studio - Product Requirements Document & System Architecture

**Last Updated:** 2026-02-18  
**Version:** 1.11.0  
**Purpose:** Comprehensive context document for Cursor AI agent to reference during development

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [File Structure & Purpose](#file-structure--purpose)
5. [Core Components](#core-components)
6. [Data Flow & State Management](#data-flow--state-management)
7. [API Contracts & Interfaces](#api-contracts--interfaces)
8. [Development Guidelines](#development-guidelines)
9. [Key Workflows](#key-workflows)
10. [Implementation Gaps & Known Issues](#implementation-gaps--known-issues)
11. [Implementation Status Tracker](#implementation-status-tracker)
12. [Recent Updates & Features](#recent-updates--features)

---

## Project Overview

**0studio** is a macOS desktop application that provides Git-based version control for Rhino 3D (.3dm) files. It functions similarly to VSCode opening a folder as a project, but instead opens a single .3dm file as a project.

### Core Features

- **File-Based Projects**: Open any .3dm file as a project
- **Auto-Detection**: Automatically detects when .3dm files are saved in Rhino
- **Local Version Control**: Full version control with commit history, branching, and restore operations
- **Visual Timeline**: Browse through model history with intuitive branching tree UI
- **Gallery Mode**: Compare up to 4 model versions side-by-side in adaptive grid layouts
- **3D Model Viewer**: Interactive Three.js-based viewer for .3dm files
- **Payment Plans**: Student and Enterprise plans (Stripe integration ready)
- **macOS Native**: Built specifically for macOS with proper file associations
- **Settings Panel**: User account settings and project settings with team collaboration
- **Project Collaboration**: Invite members, manage roles (owner/editor/viewer), permissions
- **Invite Emails**: Invited members receive an email notification via Amazon SES
- **Cloud File Sharing**: Push/pull commit files to AWS S3 via project-scoped sync endpoints; collaborators can pull shared versions

### Planned Features (Not Yet Implemented)

- **Git Integration**: Service exists but IPC handlers not implemented

### Project Structure

- **Frontend**: React + TypeScript + Vite
- **Backend**: Electron (main process) + Node.js/Express API server
- **3D Rendering**: Three.js + React Three Fiber
- **Version Control**: Git via simple-git (local) + Supabase (cloud)
- **Cloud Storage**: AWS S3 with versioning
- **Authentication**: Supabase Auth
- **Payments**: Stripe subscriptions
- **AI Integration**: Removed - all AI-powered commit features and Google Gemini integration have been removed (package remains but unused)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ FileWatcher  │  │  GitService  │  │ ProjectService│      │
│  │   Service    │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘             │
│                            │                                 │
│                    IPC (ipcMain)                             │
└────────────────────────────┼─────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   Preload Script │
                    │  (contextBridge) │
                    └────────┬─────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              Electron Renderer Process (React)                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    React App                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ ModelContext │  │VersionControl│  │  Components │ │  │
│  │  │              │  │   Context    │  │             │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │  │
│  │         │                 │                 │         │  │
│  │  ┌──────▼─────────────────▼─────────────────▼───────┐ │  │
│  │  │         Desktop API Service (desktop-api.ts)      │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             3D Rendering Layer                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ ModelViewer  │  │ Rhino3dm     │  │  Scene      │ │  │
│  │  │  Component   │  │  Service     │  │  Commands   │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         Authentication & Cloud Storage Layer             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ AuthContext  │  │  Supabase    │  │  AWS S3     │ │  │
│  │  │              │  │  API Service │  │  API Service│ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   Backend API   │
                    │  (Node/Express) │
                    │  ┌──────────┐  │
                    │  │  Stripe  │  │
                    │  │  Webhook │  │
                    │  └──────────┘  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼────────┐  ┌─────────▼─────────┐  ┌────▼──────┐
│   Supabase    │  │      AWS S3        │  │  Stripe   │
│   (Database + │  │   (File Storage +  │  │ (Payments)│
│    Auth)      │  │    Versioning)     │  │           │
└───────────────┘  └────────────────────┘  └───────────┘
```

### Process Communication

1. **Main Process → Renderer**: IPC events (`ipcMain.send`)
2. **Renderer → Main Process**: IPC invokes (`ipcRenderer.invoke`)
3. **Preload Bridge**: Exposes safe API via `contextBridge.exposeInMainWorld`
4. **Backend API**: RESTful API for cloud operations and payments

---

## Technology Stack

### Frontend
- **React 18.3.1**: UI framework
- **TypeScript 5.8.3**: Type safety
- **Vite 5.4.19**: Build tool and dev server
- **React Router 6.30.1**: Routing
- **TanStack Query 5.83.0**: Server state management
- **Tailwind CSS 3.4.17**: Styling
- **Shadcn UI**: Component library (Radix UI primitives)
- **Sonner**: Toast notifications

### 3D Rendering
- **Three.js 0.160.1**: 3D graphics library
- **React Three Fiber 8.18.0**: React renderer for Three.js
- **React Three Drei 9.122.0**: Useful helpers for R3F
- **rhino3dm 8.17.0**: Rhino 3D file format support

### Desktop
- **Electron 32.2.7**: Desktop app framework
- **chokidar 4.0.0**: File system watching
- **simple-git 3.27.0**: Git operations

### Cloud & Authentication
- **@supabase/supabase-js 2.90.0**: Supabase client for auth and database
- **AWS S3**: File storage with versioning (via backend API)
- **AWS SES** (`@aws-sdk/client-ses`): Transactional invite emails (uses same AWS credentials as S3)

### Payments
- **@stripe/stripe-js ^8.0.0**: Stripe client SDK
- **@stripe/react-stripe-js**: Stripe Elements React components
- **Stripe Subscriptions**: Recurring payment plans with embedded checkout

### Utilities
- **zod 3.25.76**: Schema validation
- **react-hook-form 7.61.1**: Form handling
- **date-fns 3.6.0**: Date utilities

---

## File Structure & Purpose

### Root Directory

```
0studio/
├── 0studio_mac_icon.png  # Source icon (1024x1024 PNG)
├── assets/               # Build assets
│   └── icon.png          # Prepared icon for electron-builder
├── scripts/              # Build scripts
│   └── create-icon.sh    # Icon preparation script
│
├── electron/              # Electron main process code
│   ├── main.ts           # Main Electron process entry point
│   ├── preload.ts        # Preload script (context bridge)
│   ├── services/         # Electron services
│   │   ├── file-storage-service.ts  # 0studio commit storage
│   │   ├── file-watcher.ts          # File system watching
│   │   ├── git-service.ts           # Git operations (not connected to IPC)
│   │   └── project-service.ts       # Project management
│   └── tsconfig.json     # TypeScript config for Electron
│
├── src/                  # React application source
│   ├── main.tsx         # React app entry point
│   ├── App.tsx          # Root React component
│   │
│   ├── components/      # React components
│   │   ├── ModelViewer.tsx      # 3D model viewer with gallery mode
│   │   ├── VersionControl.tsx   # Version control UI with branching tree
│   │   ├── NavLink.tsx          # Navigation link component
│   │   ├── Auth.tsx             # Authentication UI (AuthDialog, UserMenu)
│   │   ├── TitleBar.tsx         # macOS title bar with user menu + settings icon
│   │   └── ui/                  # Shadcn UI components
│   │
│   ├── contexts/        # React contexts (state management)
│   │   ├── ModelContext.tsx           # 3D model state
│   │   ├── VersionControlContext.tsx  # Version control state
│   │   ├── AuthContext.tsx            # Authentication state
│   │   └── RecentProjectsContext.tsx  # Recent projects list (localStorage)
│   │
│   ├── lib/             # Core libraries and services
│   │   ├── desktop-api.ts        # Electron IPC wrapper
│   │   ├── rhino3dm-service.ts   # Rhino file loading/exporting
│   │   ├── supabase-api.ts      # Supabase database operations
│   │   ├── project-api.ts       # Project & member management (backend API)
│   │   ├── aws-api.ts           # AWS S3 presigned URL operations (AWSS3API class)
│   │   ├── cloud-sync-service.ts # Cloud sync orchestration (push/pull commits + tree.json)
│   │   ├── commit-storage.ts    # IndexedDB storage for commits
│   │   └── utils.ts             # Utility functions
│   │
│   ├── pages/           # Page components
│   │   ├── Index.tsx    # Main application page
│   │   ├── Dashboard.tsx # Payment plan selection (Plans & Billing)
│   │   ├── Settings.tsx # Settings page (Account + Project tabs)
│   │   ├── Checkout.tsx  # Custom Stripe checkout page
│   │   └── NotFound.tsx # 404 page
│   │
│   └── hooks/           # Custom React hooks
│       └── use-mobile.tsx       # Mobile detection
│
├── backend/             # Backend API server
│   ├── server.js       # Express server
│   ├── test-setup.js   # Setup verification
│   └── package.json    # Backend dependencies
│
├── dist/                # Built React app (production)
├── dist-electron/       # Built Electron app
├── public/              # Static assets
└── package.json         # Dependencies and scripts
```

### Key Files Reference

#### Electron Main Process

**`electron/main.ts`**
- Entry point for Electron main process
- Manages BrowserWindow lifecycle
- Sets up IPC handlers
- Handles file associations and menu
- Coordinates FileWatcher and GitService

**`electron/preload.ts`**
- Exposes safe API to renderer via `contextBridge`
- Defines TypeScript interfaces for `window.electronAPI`
- Bridges IPC calls between renderer and main process

**`electron/services/file-watcher.ts`**
- Uses `chokidar` to watch .3dm files for changes
- Emits events when files are modified, deleted, or added
- Handles file stability (waits for write completion)

**`electron/services/file-storage-service.ts`**
- Manages local file storage for commit versions
- Creates `0studio_{filename}/` folder structure
- Stores commit files as `commit-{commitId}.3dm`
- Stores branch/commit tree in `tree.json` (same folder as commits)
- Provides: saveCommitFile, readCommitFile, listCommitFiles, saveTreeFile, loadTreeFile, validateCommitFiles
- Validates commit files exist when loading tree.json

**`electron/services/git-service.ts`**
- Wraps `simple-git` for Git operations
- Provides: init, status, commit, log, checkout, push, pull
- Manages Git repository in project directory

#### React Application

**`src/App.tsx`**
- Root component
- Sets up QueryClient, AuthProvider, RecentProjectsProvider, HashRouter
- **App-level providers**: Wraps all routes with `VersionControlProvider` then `ModelProvider` (order is required: ModelProvider uses `useVersionControl()`). This keeps model and version control state across navigation (e.g. return from payment or settings to same open project).
- TooltipProvider, Toasters, and Routes are inside the provider tree
- Index, Dashboard, Checkout, and Settings do not wrap with these providers; they consume context from App

**`src/pages/Index.tsx`**
- Main application layout with macOS-style title bar
- **Conditional Panel Layout**: 
  - With model loaded: Resizable panels - VersionControl (30%) | ModelViewer (70%)
  - Without model: Full-width ModelViewer with clean empty state (welcome panel with recent projects)
- Uses ModelProvider and VersionControlProvider from App (does not wrap with providers)

**`src/contexts/ModelContext.tsx`**
- Manages 3D model state and operations
- Handles file loading, scene manipulation, export
- Tracks generated objects (primitives)
- Provides serialization for version control
- Integrates with file watching for auto-reload

**`src/contexts/VersionControlContext.tsx`**
- Manages version control state
- Tracks commits, current commit, unsaved changes
- Handles commit creation
- Provides model restoration from commits
- Manages gallery mode state (selection, toggle)
- Coordinates with ModelContext via callbacks
- Handles cloud sync with Supabase and S3
- **Local Persistence**: Loads/saves `tree.json` from `0studio_{filename}/` folder
  - Loads on `setCurrentModel()` (returns Promise—callers await to ensure branches/commits loaded before createInitialCommit)
  - Auto-saves on any commit/branch change via `useEffect`
  - Validates commit files exist, warns about missing files
  - Saves before project close to ensure persistence

**`src/contexts/AuthContext.tsx`**
- Authentication state management using Supabase Auth
- Provides: signUp, signIn, signOut, resetPassword, refreshPaymentStatus
- Tracks user session and loading state
- Manages payment plan state (student/enterprise/none) from backend API
- Auto-refreshes tokens and persists sessions
- **No auto-redirect**: Subscription redirect disabled; import available on free plan

**`src/lib/desktop-api.ts`**
- Singleton service wrapping Electron IPC
- Provides type-safe API for:
  - Project management (openProjectDialog, getCurrentProject, closeProject)
  - File watching (startFileWatching, stopFileWatching, setCurrentFile)
  - File reading/writing (readFileBuffer, writeFileBuffer)
  - **Local commit storage**: saveCommitFile, readCommitFile, listCommitFiles, commitFileExists
  - **Tree persistence**: saveTreeFile, loadTreeFile, validateCommitFiles
  - Git operations (gitInit, gitStatus, gitCommit, gitLog, gitCheckout, gitPush, gitPull) - ⚠️ Exposed but handlers NOT implemented in main.ts
- Event listeners for IPC events (onProjectOpened, onProjectClosed, onFileChanged, onShowCommitDialog, onGitOperationComplete)
- `isDesktop` property to check if running in Electron

**`src/lib/rhino3dm-service.ts`**
- Loads .3dm files using Three.js Rhino3dmLoader
- Exports Three.js scenes to .3dm files
- Uses CDN-hosted rhino3dm library
- Converts between Three.js and Rhino mesh formats
- Provides metadata about loaded models

**`src/lib/supabase-api.ts`**
- API service for Supabase database operations
- Methods for projects, commits, and branches CRUD operations
- Handles error reporting via toast notifications
- Singleton instance exported as `supabaseAPI`
- ⚠️ **Note**: Complete and functional, but NOT currently called from VersionControlContext

**`src/lib/project-api.ts`**
- Project and member management API client (calls backend `/api/projects/*`)
- Methods: `registerProject()`, `getUserProjects()`, `getProjectByFilePath()`, `getProjectMembers()`, `inviteMember()`, `updateMemberRole()`, `removeMember()`
- Singleton exported as `projectAPI`
- Uses Supabase session token for auth headers

**`src/lib/aws-api.ts`**
- AWS S3 API client class (via backend API)
- **AWSS3API class** (`awsS3API`): Methods for presigned URLs, upload/download, version listing
  - Calls `/api/aws/*` backend endpoints (legacy per-user S3 operations)
  - Available for direct S3 operations but cloud sync uses `cloud-sync-service.ts` instead

**`src/lib/cloud-sync-service.ts`**
- Cloud sync orchestration service for project file sharing
- **CloudSyncService class** (`cloudSyncService`): Methods for push/pull operations
  - `pushCommitFile(projectId, commitId, fileBuffer)`: Upload commit .3dm to S3
  - `pullCommitFile(projectId, commitId)`: Download commit .3dm from S3
  - `pushTreeJson(projectId, treeData)`: Upload tree.json metadata to S3
  - `pullTreeJson(projectId)`: Download tree.json metadata from S3
  - `computeSyncStatus(local, synced, remote)`: Compare commit sets to determine sync state
  - Calls `/api/projects/:id/sync/*` backend endpoints with project-scoped access control
- Used by `VersionControlContext` for `pushToCloud()` and `pullFromCloud()` methods

**`src/components/ModelViewer.tsx`**
- React Three Fiber canvas for 3D rendering
- Displays loaded .3dm models with automatic camera fit-to-model
- **Camera Positioning**: Automatically fits model to ~60% of viewport with consistent isometric-like angle (45° elevation, 45° azimuth)
- **Orientation Preserved**: Model transforms from Rhino are preserved (no centering transforms)
- Renders generated primitives (AI-created objects)
- Provides OrbitControls for camera manipulation (rotate, zoom, pan)
- Multi-directional lighting setup (ambient, directional, hemisphere)
- **Adaptive Grid**: Grid cell size scales proportionally to model dimensions using "nice numbers" (1, 2, 5, 10, etc.)
- Scene stats overlay (curves, surfaces, polysurfaces count)
- Drag-and-drop file import support
- **Initial Page / Welcome Panel** (when no model loaded): Cursor-style centered layout
  - 0studio branding at top
  - Glass-effect card with "Open project" and "Import .3dm file" buttons
  - Recent projects list (stored per-user in localStorage, up to 10 items)
  - Shows "Sign in to see your recent projects" when signed out
  - 3D canvas visible in background (grid + default scene)
  - Recent projects clickable in Electron to reopen by path (when signed in)
- Loading and error states
- **Gallery Mode**: Adaptive grid layouts for comparing multiple commits
  - 1 model: Full view
  - 2 models: Side by side (2 columns)
  - 3 models: 2 on top, 1 full-width on bottom
  - 4 models: 2x2 grid
- Each gallery viewport has independent orbit controls
- Integrates with ModelContext and VersionControlContext

**`src/components/VersionControl.tsx`**
- UI for version control operations
- **BranchingTree**: SVG-based visual tree with colored branch lines and commit nodes
- Shows commit history with version labels, current commit, unsaved changes indicator
- Commit input with custom branch name support
- Pull (Download) and Restore buttons for each commit
- **Gallery Mode Toggle**: Button to enter/exit gallery mode
- **Commit Selection**: Checkboxes to select commits for gallery (max 4)
- **Branch Selector**: Dropdown to switch between branches when multiple exist
- **Keep Button**: Mark current branch as main
- Star/unstar commits
- Integrates with VersionControlContext and ModelContext

**`src/components/Auth.tsx`**
- Authentication UI components
- `AuthDialog`: Login/Signup dialog with tabs
- `ResetPasswordDialog`: Password reset flow
- `UserMenu`: Dropdown menu triggered by clicking user email
  - Shows user email as clickable trigger button
  - Dropdown contains: Settings, Plans & Billing (Dashboard), Sign Out
  - Uses Shadcn DropdownMenu component
  - If user not logged in, shows AuthDialog instead

**`src/components/TitleBar.tsx`**
- macOS-style title bar with hidden inset (traffic lights at x:10, y:6)
- Shows 0studio branding and current file name
- Right side: User menu (username) + Settings icon (links to /settings)

**`src/pages/Settings.tsx`**
- Settings page with two tabs: Account and Project
- **Account tab**: Profile (email, member since), Plan & Billing (current plan, upgrade/change plan, refresh status), Preferences (theme, auto-save), Sign out
- **Project tab**: Uses app-level ModelContext; when user had a project open before navigating to Settings, the Project tab shows that project (enable collaboration, members, invites). If no project is open, shows "No project open" with guidance. Team members list with role badges (owner/editor/viewer), invite form (email + role), role change and remove member (owners only). Permissions legend explains role capabilities.
- Uses `projectAPI` from `src/lib/project-api.ts` for backend calls
- Does not wrap with ModelProvider/VersionControlProvider; consumes context from App

**`src/pages/Dashboard.tsx`**
- Plans & Billing UI for selecting payment plans
- Displays Student ($10/mo) and Enterprise plan options with pricing
- Shows current plan status and feature limitations
- Navigates to custom `/checkout` page when user selects a plan
- Handles Stripe redirect callbacks (success/cancel)
- Accessible via `/dashboard` route
- Uses app-level ModelProvider/VersionControlProvider (TitleBar and context available)

**`src/pages/Checkout.tsx`**
- Custom checkout page with embedded Stripe Elements
- Uses `@stripe/react-stripe-js` PaymentElement for secure payment input
- Displays plan summary with features on left, payment form on right
- Creates subscription via backend `/api/stripe/create-subscription-intent`
- Processes payment entirely within Electron app (no external redirect)
- Shows loading state while auth initializes
- Handles payment confirmation and redirects to dashboard on success
- "Compare all plans" button links back to Dashboard
- "Back to app" button returns to main app (same open project is preserved via app-level providers)
- Requires `VITE_STRIPE_PUBLISHABLE_KEY` environment variable
- Uses app-level providers (does not wrap with ModelProvider/VersionControlProvider)

**`src/lib/commit-storage.ts`**
- IndexedDB storage for commit file buffers (legacy, used as fallback)
- Stores large file buffers separately from localStorage
- Provides: storeFileBuffer, getFileBuffer
- **Note**: Primary storage is now local file system (`0studio_{filename}/` folder)

---

## Core Components

### ModelContext

**Purpose**: Manages 3D model state, file operations, and scene manipulation

**Key State**:
- `loadedModel`: Loaded .3dm file data (THREE.Object3D[] + metadata)
- `currentFile`: Path to current .3dm file
- `generatedObjects`: Array of programmatically created primitives
- `stats`: Scene statistics (curves, surfaces, polysurfaces)
- `isLoading`, `isExporting`, `error`: UI state

**Key Methods**:
- `importFile(file)`: Load .3dm file
- `exportScene(filename?)`: Export scene to .3dm
- `addPrimitive(type, params)`: Create primitive (box, sphere, etc.)
- `removeObject(id)`: Delete object
- `transformObject(id, transform)`: Move/rotate/scale
- `setObjectColor(id, color)`: Change color
- `serializeScene()`: Serialize for version control
- `restoreScene(objects)`: Restore from serialized state

**Integration Points**:
- Listens to file changes via `desktopAPI.onFileChanged()`
- Auto-reloads model when file changes on disk
- Creates initial commit when model is loaded
- Provides restore callback to VersionControlContext

### VersionControlContext

**Purpose**: Manages version control state, branching, and operations

**Key State**:
- `currentModel`: Path to current model file
- `modelName`: Filename of current model
- `commits`: Array of ModelCommit objects
- `currentCommitId`: ID of currently active commit
- `hasUnsavedChanges`: Whether model has uncommitted changes
- `branches`: Array of Branch objects (branching feature)
- `activeBranchId`: Currently selected branch ID
- `pulledCommitId`: ID of commit that was last pulled/downloaded (for highlighting)
- `isGalleryMode`: Whether gallery mode is active
- `selectedCommitIds`: Set of commit IDs selected for gallery (max 4)
- `isLoadingTree`: Whether tree.json is currently being loaded (internal)
- `treeLoadPromise`: Promise that resolves when tree.json loading completes (internal, for race condition prevention)

**Key Methods**:
- `setCurrentModel(path)`: Set current model, loads tree.json from `0studio_{filename}/` and returns Promise (callers await to ensure branches/commits loaded before createInitialCommit)
- `commitModelChanges(message, modelData, customBranchName?)`: Create regular commit (auto-branches when committing from non-head)
- `restoreToCommit(commitId)`: Restore model to specific commit (UI only, doesn't update disk)
- `pullFromCommit(commitId)`: Pull commit to local file (updates disk, sets pulledCommitId for branch tracking)
- `createInitialCommit(modelData, fileBuffer?, filePath?)`: Create first commit and main branch (awaits treeLoadPromise first)
- `markUnsavedChanges()` / `clearUnsavedChanges()`: Track changes
- `clearCurrentModel()`: Clear model, reset gallery mode, branches, and tree loading state
- `toggleGalleryMode()`: Enter/exit gallery mode
- `toggleCommitSelection(commitId)`: Select/deselect commit for gallery (max 4)
- `clearSelectedCommits()`: Clear all selections
- `toggleStarCommit(commitId)`: Star/unstar a commit
- `getStarredCommits()`: Get all starred commits
- `switchBranch(branchId)`: Switch to a different branch
- `keepBranch(branchId)`: Mark a branch as the main branch
- `getBranchCommits(branchId)`: Get all commits for a specific branch
- `getCommitVersionLabel(commit)`: Get version label (v1, v2, v3a, v3b, etc.)
- `setModelRestoreCallback(callback)`: Set callback for restoring model from commit

**Branching Logic**:
- When `pullFromCommit` is called, `pulledCommitId` is set to track the pulled commit
- When committing with `pulledCommitId` set and it's not the branch head, a new branch is automatically created
- Branch names follow pattern: v{parentVersion}{letter} (e.g., v2a, v2b, v2c)
- Each branch has a unique color for visualization
- Users can switch between branches and mark any branch as "main"

**Integration Points**:
- Listens to file changes (via desktopAPI) to mark unsaved changes
- Listens to project-closed events to reset gallery mode and branches
- Uses callbacks to ModelContext for model restoration (`onModelRestore`)
- Uses FileStorageService (via desktopAPI) for local commit file storage
- Uses tree.json for persisting branch/commit metadata

**Cloud Sync Integration**:
- `cloudProject`: The registered cloud project (from `project_members` table), or null if not cloud-enabled
- `cloudSyncedCommitIds`: Set of commit IDs that have been pushed to the cloud
- `cloudSyncStatus`: `{ localOnly, remoteOnly, synced }` arrays of commit IDs
- `isCloudSyncing`: Whether a push/pull operation is in progress
- `pushToCloud()`: Upload unsynced commits + tree.json to S3
- `pullFromCloud()`: Download remote tree.json, find new commits, download their files, merge into local state
- `refreshCloudStatus()`: Compare local vs remote commit sets

### AuthContext

**Purpose**: Manages authentication and payment plan state

**Key State**:
- `user`: Supabase user object
- `session`: Supabase session
- `isLoading`: Loading state
- `paymentPlan`: Current payment plan ('student' | 'enterprise' | null)
- `hasVerifiedPlan`: Whether user has active subscription

**Key Methods**:
- `signUp(email, password)`: Create new account
- `signIn(email, password)`: Sign in
- `signOut()`: Sign out
- `resetPassword(email)`: Send password reset email
- `refreshPaymentStatus()`: Reload payment plan from backend API

**Integration Points**:
- Loads payment status from backend API on login
- Payment status checked before cloud pull operations
- Dashboard uses AuthContext to check current plan
- RecentProjectsContext uses `user.id` to store/load per-user recent projects

### RecentProjectsContext

**Purpose**: Tracks recently opened .3dm projects for quick access on the welcome screen

**Storage**: localStorage (`0studio_recent_projects_${userId}`), max 10 items, **per-user**

**Key State**:
- `recentProjects`: Array of `{ name, path, openedAt }`

**Key Methods**:
- `addRecentProject(path, name?)`: Add project to list (called when project opened via Electron). No-op when signed out.
- `removeRecentProject(path)`: Remove from list
- `clearRecentProjects()`: Clear all

**Auth-Aware Behavior**:
- **Signed out**: `recentProjects` is empty array. Projects are not tracked. Welcome panel shows "Sign in to see your recent projects."
- **Signed in**: Loads recent projects for that user from `localStorage` using `0studio_recent_projects_${user.id}` key. Projects opened while signed in are added to the list.
- **Account switching**: When user signs out/in or switches accounts, the list updates to show that account's recent projects.

**Integration**: Uses `useAuth()` to get current user. ModelContext calls `addRecentProject()` on project-opened event. Welcome panel displays list when signed in; clicking opens via `desktopAPI.openProjectByPath()` (Electron only). When opening (native dialog or recent projects), ModelContext awaits `setCurrentModel(filePath)` before `createInitialCommit`—ensures branches/commits load from `0studio_{filename}/` folder.

### DesktopAPI Service

**Purpose**: Type-safe wrapper for Electron IPC

**Key Methods**:
- Project: `openProjectDialog()`, `openProjectByPath(filePath)`, `getCurrentProject()`, `closeProject()`
- File Watching: `startFileWatching()`, `stopFileWatching()`, `setCurrentFile()`
- File Reading: `readFileBuffer(filePath)`, `writeFileBuffer(filePath, buffer)`
- Commit Storage: `saveCommitFile()`, `readCommitFile()`, `listCommitFiles()`, `commitFileExists()`
- Tree Persistence: `saveTreeFile()`, `loadTreeFile()`, `validateCommitFiles()`
- Events: `onProjectOpened()`, `onProjectClosed()`, `onFileChanged()`, `onShowCommitDialog()`, `onGitOperationComplete()`
- Git (exposed but NOT implemented): `gitInit()`, `gitStatus()`, `gitCommit()`, `gitLog()`, `gitCheckout()`, `gitPush()`, `gitPull()`

**Pattern**: All methods check `isElectron` and return early/null if not in Electron

---

## Data Flow & State Management

### File Loading Flow

```
1. User opens .3dm file (native dialog or recent projects)
   ↓
2. Electron main process: openProjectDialog() or openProjectByPath()
   ↓
3. IPC: project-opened event → Renderer
   ↓
4. ModelContext: handleProjectOpened
   ↓
5. await setCurrentModel(filePath) — loads tree.json from 0studio_{filename}/, restores branches & commits
   ↓
6. rhino3dm-service.load3dmFile() parses file
   ↓
7. ModelContext.setLoadedModel() updates state
   ↓
8. VersionControlContext.createInitialCommit() — skips if commits exist from tree.json
   ↓
9. ModelViewer renders Three.js scene
```

### File Change Detection Flow

```
1. User saves .3dm file in Rhino
   ↓
2. FileWatcherService detects change
   ↓
3. Electron main: sends 'file-changed' IPC event
   ↓
4. ModelContext: onFileChanged handler
   ↓
5. ModelContext.reloadModelFromDisk()
   ↓
6. Reads file via desktopAPI.readFileBuffer()
   ↓
7. Reloads model and updates scene
   ↓
8. VersionControlContext.markUnsavedChanges()
```

### Commit Restoration Flow

```
1. User clicks "Restore" on a commit
   ↓
2. VersionControlContext.restoreToCommit(commitId)
   ↓
3. Retrieves ModelCommit with modelData
   ↓
4. Calls onModelRestore callback (set by ModelContext)
   ↓
5. ModelContext.restoreScene() or setLoadedModel()
   ↓
6. Scene updates to show restored state
   ↓
7. VersionControlContext.setCurrentCommitId()
```

### Gallery Mode Flow

```
1. User clicks "Gallery" button in VersionControl
   ↓
2. VersionControlContext.toggleGalleryMode() sets isGalleryMode = true
   ↓
3. User selects commits via checkboxes (max 4)
   ↓
4. VersionControlContext.toggleCommitSelection(commitId) updates selectedCommitIds
   ↓
5. ModelViewer receives selectedCommits from VersionControlContext
   ↓
6. ModelViewer renders grid layout based on count:
   - 2 commits: 2 columns, 1 row
   - 3 commits: 2 columns, 2 rows (2 on top, 1 full-width on bottom)
   - 4 commits: 2 columns, 2 rows (2x2 grid)
   ↓
7. Each selected commit renders in its own Canvas with modelData
   ↓
8. User exits gallery mode → toggleGalleryMode() clears selections
```

### Local File Storage Architecture

**Overview**: The system stores commit files and metadata locally in a dedicated folder structure alongside the original .3dm file.

**Storage Structure**:
```
/path/to/
├── model.3dm                    # Original working file
└── 0studio_model/               # Storage folder for this file (named 0studio_{filename})
                                  # Example: if file is "model.3dm", folder is "0studio_model"
    ├── commit-{id1}.3dm         # Commit file versions
    ├── commit-{id2}.3dm
    ├── commit-{id3}.3dm
    └── tree.json                # Branch and commit tree metadata
```

**File Storage Service** (`electron/services/file-storage-service.ts`):
- Creates `0studio_{filename}/` folder in the same directory as the .3dm file
- Stores each commit as `commit-{commitId}.3dm` in the storage folder
- Stores branch and commit tree structure in `tree.json` (same folder as commits)
- Validates commit files exist when loading tree.json
- Provides methods: `saveCommitFile()`, `readCommitFile()`, `listCommitFiles()`, `saveTreeFile()`, `loadTreeFile()`, `validateCommitFiles()`

**Tree.json Structure**:
```json
{
  "version": "1.0",
  "activeBranchId": "branch-123",
  "currentCommitId": "commit-456",
  "branches": [
    {
      "id": "branch-123",
      "name": "main",
      "headCommitId": "commit-456",
      "color": "#ef4444",
      "isMain": true,
      "parentBranchId": null,
      "originCommitId": null
    }
  ],
  "commits": [
    {
      "id": "commit-456",
      "message": "Initial commit",
      "timestamp": 1234567890,
      "parentCommitId": null,
      "branchId": "branch-123",
      "starred": false
    }
  ]
}
```

**Persistence Flow**:
1. **On Project Open**: 
   - `VersionControlContext.setCurrentModel()` loads `tree.json` from `0studio_{filename}/` folder
   - Creates a `treeLoadPromise` that resolves when loading is complete
   - If `tree.json` exists and has commits, parses and loads branches, commits, activeBranchId, currentCommitId
   - Validates all commit files exist, warns about missing files
   - Falls back to localStorage if `tree.json` doesn't exist (backwards compatibility)
2. **On Initial Commit Creation**:
   - `createInitialCommit()` awaits `treeLoadPromise` before proceeding (prevents race conditions)
   - Uses Promise-based state check to get real current commits count
   - If commits already exist (loaded from tree.json), skips creating duplicate initial commit
   - Only creates new initial commit if no commits exist
3. **On Commit/Branch Change**:
   - Auto-saves `tree.json` via `useEffect` hook whenever branches, commits, activeBranchId, or currentCommitId change
   - Skips saving while `isLoadingTree` is true (prevents overwriting during load)
   - Saves full commit metadata (id, message, timestamp, parentCommitId, branchId, starred)
   - Saves full branch metadata (id, name, headCommitId, color, isMain, parentBranchId, originCommitId)
4. **On Project Close**:
   - Saves `tree.json` one final time before clearing state
   - Resets `treeLoadPromise` and `isLoadingTree` state
   - Handles errors gracefully (logs warnings, doesn't throw)

**Benefits**:
- **Efficient**: JSON format, only stores metadata (not file data)
- **Readable**: Pretty-printed with 2-space indentation for debugging
- **Persistent**: Survives app restarts, stored in local file system
- **Race-Condition Safe**: Uses Promise-based coordination to prevent duplicate commits on reload
- **Validated**: Checks for missing commit files and warns in console
- **Backwards Compatible**: Falls back to localStorage if tree.json doesn't exist

### Cloud Storage Architecture (S3 Project-Scoped Sync) - IMPLEMENTED

**Implementation Status**: Cloud file sharing is fully implemented with project-scoped S3 sync. Commit files and tree.json are pushed/pulled via presigned URLs with project member permission checks.

**Overview**: The system uses project-scoped S3 keys with backend permission enforcement via `project_members` table. Each project gets its own S3 prefix.

**Cloud Storage Structure**:
```
S3 Bucket:
└── projects/
    └── {projectId}/
         ├── tree.json                    # Branch/commit metadata (synced from local tree.json)
         └── commits/
               ├── {commitId1}.3dm        # Commit file versions
               ├── {commitId2}.3dm
               └── {commitId3}.3dm
```

**Database Schema** (Supabase):
- `subscriptions`: User payment plan subscriptions (ACTIVE - managed by Stripe webhooks)
- `projects`: One row per registered project - ✅ Used by Settings/project-api for collaboration
- `project_members`: Project team membership (id, project_id, user_id, email, role, invited_by, status, created_at, updated_at). Roles: owner, editor, viewer. Status: pending, active, removed. See `PROJECT_MEMBERS_MIGRATION.sql`
- `commits`: One row per file version - ⚠️ Table exists but not used by frontend
- `branches`: Pointers to specific commits - ⚠️ Table exists but not used by frontend
  - `id` (uuid, primary key), `user_id` (uuid, references auth.users), `plan` (text: 'student' | 'enterprise')
  - `status` (text: 'active' | 'canceled' | 'past_due'), `stripe_customer_id` (text), `stripe_subscription_id` (text)
  - `created_at` (timestamptz), `updated_at` (timestamptz)
  - Managed automatically by Stripe webhook handlers in backend

**Backend API Status**:
- ✅ AWS S3 presigned upload/download URLs - Backend endpoints implemented (`/api/aws/*`)
- ✅ Project-scoped sync endpoints - Implemented (`/api/projects/:id/sync/*`)
- ✅ Stripe payment integration - Implemented
- ✅ Payment status API - Implemented
- ✅ Project & member endpoints - Implemented (`/api/projects/*`)
- ✅ Frontend cloud sync integration - Implemented via `cloud-sync-service.ts` + `VersionControlContext`

---

## API Contracts & Interfaces

### Electron IPC Channels

**Main → Renderer (Events)**:
- `project-opened`: `{ filePath, fileName }`
- `project-closed`: `{}`
- `file-changed`: `{ eventType, filename, filePath }`
- `git-operation-complete`: `{ operation }`

**Renderer → Main (Invokes)**:

*Project & File Management (Implemented):*
- `open-project-dialog`: `() => Promise<string | null>`
- `get-current-project`: `() => Promise<ProjectInfo | null>`
- `close-project`: `() => Promise<void>`
- `start-file-watching`: `() => Promise<void>`
- `stop-file-watching`: `() => Promise<void>`
- `set-current-file`: `(filePath: string) => Promise<void>`
- `read-file-buffer`: `(filePath: string) => Promise<ArrayBuffer>`
- `write-file-buffer`: `(filePath: string, buffer: ArrayBuffer) => Promise<void>`

*0studio Commit Storage (Implemented):*
- `save-commit-file`: `(filePath: string, commitId: string, buffer: ArrayBuffer) => Promise<void>`
- `read-commit-file`: `(filePath: string, commitId: string) => Promise<ArrayBuffer | null>`
- `list-commit-files`: `(filePath: string) => Promise<string[]>`
- `commit-file-exists`: `(filePath: string, commitId: string) => Promise<boolean>`
- `save-tree-file`: `(filePath: string, treeData: object) => Promise<void>`
- `load-tree-file`: `(filePath: string) => Promise<object | null>`
- `validate-commit-files`: `(filePath: string, commitIds: string[]) => Promise<string[]>`

*Git Operations (Exposed in preload but NOT implemented in main.ts):*
- `git-init`: `(projectPath: string) => Promise<void>` - ⚠️ Handler not implemented
- `git-status`: `() => Promise<GitStatus>` - ⚠️ Handler not implemented
- `git-commit`: `(message: string, files: string[]) => Promise<void>` - ⚠️ Handler not implemented
- `git-log`: `() => Promise<GitCommit[]>` - ⚠️ Handler not implemented
- `git-checkout`: `(commitHash: string) => Promise<void>` - ⚠️ Handler not implemented
- `git-push`: `() => Promise<void>` - ⚠️ Handler not implemented
- `git-pull`: `() => Promise<void>` - ⚠️ Handler not implemented

**Note**: Git IPC handlers are defined in `preload.ts` but the corresponding `ipcMain.handle()` calls are NOT implemented in `main.ts`. The `GitService` class exists but is not connected to IPC. Version control is handled locally via `tree.json` and commit files, not via Git.

### Backend API Endpoints

**AWS S3 Operations** (all require auth):
- `GET /api/aws/presigned-upload?key=...` - Get presigned URL for S3 upload
- `GET /api/aws/presigned-download?key=...&versionId=...` - Get presigned URL for S3 download with version
- `GET /api/aws/list-versions?key=...` - List S3 file versions
- `DELETE /api/aws/delete-version?key=...&versionId=...` - Delete S3 file version

**Stripe Payment Operations**:
- `POST /api/stripe/create-checkout-session` - Create Stripe Checkout Session (requires auth) - **DEPRECATED, use create-subscription-intent**
  - Body: `{ lookup_key?: string, price_id?: string }`
  - Returns: `{ sessionId: string, url: string }`
- `POST /api/stripe/create-subscription-intent` - Create subscription with PaymentIntent for embedded checkout (requires auth) - **NEW**
  - Body: `{ price_id: string, plan: string }`
  - Returns: `{ subscriptionId: string, clientSecret: string }`
  - Creates Stripe customer if not exists, creates subscription with `payment_behavior: 'default_incomplete'`
  - Stores pending subscription in Supabase (activated via webhook on payment success)
- `POST /api/stripe/webhook` - Stripe webhook handler (NO auth, uses signature verification)
  - Handles: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
- `GET /api/stripe/payment-status` - Get user's payment/subscription status (requires auth)
  - Returns: `{ hasActivePlan: boolean, plan: 'student' | 'enterprise' | null, status: string }`

**Project & Member Operations** (all require auth):
- `POST /api/projects` - Register project for collaboration. Body: `{ name, file_path }`
- `GET /api/projects/user-projects` - List projects user owns or is a member of
- `GET /api/projects/by-path?file_path=...` - Get project by file path
- `GET /api/projects/:projectId/members` - List project members
- `POST /api/projects/:projectId/members` - Invite member. Body: `{ email, role }` (role: owner | editor | viewer). Sends invite email via SES if `INVITE_FROM_EMAIL` is configured.
- `PUT /api/projects/:projectId/members/:memberId/role` - Update member role. Body: `{ role }`
- `DELETE /api/projects/:projectId/members/:memberId` - Remove member (owners only)

**Project Sync Operations** (all require auth + project membership):
- `POST /api/projects/:projectId/sync/push-url` - Get presigned upload URL for a project file (editor+)
  - Body: `{ file_key: string }` (e.g., `"tree.json"` or `"commits/{commitId}.3dm"`)
  - Returns: `{ upload_url: string, s3_key: string }`
  - S3 key format: `projects/{projectId}/{file_key}`
- `POST /api/projects/:projectId/sync/pull-url` - Get presigned download URL for a project file (viewer+)
  - Body: `{ file_key: string }`
  - Returns: `{ download_url: string, s3_key: string }`
- `GET /api/projects/:projectId/sync/list` - List all synced files for a project (viewer+)
  - Returns: `{ files: [{ file_key, size, lastModified }] }`

**Health Check**:
- `GET /health` - Health check (no auth required)

### Type Definitions

**ProjectInfo**:
```typescript
interface ProjectInfo {
  filePath: string;
  projectDir: string;
  fileName: string;
}
```

**GitStatus**:
```typescript
interface GitStatus {
  files: Array<{
    path: string;
    status: string;
    staged: boolean;
  }>;
  branch: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
}
```

**ModelCommit** (VersionControlContext):
```typescript
interface ModelCommit {
  id: string;
  message: string;
  timestamp: number;
  modelData?: LoadedModel; // Stores full model state for UI
  fileBuffer?: ArrayBuffer; // Stores exact .3dm file for restoration
  s3VersionId?: string; // S3 version ID for cloud commits
  supabaseCommitId?: string; // Supabase commit ID
  parentCommitId?: string | null; // Parent commit ID for branching (null for root)
  branchId: string; // Branch this commit belongs to
  starred?: boolean; // Whether this commit is starred/favorited
}
```

**Branch** (VersionControlContext):
```typescript
interface Branch {
  id: string;
  name: string;
  headCommitId: string; // Latest commit on this branch
  color: string; // Color for visualization (e.g., '#ef4444')
  parentBranchId?: string; // Parent branch for branch-off-branch scenarios
  originCommitId?: string; // Commit this branch was created from
  isMain: boolean; // Whether this is the main/master branch
}
```

**LoadedModel**:
```typescript
interface LoadedModel {
  objects: THREE.Object3D[];
  metadata: Rhino3dmMetadata;
  stats?: SceneStats; // curves, surfaces, polysurfaces
}
```

**SceneCommand**:
```typescript
type SceneCommand = 
  | { action: 'create', type: PrimitiveType, params?: CreateParams }
  | { action: 'transform', target: string, position?: [number, number, number], rotation?: [number, number, number], scale?: number | [number, number, number] }
  | { action: 'color', target: string, color: string }
  | { action: 'delete', target: string }
  | { action: 'clear' };
```

**ProjectMember** (supabase.ts):
```typescript
type ProjectMemberRole = 'owner' | 'editor' | 'viewer';
type ProjectMemberStatus = 'pending' | 'active' | 'removed';

interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string | null;
  email: string;
  role: ProjectMemberRole;
  invited_by: string | null;
  status: ProjectMemberStatus;
  created_at: string;
  updated_at: string;
}
```

**Permission levels** (project settings):
- **Owner**: Full access - manage members, change roles, remove members
- **Editor**: Can invite members, commit, create branches, pull versions
- **Viewer**: Read-only - view project, browse commits/branches

---

## Development Guidelines

### Building for Production

**Development Mode**:
```bash
npm run electron:dev    # Run app with hot reload
```

**Production Build**:
```bash
npm run build:all       # Complete build (Vite + Electron + DMG)
npm run electron:dist   # Alternative: explicit dist build
```

**Build Output**:
- React app: `dist/`
- Electron compiled: `dist-electron/`
- macOS DMG: `dist-electron/0studio-{version}.dmg`

**Icon Preparation** (run once if icon changes):
```bash
./scripts/create-icon.sh
```

### Code Style

- **TypeScript**: Strict mode enabled, prefer explicit types
- **React**: Functional components with hooks
- **Naming**: PascalCase for components, camelCase for functions/variables
- **File Organization**: Group by feature, not by type

### Component Guidelines

1. **Use Shadcn UI components** when available (check `src/components/ui/`)
2. **Use Shadcn Forms** for user input
3. **Context for global state**: ModelContext, VersionControlContext, AuthContext
4. **Local state for UI**: useState for component-specific state
5. **Custom hooks**: Extract reusable logic

### State Management Patterns

1. **Model State**: Managed in ModelContext
2. **Version Control State**: Managed in VersionControlContext
3. **Auth State**: Managed in AuthContext
4. **Server State**: Use TanStack Query (currently minimal usage)
5. **UI State**: Local useState in components

### Error Handling

- **Try-catch blocks**: Wrap async operations
- **User feedback**: Use toast notifications (Sonner)
- **Console logging**: Use for debugging, remove in production
- **Error boundaries**: Consider adding for React errors

### File Watching

- **Stability threshold**: 1 second after last change
- **Poll interval**: 100ms during stability check
- **Auto-reload**: ModelContext automatically reloads on file change
- **Unsaved changes**: VersionControlContext tracks when file changes

### Local File Storage

- **Storage location**: `0studio_{filename}/` folder in same directory as .3dm file
- **Commit files**: Stored as `commit-{commitId}.3dm` in storage folder
- **Tree metadata**: Stored as `tree.json` in same folder as commit files
- **Persistence**: Auto-saves tree.json on any commit/branch change
- **Loading**: Loads tree.json on project open (primary source, falls back to localStorage)
- **Validation**: Checks for missing commit files and warns in console
- **File operations**: All via FileStorageService in Electron main process

### Git Operations (NOT IMPLEMENTED)

- **⚠️ Note**: Git IPC handlers are exposed in preload.ts but NOT implemented in main.ts
- **GitService Class**: Exists in `electron/services/git-service.ts` but not connected to IPC
- **Current Implementation**: Version control is handled via local `tree.json` and commit files, NOT Git
- **Future**: Git integration could be added by implementing IPC handlers in main.ts

### Authentication (Supabase)

- **Provider**: Supabase Auth
- **Context**: AuthContext manages user session state
- **Components**: 
  - `AuthDialog`: Login/Signup dialog with tabs
  - `UserMenu`: Dropdown menu accessible by clicking user email in TitleBar
- **Session**: Auto-refreshes tokens, persists across app restarts
- **Password Reset**: Email-based reset flow

### Payment Plans (Stripe Integration)

- **Plans**: Student ($10/mo) and Enterprise subscription plans via Stripe
- **Payment Provider**: Stripe subscriptions (recurring billing)
- **Storage**: Payment plan stored in Supabase `subscriptions` table
  - Managed via Stripe webhooks (not manual updates)
- **Backend API**: Node.js/Express server handles Stripe integration
  - **Local Development**: `http://localhost:3000`
  - **Stripe Webhook Endpoint**: `POST /api/stripe/webhook`
    - Local: Use Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- **Embedded Checkout Flow** (stays in Electron app):
  1. User clicks plan in Dashboard → navigates to `/checkout?plan=...&priceId=...&price=...`
  2. (No auto-redirect on sign-up; import available on free plan)
  3. Checkout page calls `POST /api/stripe/create-subscription-intent`
  4. Backend creates Stripe customer and subscription with PaymentIntent
  5. Checkout page renders Stripe PaymentElement with clientSecret
  6. User enters card details in embedded form (no external redirect)
  7. Payment confirmed via `stripe.confirmPayment()` 
  8. Webhook `invoice.payment_succeeded` updates subscription to 'active'
  9. Checkout page navigates to Dashboard with `success=true`
  10. Frontend calls `refreshPaymentStatus()` to update plan status
- **Environment Variables Required**:
  - Frontend: `VITE_STRIPE_PUBLISHABLE_KEY` (pk_test_... or pk_live_...)
  - Backend: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Payment Status API**: `GET /api/stripe/payment-status`
  - Returns: `{ hasActivePlan: boolean, plan: 'student' | 'enterprise' | null, status: string }`
  - Called by AuthContext on login and when `refreshPaymentStatus()` is invoked
- **Access Control**: Without an active subscription, users can make commits but cannot pull from cloud storage
- **Dashboard**: Users can compare plans via the Dashboard page (`/dashboard`)
- **Checkout**: Users complete payment via the Checkout page (`/checkout`)
- **Verification**: `hasVerifiedPlan` property in AuthContext indicates if user has an active subscription
- **Restrictions**: 
  - Commits: Always allowed (local operations)
  - Pull from cloud storage: Requires active subscription (`status: 'active'`)

### Backend API Server

- **Technology**: Node.js/Express server (`backend/server.js`)
- **Port**: 3000 (configurable via `PORT` env variable)
- **Authentication**: All endpoints (except `/health` and `/api/stripe/webhook`) require Supabase JWT token in `Authorization: Bearer <token>` header
- **Security**: 
  - JWT token verification via Supabase
  - User isolation (users can only access their own resources)
  - Rate limiting (100 requests per 15 minutes per IP)
  - CORS protection
  - Stripe webhook signature verification
- **Environment Variables**: 
  - AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`
  - Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Server: `PORT`, `FRONTEND_URL`

### Cloud Storage (Supabase + AWS S3) - Backend Only

- **Database**: Supabase PostgreSQL (`subscriptions` table is active for payments; projects/commits/branches tables exist but unused)
- **File Storage**: AWS S3 with versioning enabled (backend API ready)
- **Backend API**: `/api/aws/*` endpoints implemented (presigned-upload, presigned-download, list-versions, delete-version)
- **Frontend API Client**: `awsS3API` class exists in `src/lib/aws-api.ts` but is **NEVER IMPORTED OR CALLED**
- **FilesAPI Client**: `filesAPI` class exists but backend `/files/*` endpoints **DON'T EXIST**
- **Frontend Integration**: ❌ NOT implemented - `VersionControlContext` does NOT call any AWS functions
- **Current State**: All version control is 100% local via `0studio_{filename}/` folder - no cloud features are functional

### 3D Scene Management

- **Generated objects**: Stored in ModelContext.generatedObjects
- **Object IDs**: Format: `gen_{timestamp}_{random}`
- **Serialization**: Full state saved in commits
- **Restoration**: Recreates objects from serialized data

### Gallery Mode

- **Selection Limit**: Maximum of 4 commits can be selected
- **Layouts**:
  - 2 commits: Side by side (2 columns, 1 row)
  - 3 commits: 2 on top, 1 full-width on bottom (2 columns, 2 rows)
  - 4 commits: 2x2 grid (2 columns, 2 rows)
- **State Management**: 
  - `isGalleryMode`: Boolean flag in VersionControlContext
  - `selectedCommitIds`: Set of selected commit IDs (max 4)
- **Reset Behavior**: Gallery mode resets when project is closed
- **UI**: Checkboxes in VersionControl component for selection, disabled when limit reached

---

## Key Workflows

### Opening a Project

1. User clicks "Open project" or selects from recent projects (or uses Cmd+O)
2. Electron shows file dialog (or opens via `openProjectByPath` for recent projects)
3. User selects .3dm file (or path from recent list)
4. Electron main process:
   - Sets currentProjectFile
   - Starts file watching
   - Sends 'project-opened' event
5. Renderer receives event (ModelContext.handleProjectOpened):
   - **await setCurrentModel(filePath)** — loads `tree.json` from `0studio_{filename}/` folder first:
     - If exists: Parses and loads branches and commits, validates commit files
     - If missing: Falls back to localStorage (backwards compatibility)
   - Loads .3dm file via rhino3dm-service
   - **createInitialCommit()** — creates first commit only if no commits exist (skips if loaded from tree.json)
   - Tree.json is auto-saved after initial commit
   - Adds to recent projects list

### Committing Changes

**Regular Commit**:
1. User enters commit message
2. VersionControlContext.commitModelChanges()
3. Creates ModelCommit with current modelData and fileBuffer
4. Saves commit file to `0studio_{filename}/commit-{commitId}.3dm` via FileStorageService
5. If cloud enabled, uploads to S3 and creates Supabase commit
6. Adds to commits array
7. Sets as current commit
8. Clears unsaved changes flag
9. Auto-saves `tree.json` via useEffect hook (includes new commit and updated branch head)

### Restoring a Commit

1. User clicks "Restore" on commit in history
2. VersionControlContext.restoreToCommit(commitId)
3. Retrieves fileBuffer from `0studio_{filename}/commit-{commitId}.3dm` (primary source)
   - Falls back to in-memory fileBuffer if file doesn't exist
   - Falls back to IndexedDB if in-memory not available
   - Falls back to exporting from modelData if all else fails
4. Loads file via rhino3dm-service.load3dmFile()
5. Calls onModelRestore callback with modelData
6. ModelContext restores scene:
   - If modelData.objects: setLoadedModel()
   - If serialized objects: restoreScene()
7. Scene updates to show restored state
8. VersionControlContext updates currentCommitId

### Pulling from Commit (Updates File on Disk)

1. User clicks "Pull" button on commit
2. VersionControlContext.pullFromCommit(commitId)
3. Retrieves fileBuffer from `0studio_{filename}/commit-{commitId}.3dm` (primary source)
   - Falls back to in-memory fileBuffer if file doesn't exist
   - Falls back to IndexedDB if in-memory not available
   - Falls back to exporting from modelData if all else fails
4. Writes fileBuffer to disk via desktopAPI.writeFileBuffer()
5. File is updated on disk
6. Rhino detects change and auto-reloads
7. ModelContext reloads model from disk
8. Sets pulledCommitId for branch creation tracking

### Gallery Mode Workflow

1. User clicks "Gallery" button in VersionControl
2. VersionControlContext.toggleGalleryMode() sets isGalleryMode = true
3. User selects commits via checkboxes (max 4, disabled when limit reached)
4. ModelViewer detects selectedCommits and renders grid layout
5. Each selected commit renders in its own Canvas with modelData
6. User can interact with each viewport independently
7. User exits gallery mode → toggleGalleryMode() clears selections and resets state

### Branching Workflow

```
1. User has commits v1, v2, v3 on main branch
   ↓
2. User clicks Download (pull) on v2
   ↓
3. VersionControlContext.pullFromCommit(v2) called
   - Sets pulledCommitId = v2
   - v2 commit gets amber "working" highlight in UI
   - File is written to disk, Rhino reloads
   ↓
4. User makes changes in Rhino and saves
   ↓
5. hasUnsavedChanges = true, UI shows "Creating new branch from v2"
   ↓
6. User enters commit message and clicks "Create Branch & Save"
   ↓
7. commitModelChanges() detects pulledCommitId is not branch head
   - Creates new branch "v2a" with unique color
   - Creates commit on new branch with parentCommitId = v2
   - Clears pulledCommitId
   ↓
8. UI shows branching tree with main (red) and v2a (green) branches
   ↓
9. User can switch branches via dropdown
   ↓
10. User clicks "Keep" to set current branch as main
```

**Branching UI Components**:
- **BranchingTree**: SVG-based visual tree with colored branch lines
  - Dashed horizontal lines for branch points
  - Solid vertical lines for same-branch connections
  - Nodes colored by branch
- **Branch Selector**: Dropdown to switch between branches
- **Keep Button**: Sets current branch as the main branch
- **Version Labels**: Dynamic labels like v1, v2, v3a, v3b, v4a based on branch

**Version Naming Convention**:
- Main branch: v1, v2, v3, v4...
- First branch from v2: v3a (first commit), v4a (second commit)...
- Second branch from v2: v3b, v4b...
- Third branch from v2: v3c, v4c...

### File Change Detection

1. User saves .3dm file in Rhino
2. FileWatcherService detects change (after 1s stability)
3. Electron main sends 'file-changed' IPC event
4. ModelContext.onFileChanged handler:
   - Calls reloadModelFromDisk()
   - Reads file via desktopAPI.readFileBuffer()
   - Parses with rhino3dm-service
   - Updates loadedModel state
5. VersionControlContext.onFileChanged handler:
   - Marks hasUnsavedChanges = true

### Stripe Payment Flow (Embedded Checkout)

```
1. User navigates to Dashboard and clicks a plan (or signs up and goes to Dashboard)
   ↓
2. Dashboard navigates to /checkout?plan=...&priceId=...&price=...
   ↓
3. Checkout page calls POST /api/stripe/create-subscription-intent
   ↓
4. Backend creates Stripe customer (if new) and subscription with PaymentIntent
   ↓
5. Backend stores pending subscription in Supabase
   ↓
6. Checkout page receives clientSecret and renders Stripe PaymentElement
   ↓
7. User enters payment details in embedded form (stays in Electron app)
   ↓
8. User clicks "Subscribe" → stripe.confirmPayment() called
   ↓
9. Stripe processes payment
   ↓
10. Stripe sends webhook: invoice.payment_succeeded
   ↓
11. Backend webhook handler updates subscription status to 'active' in Supabase
   ↓
12. Checkout page detects success and navigates to Dashboard
   ↓
13. Dashboard calls refreshPaymentStatus() in AuthContext
   ↓
14. AuthContext calls GET /api/stripe/payment-status
   ↓
15. AuthContext updates paymentPlan state
   ↓
16. User now has Pro/Enterprise plan (import works on free plan; paid features when enabled)
```

**Note**: No auto-redirect on sign-up; users can use import on free plan and optionally subscribe via Dashboard.

---

## Implementation Gaps & Known Issues

This section documents features that are partially implemented or have known gaps between the API surface and actual functionality.

### Git Integration (Not Connected)
- **Issue**: IPC handlers for Git operations are exposed in `preload.ts` but NOT implemented in `main.ts`
- **Impact**: Calling `desktopAPI.gitStatus()`, `gitCommit()`, etc. will fail silently or throw
- **Workaround**: Version control works via local `tree.json` and commit files
- **Fix Required**: Add `ipcMain.handle()` calls in main.ts that use GitService

### Cloud Sync (Implemented)
- **Status**: ✅ Fully implemented via project-scoped sync endpoints
- **Backend**: New `/api/projects/:id/sync/*` endpoints with member permission checks
- **Frontend**: `cloud-sync-service.ts` orchestrates push/pull; `VersionControlContext` exposes `pushToCloud()` and `pullFromCloud()`
- **UI**: Cloud sync section in VersionControl.tsx with Push/Pull buttons and per-commit cloud indicators
- **Legacy**: `awsS3API` class still exists for direct S3 operations; `FilesAPI` class removed (dead code)

### ProjectInfo Interface Inconsistency
- **Issue**: `getCurrentProject()` in main.ts returns `{filePath, fileName}` but desktop-api.ts expects `{filePath, projectDir, fileName}`
- **Impact**: `projectDir` will be undefined when accessed
- **Fix Required**: Either update main.ts to include projectDir or remove it from interface

---

## Implementation Status Tracker

### Core Features

| Feature | Status | Notes |
|---------|--------|-------|
| 3D Model Viewer | ✅ Implemented | Three.js + React Three Fiber |
| .3dm File Loading | ✅ Implemented | rhino3dm service |
| File Watching | ✅ Implemented | Auto-reload on Rhino save |
| Local Version Control | ✅ Implemented | tree.json + commit files |
| Branching System | ✅ Implemented | Auto-branch on non-head commit |
| Gallery Mode | ✅ Implemented | Up to 4 commits side-by-side |
| macOS Build | ✅ Implemented | DMG for x64 and arm64 |

### Authentication & Payments

| Feature | Status | Notes |
|---------|--------|-------|
| Supabase Auth | ✅ Implemented | Email + Google OAuth |
| Sign Up Flow | ✅ Implemented | No auto-redirect; import available on free plan |
| Sign In Flow | ✅ Implemented | Direct access to app |
| Password Reset | ✅ Implemented | Email-based |
| Stripe Subscriptions | ✅ Implemented | Student and Enterprise plans |
| Embedded Checkout | ✅ Implemented | Stripe Elements in-app |
| Webhook Handling | ✅ Implemented | Subscription lifecycle events |
| Payment Status API | ✅ Implemented | Backend endpoint |

### Cloud Features

| Feature | Status | Notes |
|---------|--------|-------|
| AWS S3 Backend API | ✅ Implemented | `/api/aws/*` (legacy) + `/api/projects/:id/sync/*` (new project-scoped) |
| Cloud Sync Service | ✅ Implemented | `cloud-sync-service.ts` orchestrates push/pull via project-scoped endpoints |
| Cloud Sync (Push) | ✅ Implemented | Uploads unsynced commits + tree.json to S3 with RBAC (editor+) |
| Cloud Sync (Pull) | ✅ Implemented | Downloads remote tree.json, merges commits, downloads commit files (viewer+) |
| Cloud Sync UI | ✅ Implemented | Push/Pull buttons, sync status, per-commit cloud indicators in VersionControl |
| Shared Project Discovery | ✅ Implemented | WelcomePanel "Shared with you" section lists projects via `getUserProjects()` |
| First-Pull Save Dialog | ✅ Implemented | Native save dialog for choosing download location; path saved in localStorage |
| Cloud Project Path Mapping | ✅ Implemented | Per-user localStorage links cloud project IDs to local file paths |
| Shared Project Notifications | ✅ Implemented | Toast notification for newly shared projects on app load |
| Supabase Database | ✅ Active | `subscriptions`, `projects`, `project_members` tables in use |
| Project Collaboration | ✅ Implemented | Settings → Project tab: invite members, roles (owner/editor/viewer) |
| Invite Emails (SES) | ✅ Implemented | Sends email via Amazon SES when a member is invited (requires `INVITE_FROM_EMAIL` env var) |

### Git Integration

| Feature | Status | Notes |
|---------|--------|-------|
| GitService Class | ⚠️ Partial | Exists but not connected to IPC |
| Git IPC Handlers | ❌ Not Implemented | Exposed in preload, not in main |
| Git Commit/Push/Pull | ❌ Not Implemented | Using local tree.json instead |

### UI Components

| Feature | Status | Notes |
|---------|--------|-------|
| TitleBar | ✅ Implemented | macOS-style with user menu |
| VersionControl Panel | ✅ Implemented | Branch tree, commit history |
| ModelViewer | ✅ Implemented | Interactive 3D with orbit controls |
| Dashboard | ✅ Implemented | Plan selection UI |
| Checkout Page | ✅ Implemented | Stripe Elements embedded form |
| Auth Dialog | ✅ Implemented | Login/Signup tabs |
| User Menu | ✅ Implemented | Dropdown with Settings, Plans & Billing, Sign Out |
| Settings Page | ✅ Implemented | Account + Project tabs, team members, permissions |

---

## Recent Updates & Features

### Cloud File Sharing & Sync (v1.11.0 - Latest)

**Project-Scoped Cloud Sync**:
- New backend endpoints: `POST /api/projects/:id/sync/push-url`, `POST .../pull-url`, `GET .../list`
- S3 key format: `projects/{projectId}/tree.json` and `projects/{projectId}/commits/{commitId}.3dm`
- Permission enforcement via `checkProjectPermission()`: editor+ for push, viewer+ for pull/list
- Rate limiting applied to sync endpoints

**Cloud Sync Service** (`src/lib/cloud-sync-service.ts`):
- `CloudSyncService` class with `pushCommitFile()`, `pullCommitFile()`, `pushTreeJson()`, `pullTreeJson()`
- `computeSyncStatus()` compares local vs remote commit sets
- `downloadLatestSnapshot()` pulls tree.json + latest commit .3dm for first-time project download
- Thin service pattern: frontend uploads to presigned URL, backend validates permissions

**Cloud Project Path Mapping** (localStorage helpers in `cloud-sync-service.ts`):
- Per-user localStorage map: `0studio_cloud_paths_{userId}` → `{ [projectId]: localFilePath }`
- `getLocalPathForProject()` / `setCloudProjectPath()` / `findProjectIdByLocalPath()` for bidirectional lookup
- `getSeenSharedProjectIds()` / `markProjectAsSeen()` for notification tracking
- Enables Person B (collaborator) to link their local download path to the cloud project ID

**VersionControlContext Cloud Integration**:
- New state: `cloudProject`, `cloudSyncedCommitIds`, `cloudSyncStatus`, `isCloudSyncing`
- New methods: `pushToCloud()`, `pullFromCloud()`, `refreshCloudStatus()`
- Cloud project detection: first checks localStorage mapping (Person B), then falls back to `getProjectByFilePath()` (Person A)
- `cloudSyncedCommitIds` persisted in local `tree.json` for tracking pushed commits
- Pull merges remote commits/branches into local state (additive merge, no conflict resolution)

**Cloud Sync UI** (`VersionControl.tsx`):
- "Cloud Sync" section shown when project is cloud-enabled
- Displays sync status: commits to push (amber), commits to pull (blue), up-to-date (green)
- Push and Pull buttons with loading spinner
- Per-commit cloud indicator (blue cloud icon) for synced commits

**Shared Project Receiving Flow** (`ModelViewer.tsx` WelcomePanel):
- "Shared with you" section lists projects where user is a member (not owner) via `projectAPI.getUserProjects()`
- "Your cloud projects" section lists user's own cloud-registered projects
- First-time download: native save dialog (`showSaveDialog`) lets user choose local path → downloads latest snapshot from S3 → saves .3dm + tree.json + commit files → opens project
- Subsequent opens: reuses saved local path from localStorage mapping
- In-app notification (toast) when new shared projects are detected (tracks seen projects in localStorage)

**Electron Save Dialog** (new IPC):
- `showSaveDialog` added to `electron/main.ts`, `electron/preload.ts`, `src/lib/desktop-api.ts`
- Used by shared project download to let user choose save location

**Dead Code Removed**:
- `FilesAPI` class removed from `aws-api.ts` (was calling non-existent `/files/*` backend endpoints)
- Associated types (`UploadUrlRequest`, `ModelVersion`, `Model`, etc.) removed

### App-Level Providers & Navigation Persistence (v1.9.0)

**App-level provider tree**:
- `ModelProvider` and `VersionControlProvider` moved from per-route wrappers to **App.tsx**, wrapping all routes (HashRouter → VersionControlProvider → ModelProvider → TooltipProvider → Routes).
- **Order**: `VersionControlProvider` must wrap `ModelProvider` (ModelProvider calls `useVersionControl()`). Reversing the order caused a black screen on load.

**Navigation persistence**:
- After opening a project, navigating to payment (Dashboard or Checkout) and clicking "Back to app" returns the user to the **same open project** (state is no longer lost on route change).
- Same applies when going to Settings and back: open project is preserved.

**Project settings tab**:
- Settings page uses the same app-level ModelContext. When the user had a project open before navigating to Settings, the **Project** tab now shows that project (enable collaboration, members, invites). Previously it showed "No project open" because each page had its own fresh ModelProvider.

**Removed**:
- Per-route provider wrappers removed from Index, Settings, Dashboard, and Checkout. They all consume context from App.

### Settings Panel & Project Collaboration (v1.8.0)

**Settings Page** (`/settings`):
- New Settings page with Account and Project tabs
- **Account tab**: Profile (email, member since), Plan & Billing (current plan, upgrade link, refresh status), Preferences (theme, auto-save), Sign out
- **Project tab**: Visible when a .3dm file is open. Enable collaboration to register project in cloud. Team members list, invite by email with role, change role, remove member. Permission levels legend (Owner, Editor, Viewer)
- TitleBar gear icon and UserMenu now link to Settings (Dashboard renamed to Plans & Billing)

**Project & Member API**:
- Backend endpoints: `POST /api/projects`, `GET /api/projects/user-projects`, `GET /api/projects/by-path`, `GET/POST/PUT/DELETE /api/projects/:id/members`
- Frontend `projectAPI` in `src/lib/project-api.ts` calls these endpoints
- `project_members` table in Supabase (run `PROJECT_MEMBERS_MIGRATION.sql`)

**Permissions**:
- Owner: Full access, manage members, change roles
- Editor: Invite members, commit, branch, pull
- Viewer: Read-only

### Auth-Aware Recent Projects (v1.7.0)

**Per-User Recent Projects**:
- Recent projects are now stored per user in localStorage (`0studio_recent_projects_${userId}`)
- Each user account has its own isolated list of recent projects
- When user signs out, recent projects list is hidden
- When user signs in, their recent projects list reappears
- Projects opened while signed out are not tracked

**Welcome Panel Changes**:
- Shows "Sign in to see your recent projects" when signed out
- Shows user's recent projects list when signed in
- Clicking a recent project opens it in 0studio (Electron only)

**RecentProjectsContext Changes**:
- Now uses `useAuth()` to get current user
- `addRecentProject()` is a no-op when signed out
- List automatically updates when user signs in/out or switches accounts
- Storage key includes user ID: `0studio_recent_projects_${user.id}`

### Free Plan Import & Subscription Changes (v1.6.0)

**Import Available on Free Plan**:
- Removed subscription requirement from model import
- Users can import .3dm files with authentication only (no paid plan required)
- Subscription check removed from `ModelContext.importFile()` and file dialog handler

**Non-Import Features Disabled**:
- Auto-redirect to checkout when user signs in without subscription: **disabled**
- Pull from cloud storage, share features: not implemented (disabled for now)
- Users can use the app on free plan and optionally subscribe via Dashboard

**AuthContext Changes**:
- Removed `justSignedInRef` and subscription redirect logic
- Sign up/sign in no longer redirects to checkout

### Custom Stripe Checkout (v1.4.0)

**Embedded Checkout Page**:
- New `/checkout` route with Stripe Elements integration
- Payment form stays entirely within Electron app (no external redirect)
- Uses `@stripe/react-stripe-js` PaymentElement component
- Two-column layout: plan summary on left, payment form on right
- Shows plan features, price, and secure payment input
- "Compare all plans" button to return to Dashboard
- "Back to app" button to skip checkout

**Checkout Flow** (auto-redirect disabled in v1.6.0 - users go to Dashboard and can subscribe optionally):
- Users navigate to Dashboard and click a plan to reach checkout
- Default Student plan ($10/mo) available when selecting Pro

**New Backend Endpoint**:
- `POST /api/stripe/create-subscription-intent` creates subscription with PaymentIntent
- Creates Stripe customer if not exists
- Uses `payment_behavior: 'default_incomplete'` for embedded flow
- Returns `clientSecret` for Stripe Elements

**Webhook Enhancements**:
- Added `invoice.payment_succeeded` handler to activate subscriptions
- Added `invoice.payment_failed` handler to mark subscriptions as past_due
- Subscription status flows: pending → active (on payment success)

**Environment Variables**:
- `VITE_STRIPE_PUBLISHABLE_KEY` required for frontend Stripe Elements

### macOS App Build (v1.3.0)

**Production Build Configuration**:
- **Custom App Icon**: 1024x1024 PNG icon (`0studio_mac_icon.png`) with auto-conversion to .icns
- **Icon Script**: `scripts/create-icon.sh` validates and prepares icon for electron-builder
- **App Configuration**:
  - Product Name: `0studio`
  - App ID: `com.rhinostudio.app`
  - Category: `public.app-category.developer-tools`
- **DMG Builds**: Supports both x64 and arm64 Mac architectures
- **File Associations**: Opens `.3dm` files directly
- **Build Scripts**:
  - `npm run build:all` - Complete production build
  - `npm run electron:dist` - Build distributable DMG

**Improved 3D Viewport**:
- **Camera Fit-to-Model**: Camera automatically positions to show model at ~60% of viewport
- **Consistent Viewing Angle**: 45° elevation, 45° azimuth isometric-like view for all models
- **Preserved Orientation**: Model orientation from Rhino is preserved (no transforms applied)
- **Adaptive Grid**: Grid cell size scales proportionally to model dimensions
- **Smart Grid Sizing**: Uses "nice numbers" (1, 2, 5, 10, etc.) for grid cell sizes

**Initial Page / Welcome Screen Design** (Cursor-style):
- **Centered Layout**: 0studio branding at top, actions centered below
- **Welcome Panel**: Glass-effect card (backdrop-blur) with:
  - "Open project" primary button (folder icon, opens native dialog in Electron)
  - "Import .3dm file" secondary button
  - Recent projects list (name + shortened path, clickable in Electron when signed in)
  - Shows "Sign in to see your recent projects" when signed out
- **Branch Loading on Open**: When opening (native dialog or recent projects), `setCurrentModel(filePath)` is awaited first—loads branches/commits from `0studio_{filename}/` before createInitialCommit, so version history is restored
- **3D Background**: Canvas and grid always visible behind the panel
- **Recent Projects**: Stored per-user in localStorage (RecentProjectsContext), max 10 items. Hidden when signed out, restored when user signs back in.
- **Settings**: Moved to TitleBar (gear icon to right of username, links to /settings)
- **Conditional Panel Layout**: Resizable version control panel only shown when model is loaded

**Cleaner Branching UI**:
- **Neutral Color Scheme**: Replaced amber/yellow highlighting with gray tones
- **Working Badge**: "working" label instead of "pulled" for active commit
- **Subtle Highlights**: `bg-secondary/30` with `ring-border` for pulled commits
- **Visual Hierarchy**: Better distinction between current, working, and historical commits

**AI Features Removed**:
- All AI-powered commit message generation removed
- Google Gemini integration removed
- `@google/generative-ai` package remains but unused (can be removed)
- Cleaner codebase focused on core version control functionality

### Local File Storage & Tree Persistence
- **Local Commit Storage**: Commits stored as `commit-{commitId}.3dm` files in `0studio_{filename}/` folder
- **Tree.json Persistence**: Branch and commit tree structure persisted to `tree.json` in same folder as commits
- **Dynamic File Paths**: File paths are not hardcoded - dynamically constructed from .3dm file path
- **Auto-Save**: Tree.json automatically saved on any commit/branch change (skips during loading)
- **Project Open**: Loads tree.json via `treeLoadPromise` (primary source, falls back to localStorage)
- **Race Condition Prevention**: `createInitialCommit()` awaits `treeLoadPromise` before checking for existing commits, preventing duplicate initial commits when reopening projects
- **Validation**: Validates commit files exist when loading tree.json, warns about missing files
- **Error Handling**: Graceful error handling during save/load, doesn't throw on project close

### Branching System
- **GitHub-like Branching**: Automatic branch creation when committing from a non-head commit
- **Visual Branch Tree**: SVG-based tree visualization with colored branch lines
- **Pulled Commit Highlighting**: Amber highlight and "working" badge for the active pulled commit
- **Branch Selector**: Dropdown to switch between branches when multiple exist
- **Keep Branch**: Button to mark any branch as the main/master branch
- **Dynamic Version Labels**: Automatic labeling (v1, v2, v3a, v3b, v4c, etc.)
- **Branch Colors**: Each branch gets a unique color from a predefined palette

### Gallery Mode
- **Selection Limit**: Maximum 4 commits can be selected for comparison
- **Adaptive Layouts**: 
  - 2 models: Side by side
  - 3 models: 2 on top, 1 full-width on bottom
  - 4 models: 2x2 grid
- **State Management**: Proper reset when project is closed
- **UI**: Checkboxes with disabled state when limit reached

### Cloud File Sharing (Implemented)
- **Project-Scoped S3 Sync**: New `/api/projects/:id/sync/*` endpoints with member permission checks
- **S3 Key Format**: `projects/{projectId}/tree.json` and `projects/{projectId}/commits/{commitId}.3dm`
- **Push**: Uploads unsynced commit files + tree.json to S3 (requires editor+ role)
- **Pull**: Downloads remote tree.json, identifies new commits, downloads their .3dm files, merges into local state (requires viewer+ role)
- **Sync Status**: Tracks `localOnly`, `remoteOnly`, and `synced` commit arrays
- **UI**: Cloud sync section in VersionControl with Push/Pull buttons, sync status, per-commit cloud indicators
- **Service**: `cloud-sync-service.ts` orchestrates all cloud operations via presigned URLs
- **Persistence**: `cloudSyncedCommitIds` persisted in local tree.json for tracking which commits have been pushed
- **Dead Code Removed**: `FilesAPI` class removed from `aws-api.ts` (was calling non-existent `/files/*` endpoints)

### Payment System
- **Stripe Integration**: Full subscription management
- **Webhook Handling**: Automatic subscription status updates
- **Dashboard**: User-friendly plan selection interface

### Bug Fixes
- **Provider order / black screen**: With app-level providers, wrong order (ModelProvider wrapping VersionControlProvider) caused `useVersionControl()` to run before provider mounted; fixed by ensuring VersionControlProvider wraps ModelProvider in App.tsx.
- **Checkout JSX**: Fixed missing closing `</div>` in Checkout.tsx return that caused build/lint error.
- **Tree.json Persistence**: Fixed race condition where `createInitialCommit` could run before tree.json finished loading—ModelContext now awaits `setCurrentModel(filePath)` before `createInitialCommit`, ensuring branches/commits from `0studio_{filename}/` are loaded when opening (native dialog or recent projects)
- **Gallery Mode Reset**: Fixed bug where gallery mode background persisted after closing project
- **Grid Layout**: Fixed 3 and 4 model layouts to display correctly
- **Selection Limit**: Proper enforcement of 4-commit maximum

---

## Environment Variables

### Frontend
- `VITE_SUPABASE_URL`: Supabase project URL (required for auth and database)
- `VITE_SUPABASE_ANON_KEY`: Supabase anonymous key (required for auth and database)
- `VITE_BACKEND_URL`: Backend API URL (defaults to `http://localhost:3000`)
  - Used for both AWS S3 operations and Stripe payment operations
  - Can also use `VITE_AWS_API_URL` for backward compatibility
- `VITE_STRIPE_PUBLISHABLE_KEY`: Stripe publishable key (required for checkout)
  - Test mode: `pk_test_...`
  - Live mode: `pk_live_...`

### Backend
- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
- `AWS_REGION`: AWS region (e.g., us-east-1)
- `S3_BUCKET_NAME`: S3 bucket name
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `STRIPE_SECRET_KEY`: Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook secret
- `INVITE_FROM_EMAIL`: (optional) Verified SES sender address for invite emails (e.g., `noreply@yourdomain.com`). If unset, invite emails are silently skipped.
- `PORT`: Server port (default: 3000)
- `FRONTEND_URL`: Frontend URL for CORS

---

## Notes for AI Agent

### When Adding Features

1. **Check existing contexts**: ModelContext, VersionControlContext, AuthContext
2. **Use desktop-api.ts**: For Electron IPC, don't call window.electronAPI directly
3. **Scene manipulation**: Use ModelContext methods (addPrimitive, transformObject, etc.)
5. **Cloud operations**: 
   - Project-scoped sync endpoints: `/api/projects/:id/sync/push-url`, `/pull-url`, `/list`
   - `cloud-sync-service.ts` orchestrates all push/pull operations
   - `VersionControlContext` exposes `pushToCloud()`, `pullFromCloud()`, `refreshCloudStatus()`
   - Push requires editor+ role; Pull/List requires viewer+ role
   - Legacy `/api/aws/*` endpoints still work for direct S3 operations
   - `awsS3API` class in `aws-api.ts` still available but cloud sync uses `cloudSyncService`
   - Cloud project path mapping stored in localStorage (`0studio_cloud_paths_{userId}`)
   - Person B (collaborator) discovers shared projects in WelcomePanel, chooses save location on first download
   - `showSaveDialog` IPC available in `desktop-api.ts` for native save dialogs
6. **Authentication**: Use AuthContext and check user state - works for payment plans
7. **Payment plans**: 
   - Payment plans managed via Stripe subscriptions stored in Supabase `subscriptions` table
   - Use `refreshPaymentStatus()` in AuthContext to reload payment status from backend
   - New users auto-redirect to `/checkout` after sign up (handled in AuthContext)
   - Checkout page uses Stripe Elements for embedded payment (no external redirect)
   - Requires `VITE_STRIPE_PUBLISHABLE_KEY` environment variable
8. **UI components**: Prefer Shadcn UI from `src/components/ui/`
9. **Forms**: Use Shadcn Forms pattern
10. **State management**: Use contexts for global state, useState for local
11. **Provider architecture**: 
    - `ModelProvider` and `VersionControlProvider` live in **App.tsx** and wrap all routes (single tree for the whole app).
    - **Order is critical**: `VersionControlProvider` must wrap `ModelProvider` (ModelProvider uses `useVersionControl()` internally). Wrong order causes black screen on load.
    - Index, Dashboard, Checkout, and Settings do **not** wrap with these providers; they consume context from App.
    - This gives: (1) same open project when returning from payment/settings; (2) Project settings tab sees current project when user had one open.
12. **UserMenu**: Clicking user email in TitleBar opens dropdown with Settings, Plans & Billing, Sign Out
13. **Settings & Project API**: Use `projectAPI` from `src/lib/project-api.ts` for project registration, members, invites. Run `PROJECT_MEMBERS_MIGRATION.sql` in Supabase before using. Permission checks: owners can manage members; editors can invite
14. **Gallery Mode**: 
    - Maximum 4 commits can be selected
    - Reset gallery mode state when closing project
    - Use explicit grid positioning for 4-commit layout
15. **Branching**:
    - Branches are created automatically when committing from a non-head commit (pulledCommitId set)
    - Use `getCommitVersionLabel()` to get proper version labels (v1, v2, v3a, v3b)
    - Check `pulledCommitId` to determine if user is about to create a new branch
    - `switchBranch()` changes active branch, `keepBranch()` marks a branch as main
    - Branch colors are assigned from `BRANCH_COLORS` array in order of creation
    - Reset branches when closing project via `clearCurrentModel()`
16. **Local File Storage**:
    - Commit files stored in `0studio_{filename}/` folder as `commit-{commitId}.3dm`
    - Tree.json stored in same folder, contains full branch and commit metadata
    - File paths are NOT hardcoded - dynamically constructed from .3dm file path using `dirname()` and `basename()`
    - Use `desktopAPI.saveCommitFile()`, `readCommitFile()`, `saveTreeFile()`, `loadTreeFile()`
    - Tree.json auto-saves via useEffect when branches/commits change (skips during `isLoadingTree`)
    - Load tree.json on project open via `treeLoadPromise`, validate commit files exist
    - `createInitialCommit()` awaits `treeLoadPromise` to prevent race conditions and duplicate commits
    - Save tree.json before project close to ensure persistence
    - Handle errors gracefully (log warnings, don't throw)

17. **Building for Distribution**:
    - Run `npm run build:all` for complete production build
    - Icon must be 1024x1024 PNG for proper .icns conversion
    - DMG output goes to `dist-electron/` directory
    - App supports both Intel (x64) and Apple Silicon (arm64) Macs
    - File associations allow double-clicking .3dm files to open in 0studio

### Common Patterns

- **File operations**: Always check `desktopAPI.isDesktop` before calling
- **Error handling**: Wrap async operations, show toast on error
- **Type safety**: Use TypeScript interfaces, avoid `any`
- **Serialization**: ModelContext provides serializeScene/restoreScene
- **Event cleanup**: Remove IPC listeners in useEffect cleanup
- **Gallery mode**: Check `isGalleryMode` and `selectedCommitIds.size` before rendering gallery

### Testing File Watching

1. Open a .3dm file in 0studio
2. Note the file path in console
3. Save a .3dm file to that path (or modify existing)
4. App should auto-reload and show unsaved changes

---

**End of PRD Context Document**
