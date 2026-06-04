# Team Presence (Sharing Live Display)

**Implemented:** 2026-03-13

## Overview

Real-time awareness of who is viewing or editing a shared 3D model project. When multiple team members are connected to the same cloud project, they see a live roster of online members and colored avatar indicators on commit nodes.

## What Users See

- **Team Panel** in the sidebar listing all online members with green status dots, sorted by join time
- **Presence avatars on commits** — colored circles with initials appear next to commit nodes when teammates are viewing that commit (up to 3 shown, with a `+N` overflow badge)
- **Status messages** — each user can set a custom status (e.g. "reviewing model") visible to all teammates
- **Live updates** — joins, leaves, commit navigation, and status changes propagate instantly

## Architecture

### Supabase Realtime Presence (no backend needed)

All presence communication happens client-side through Supabase Realtime channels. No backend endpoints or database tables are involved.

- One channel per cloud project: `presence:project:{projectId}`
- Each user's `userId` is the presence key (one entry per user per channel)
- State is ephemeral — not persisted to any database
- Supabase handles automatic cleanup (~30s) when a client disconnects

### Key Files

| File | Role |
|------|------|
| `src/lib/presence-service.ts` | Core service wrapping Supabase Realtime. Manages channel lifecycle, tracks/untracks user state. Exports `colorForUser()` and `PRESENCE_COLORS`. |
| `src/contexts/PresenceContext.tsx` | React context exposing `onlineUsers`, `joinProject()`, `leaveProject()`, `updatePresenceCommit()`, `updatePresenceStatus()` |
| `src/components/CommitPresenceAvatars.tsx` | Inline avatar row rendered on each commit node. Filters online users by `commitId`, shows up to 3 + overflow badge. |
| `src/components/TeamPresencePanel.tsx` | Collapsible sidebar section listing all online members with status input field. Hidden when user is alone. |
| `src/contexts/VersionControlContext.tsx` | Integration point — calls `joinProject` on cloud project load, broadcasts `currentCommitId` on navigation |
| `src/components/VersionControl.tsx` | Renders `CommitPresenceAvatars` next to each commit and `TeamPresencePanel` in the sidebar |
| `src/App.tsx` | Provider nesting: `PresenceProvider` wraps `VersionControlProvider` inside `AuthProvider` |

### Data Model

```typescript
interface PresenceUser {
  userId: string;
  email: string;
  displayName: string;
  color: string;           // deterministic from userId hash → 1 of 8 colors
  currentCommitId: string | null;
  statusMessage: string;
  joinedAt: string;        // ISO timestamp
}
```

## Key Flows

**Opening a cloud project:**
1. `VersionControlContext` detects `cloudProject.id` change
2. Calls `PresenceContext.joinProject(projectId)`
3. `PresenceService` creates channel, subscribes, and `track()`s the user's state
4. `sync` events update `onlineUsers` state, triggering UI re-renders

**Navigating to a commit:**
1. `VersionControlContext` sets `currentCommitId`
2. Calls `updatePresenceCommit(commitId)` which re-`track()`s updated state
3. All subscribers receive the sync event and update their UI

**Teammate joins:**
1. Their client subscribes to the same channel and `track()`s
2. Supabase fires `sync` to all existing subscribers
3. `TeamPresencePanel` and `CommitPresenceAvatars` re-render with the new user

## Design Decisions

- **Client-side only** — Supabase Realtime is built into `@supabase/supabase-js`, no extra infrastructure
- **Deterministic colors** — `colorForUser()` hashes userId to one of 8 colors so the same person always appears the same color across all clients
- **Graceful degradation** — presence only activates on cloud projects; local-only projects show no presence UI; broadcast failures are silently swallowed
- **No validation** — Supabase Realtime doesn't validate identity server-side; presence keys are trusted client-side (this is acceptable for the use case and is leveraged by the sim dashboard for testing)

## Limitations

- ~30s ghost window if a client crashes without untracking
- No historical presence queries — current state only
- Status messages are ephemeral (lost on disconnect)
- Channel concurrency limits around 20 subscribers per IP
