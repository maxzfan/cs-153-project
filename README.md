# 0studio

Version control for your Rhino 3D models — without the complexity.

0studio watches your `.3dm` file and lets you save snapshots of your work as you go. Browse your history, compare versions side-by-side, and restore any previous state in one click.

---

## What it does

- **Save versions** of your model as you work, with a short description of what changed
- **Restore any version** instantly — your file is updated automatically
- **Compare versions** side-by-side in gallery mode (up to 4 at once)
- **Branching** — explore a new direction without losing your original
- **Cloud sync** — access your history from any machine (subscription required)

---

## Installation

1. Download the latest `.dmg` file
2. Open the `.dmg` and drag **0studio** into your Applications folder
3. Open the app

**If macOS blocks the app** with an "unidentified developer" warning:

- Right-click (or Control-click) `0studio.app` and select **Open**
- Click **Open** in the dialog that appears
- macOS will remember your choice going forward

Alternatively, go to **System Settings → Privacy & Security** and click **Open Anyway**.

---

## Getting started

1. Open 0studio
2. Click **Open .3dm Project** and select your Rhino file
3. Your model loads in the 3D viewer — you're ready to start saving versions

From here, work in Rhino as you normally would. When you save your file, 0studio detects the change and prompts you to save a version.

---

## Saving a version

When 0studio detects a change to your file:

1. A prompt appears in the sidebar
2. Type a short description of what changed (e.g. "widened base", "added roof detail")
3. Click **Save Version**

That's it. Your version is saved locally and appears in the history panel.

---

## Restoring a version

1. Click any version in the history panel to preview it in the 3D viewer
2. Click **Restore** to write that version back to your `.3dm` file
3. Rhino will detect the file change and update automatically

---

## Comparing versions (Gallery mode)

1. Click **Gallery** in the toolbar
2. Select 2–4 versions from your history
3. They appear side-by-side for comparison

---

## Branching

When you restore an older version and save new changes from it, 0studio creates a new branch — a separate line of history that doesn't overwrite your original work. You can switch between branches at any time.

---

## Cloud sync

With a subscription, your version history is backed up to the cloud and accessible from any device.

1. Sign in or create an account
2. Go to **Dashboard** and choose a plan
3. Your versions will sync automatically

---

## Requirements

- macOS 10.14 or later
- Rhino 3D (for editing `.3dm` files)

---

## Rubric

### Problem & Insight

3D designers and architects have no native version control. The standard workflow is a
graveyard of files named `model_v2_FINAL_revised_ACTUAL_FINAL.3dm`. There is no way to
branch, no way to restore a previous state without manual backups, and no way to see what
changed between two versions. Git — the tool software engineers rely on for exactly this
problem — doesn't work on Rhino's binary `.3dm` format.

0studio brings Git-style versioning to the design studio without requiring designers to
touch a terminal. The approach is original in that it combines a file-system watcher,
a WebAssembly geometry parser (rhino3dm.js), and a cloud sync backend into a single
native desktop app purpose-built for `.3dm` workflows — something that does not exist
in the current tooling landscape.

---

### Execution & Technical Work

The app is fully functional end-to-end. A user can:

1. Open a `.3dm` project in 0studio
2. Work in Rhino as normal — 0studio detects saves automatically via a file watcher
3. Name and save a version snapshot (stored locally and optionally synced to Supabase)
4. Preview any past version in the embedded 3D viewer (powered by rhino3dm WASM)
5. Restore any version with one click — Rhino detects the file change automatically
6. Branch by restoring an old version and continuing from it
7. Compare up to 4 versions side-by-side in Gallery mode

**Stack:** Electron (main + renderer), React 18 + TypeScript + Vite + Tailwind CSS +
shadcn/ui, chokidar for file watching, rhino3dm.js (openNURBS compiled to WASM) for
geometry parsing, Supabase for auth / Postgres metadata / cloud object storage,
Homebrew Cask + DMG for distribution.

The project went through multiple iterations: early versions used a polling approach for
file detection (replaced with chokidar event listeners), the 3D viewer went through two
rendering approaches before settling on rhino3dm WASM, and the backend moved from a
custom Express API to Supabase to reduce infrastructure complexity.

---

### Evaluation & Evidence

- **Functional testing:** The full version save → restore → branch cycle was tested on
  real `.3dm` files of varying complexity. The file watcher reliably detects Rhino saves
  without manual intervention.
- **3D viewer:** rhino3dm WASM correctly parses and renders geometry in-browser. Gallery
  mode was verified with 2, 3, and 4 simultaneous version panes.
- **Cloud sync:** Supabase Auth, plan gating, binary version upload, and cross-device
  restore were all confirmed working.
- **Distribution:** The Homebrew formula and DMG installer were verified on macOS 10.14+.
  The Gatekeeper workaround is documented in the README.

**Known limitations:**
- macOS only at this stage; Windows/Linux would require additional Electron packaging work
- No conflict detection for teams editing the same file concurrently
- Cloud sync requires a paid subscription; the free tier is local-only
- Gallery compare is read-only — you cannot merge geometry between versions

---

### Communication & Presentation

This README covers installation, first-run setup, and all major features with step-by-step
instructions written for a designer audience (not developers). A demo video walks through
the full workflow. The app itself surfaces only the concepts a designer needs — versions,
branches, restore, compare — without exposing Git internals or requiring CLI usage.

The Homebrew install path (`brew install --cask 0studio`) and the macOS Gatekeeper
workaround are both documented to ensure any macOS user can run the app without a build
step.

---

### Process, Integrity & Disclosure

**AI usage:** Claude (Anthropic) was used during development for debugging, boilerplate
generation, and drafting documentation. All architectural decisions, feature scoping, and
core implementation were made and written by the project authors.

**Third-party code and credits:**
- [rhino3dm.js](https://github.com/mcneel/rhino3dm) — McNeel's openNURBS WASM build,
  used under the MIT license for parsing and rendering `.3dm` geometry in the viewer
- [Supabase](https://supabase.com) — open-source Firebase alternative, used for auth,
  database, and storage
- [shadcn/ui](https://ui.shadcn.com) — component library, used as-is for UI primitives
- [chokidar](https://github.com/paulmillr/chokidar) — file watching library

All application code is original.

**Major decisions:**
- Chose Electron over a browser extension to get reliable file-system access
- Chose Supabase over a custom backend to ship faster and avoid managing infrastructure
- Chose rhino3dm WASM over shelling out to a Rhino process, which would have required
  Rhino to be installed and running
- Scoped Windows/Linux support out of v1 to ship a polished macOS experience first

Development history is not reflected in this commit log because it was ported over from a private repository.
