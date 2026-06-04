---
title: "feat: Fix and enhance commit history graph view"
type: feat
status: completed
date: 2026-04-02
---

# feat: Fix and enhance commit history graph view

## Overview

The commit history graph view (`BranchingTree`) already exists in the codebase but is unreachable because the Settings toggle writes to localStorage without triggering a re-render. This plan fixes the reactivity bug, adds an inline toggle to the version control panel, and polishes the graph view with branch labels and better layout.

## Problem Statement

1. **Toggle is broken**: `Settings.tsx:182` writes to localStorage, but `VersionControl.tsx:633` reads it as a plain `const` — no re-render occurs. Users must navigate away and back for the change to take effect, making it appear non-functional.
2. **No inline toggle**: The only way to switch views is buried in the Settings page. Users expect to toggle directly from the version control sidebar.
3. **Graph view lacks branch labels**: Colored SVG lines have no branch name labels — users can't tell which line is which branch.
4. **Filtering breaks graph topology**: When search/starred filters remove intermediate commits, parent-child connections break, producing disconnected floating nodes.
5. **Column overflow with many branches**: Each branch gets a column (24px wide). With 5+ branches, commit text gets pushed off-screen in the ~300px sidebar.

## Proposed Solution

### Phase 1: Fix reactivity (core bug fix)

**Create a `useViewMode` hook** that wraps `useState` initialized from localStorage and syncs writes back. Both the inline toggle and the Settings toggle use this shared state.

**Files to modify:**
- `src/components/VersionControl.tsx:633` — replace raw localStorage read with `useViewMode()` hook
- `src/pages/Settings.tsx:180-182` — replace raw localStorage read/write with `useViewMode()` hook
- **New file**: `src/hooks/useViewMode.ts` — custom hook with `useState` + `localStorage` sync

```typescript
// src/hooks/useViewMode.ts
import { useState, useCallback } from 'react';

const STORAGE_KEY = '0studio_version_history_view';
type ViewMode = 'list' | 'graph';

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ViewMode) || 'list'
  );

  const setMode = useCallback((newMode: ViewMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  return [mode, setMode];
}
```

> **Note**: Since `VersionControl` and `Settings` are separate component trees, `useState` won't share state across them. Two options: (a) lift to a shared context, or (b) use a `storage` event listener to sync across components. Option (b) is simpler — add a `storage` event listener in the hook that updates state when another component writes to the same key. However, `storage` events only fire across tabs/windows, not within the same window. For same-window sync, use a tiny shared context or a custom event (`window.dispatchEvent(new Event('viewmode-changed'))`). The custom event approach is simplest and avoids adding another context provider.

### Phase 2: Add inline toggle to the version control panel

Add a small segmented control (list/graph icons) in the version control sidebar header, next to the existing search and filter controls.

**Files to modify:**
- `src/components/VersionControl.tsx` — add toggle UI in the sidebar header area (around line 800-830 where the search/filter controls are)

Use `lucide-react` icons: `List` for list view, `GitBranch` or `Network` for graph view. Style as a compact segmented toggle using existing shadcn/ui `ToggleGroup` or simple button pair with `bg-secondary` active state.

### Phase 3: Add branch labels to graph view

Add branch name labels at the top of each column in the SVG graph rail.

**Files to modify:**
- `src/components/VersionControl.tsx` — `BranchingTree` component, add a header row above the SVG with branch names positioned at each column's x-offset

Implementation:
- Add a `div` row above the SVG/commit area with absolute-positioned branch name badges
- Each badge sits at `left: column * 24px + 10px`, styled as a small `Badge` with the branch color as border/text color
- Main branch shows "main", others show their auto-generated name (e.g., "v3a")

### Phase 4: Fix filtering behavior in graph view

When commits are filtered (search or starred-only), pass **all commits** to `BranchingTree` but add a `highlightedCommitIds: Set<string>` prop for the filtered subset. Non-matching commits render dimmed (opacity-30) but preserve graph connections.

**Files to modify:**
- `src/components/VersionControl.tsx`:
  - `BranchingTreeProps` interface (line 43) — add `highlightedCommitIds?: Set<string>`
  - `BranchingTree` component (line 57) — use `highlightedCommitIds` to dim non-matching nodes and rows
  - Main `VersionControl` component (line 887) — pass `commits={commits}` (all) + `highlightedCommitIds={new Set(filteredCommits.map(c => c.id))}` when in graph mode; keep passing `filteredCommits` for list mode

### Phase 5: Smart column allocation

Only allocate x-columns for branches that have at least one visible commit. Reuse freed columns.

**Files to modify:**
- `src/components/VersionControl.tsx` — `BranchingTree` useMemo layout (lines 88-110): filter `branchCommits` to only branches with commits present in the input, then assign columns

## Technical Considerations

- **No new dependencies needed.** The existing SVG approach is sufficient. The layout algorithm is simple enough that dagre/elkjs would be overkill for a linear branch model (no merges).
- **Performance**: The `useMemo` layout computation (lines 72-155) is O(n) where n = commits. Even with 200+ commits this is sub-millisecond. No need for virtualization or `startTransition` yet.
- **Height contract**: SVG node y-positions are calculated from hardcoded row heights (36px unstarred, 56px starred). Any CSS changes to commit row styling must preserve these exact heights or the SVG nodes will drift out of alignment. Add a comment documenting this contract.

## System-Wide Impact

- **State management**: Adding a custom event for view mode sync is minimal impact. No new context providers needed.
- **Settings page**: The Settings toggle continues to work but now uses the same reactive hook, so changes take effect immediately.
- **Error propagation**: No new error paths. The graph view is purely presentational.
- **API surface parity**: Both list and graph views must support identical interactions (star, restore, pull, gallery checkbox, cloud sync icon, presence avatars). The existing `BranchingTree` already mirrors `BranchListView` interactions.

## Acceptance Criteria

- [ ] Changing the Settings dropdown from "List" to "Graph" immediately switches the view (no navigation required)
- [ ] An inline toggle (list/graph icons) appears in the version control sidebar header
- [ ] The inline toggle and Settings dropdown stay in sync
- [ ] Graph view shows branch name labels at the top of each branch column
- [ ] Filtering (search + starred-only) dims non-matching commits in graph view while preserving connections
- [ ] Graph view with 5+ branches does not push commit text off-screen (only visible branches get columns)
- [ ] All commit interactions work identically in both views: click to restore, star/unstar, pull/download, gallery checkbox
- [ ] View mode preference persists across app restarts (localStorage)

## Implementation Order

1. **Phase 1** (reactivity fix) — unblocks everything, ~30 min
2. **Phase 2** (inline toggle) — best UX win, ~20 min
3. **Phase 3** (branch labels) — visual clarity, ~20 min
4. **Phase 4** (filter behavior) — correctness fix, ~30 min
5. **Phase 5** (column allocation) — edge case polish, ~15 min

Phases 1-2 are the critical path. Phases 3-5 are polish that can ship incrementally.

## Sources & References

### Internal References

- Toggle implementation: `src/pages/Settings.tsx:175-192`
- View mode read: `src/components/VersionControl.tsx:633`
- BranchingTree component: `src/components/VersionControl.tsx:57-391`
- BranchListView component: `src/components/VersionControl.tsx:394-584`
- Conditional rendering: `src/components/VersionControl.tsx:871-901`
- Data model (ModelCommit, Branch): `src/contexts/VersionControlContext.tsx:10-34`
- Tree persistence: `electron/services/file-storage-service.ts:186-217`
