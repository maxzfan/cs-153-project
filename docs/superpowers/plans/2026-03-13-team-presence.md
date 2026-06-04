# Team Presence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real-time team presence on the commit tree — who is online, which commit they're viewing, and a Discord-style status message they can set.

**Architecture:** Use Supabase Realtime Presence (built into `@supabase/supabase-js`, already installed) to broadcast ephemeral user state per project channel. No backend changes or DB migrations needed — Realtime Presence is client-side and fully managed by Supabase. Each user joins a channel keyed to their `cloudProject.id`, tracks their `{ userId, email, currentCommitId, statusMessage, color }`, and all other members in that channel receive the updates automatically.

**Tech Stack:** Supabase Realtime Presence (`supabase.channel().on('presence', ...).track()`), React Context, existing Shadcn UI components (Avatar, Badge, Popover)

---

## Chunk 1: Presence Service & Context

### Task 1: Presence service

**Files:**
- Create: `src/lib/presence-service.ts`

This service wraps the Supabase Realtime channel. It is a class that takes a `supabase` client and manages one channel at a time (one per open project).

- [ ] **Step 1: Create `src/lib/presence-service.ts`**

```typescript
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export interface PresenceUser {
  userId: string;
  email: string;
  displayName: string; // first part of email
  color: string;       // deterministic color from userId
  currentCommitId: string | null;
  statusMessage: string;
  joinedAt: number;
}

// 8 distinct colors for team member avatars
const PRESENCE_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6',
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

function displayName(email: string): string {
  return email.split('@')[0];
}

export type PresenceChangeCallback = (users: PresenceUser[]) => void;

export class PresenceService {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private projectId: string | null = null;
  private myState: Partial<PresenceUser> = {};
  private onChange: PresenceChangeCallback | null = null;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  join(projectId: string, user: { id: string; email: string }, onChange: PresenceChangeCallback) {
    // Leave any existing channel first
    this.leave();

    this.projectId = projectId;
    this.onChange = onChange;
    this.myState = {
      userId: user.id,
      email: user.email,
      displayName: displayName(user.email),
      color: colorForUser(user.id),
      currentCommitId: null,
      statusMessage: '',
      joinedAt: Date.now(),
    };

    this.channel = this.supabase.channel(`presence:project:${projectId}`, {
      config: { presence: { key: user.id } },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => {
        this._emitState();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel!.track(this.myState);
        }
      });
  }

  async updateCommit(commitId: string | null) {
    this.myState = { ...this.myState, currentCommitId: commitId };
    await this._track();
  }

  async updateStatus(statusMessage: string) {
    this.myState = { ...this.myState, statusMessage };
    await this._track();
  }

  leave() {
    if (this.channel) {
      this.channel.untrack();
      this.supabase.removeChannel(this.channel);
      this.channel = null;
      this.projectId = null;
    }
  }

  private async _track() {
    if (this.channel) {
      await this.channel.track(this.myState);
    }
  }

  private _emitState() {
    if (!this.channel || !this.onChange) return;
    const state = this.channel.presenceState<Partial<PresenceUser>>();
    const users: PresenceUser[] = Object.values(state)
      .flat()
      .map((p) => p as PresenceUser)
      .filter((p) => p.userId && p.email)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    this.onChange(users);
  }
}
```

- [ ] **Step 2: Manually verify shape**

  Open `src/lib/presence-service.ts` and confirm:
  - `PresenceUser` interface has all fields
  - `join()` creates the channel with the correct key `presence:project:{id}`
  - `leave()` cleans up the channel
  - No TypeScript errors (run `npx tsc --noEmit` from the root)

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors related to `presence-service.ts`

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/presence-service.ts
  git commit -m "feat: add PresenceService wrapping Supabase Realtime presence"
  ```

---

### Task 2: PresenceContext

**Files:**
- Create: `src/contexts/PresenceContext.tsx`

Wraps `PresenceService` in a React context. Joins/leaves the channel when `cloudProject` changes. Exposes the list of online users and methods to update commit/status.

- [ ] **Step 1: Create `src/contexts/PresenceContext.tsx`**

```typescript
import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { PresenceService, PresenceUser } from '@/lib/presence-service';

interface PresenceContextType {
  onlineUsers: PresenceUser[];
  myUserId: string | null;
  updatePresenceCommit: (commitId: string | null) => Promise<void>;
  updatePresenceStatus: (message: string) => Promise<void>;
  joinProject: (projectId: string) => void;
  leaveProject: () => void;
}

const PresenceContext = createContext<PresenceContextType | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const serviceRef = useRef<PresenceService>(new PresenceService(supabase));
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  // Clean up on unmount
  useEffect(() => {
    const svc = serviceRef.current;
    return () => svc.leave();
  }, []);

  const joinProject = useCallback((projectId: string) => {
    if (!user) return;
    serviceRef.current.join(projectId, { id: user.id, email: user.email ?? '' }, setOnlineUsers);
  }, [user]);

  const leaveProject = useCallback(() => {
    serviceRef.current.leave();
    setOnlineUsers([]);
  }, []);

  const updatePresenceCommit = useCallback(async (commitId: string | null) => {
    await serviceRef.current.updateCommit(commitId);
  }, []);

  const updatePresenceStatus = useCallback(async (message: string) => {
    await serviceRef.current.updateStatus(message);
  }, []);

  return (
    <PresenceContext.Provider value={{
      onlineUsers,
      myUserId: user?.id ?? null,
      updatePresenceCommit,
      updatePresenceStatus,
      joinProject,
      leaveProject,
    }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used inside PresenceProvider');
  return ctx;
}
```

- [ ] **Step 2: Add PresenceProvider to `src/App.tsx`**

  Read `src/App.tsx`. Add the import and wrap inside the existing provider tree, **inside** `VersionControlProvider` (so presence can later receive the cloudProject id from VC context):

  ```typescript
  import { PresenceProvider } from "@/contexts/PresenceContext";
  ```

  Change the render tree from:
  ```tsx
  <VersionControlProvider>
    <ModelProvider>
  ```
  to:
  ```tsx
  <VersionControlProvider>
    <PresenceProvider>
      <ModelProvider>
  ```
  and close `</PresenceProvider>` after `</ModelProvider>`.

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/contexts/PresenceContext.tsx src/App.tsx
  git commit -m "feat: add PresenceContext and wire into provider tree"
  ```

---

### Task 3: Connect VersionControlContext → PresenceContext

When the user's `currentCommitId` or `cloudProject` changes, broadcast via presence.

**Files:**
- Modify: `src/contexts/VersionControlContext.tsx`

- [ ] **Step 1: Locate the join/leave logic needed**

  Read `src/contexts/VersionControlContext.tsx`. Find:
  1. Where `cloudProject` is set (look for `setCloudProject`)
  2. Where `currentCommitId` is updated (look for `setCurrentCommitId`)

- [ ] **Step 2: Add presence integration**

  At the top of `VersionControlContext.tsx`, add the import:
  ```typescript
  import { usePresence } from '@/contexts/PresenceContext';
  ```

  Inside the `VersionControlProvider` function body, add:
  ```typescript
  const { joinProject, leaveProject, updatePresenceCommit } = usePresence();
  ```

  Add a `useEffect` that joins/leaves the presence channel when `cloudProject` changes. Place it near other cloudProject effects:
  ```typescript
  useEffect(() => {
    if (cloudProject?.id) {
      joinProject(cloudProject.id);
    } else {
      leaveProject();
    }
    return () => leaveProject();
  }, [cloudProject?.id]);
  ```

  After each place where `setCurrentCommitId(id)` is called (there should be a few), add:
  ```typescript
  updatePresenceCommit(id);
  ```
  Also call `updatePresenceCommit(null)` where current commit is cleared.

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/contexts/VersionControlContext.tsx
  git commit -m "feat: broadcast commit position and project join/leave to presence channel"
  ```

---

## Chunk 2: UI Components

### Task 4: CommitPresenceAvatars component

Small row of colored avatar circles shown next to a commit node when one or more teammates are currently viewing that commit.

**Files:**
- Create: `src/components/CommitPresenceAvatars.tsx`

- [ ] **Step 1: Create `src/components/CommitPresenceAvatars.tsx`**

```typescript
import { usePresence } from '@/contexts/PresenceContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  commitId: string;
}

export function CommitPresenceAvatars({ commitId }: Props) {
  const { onlineUsers, myUserId } = usePresence();

  const watchers = onlineUsers.filter(
    (u) => u.currentCommitId === commitId && u.userId !== myUserId
  );

  if (watchers.length === 0) return null;

  return (
    <div className="flex items-center -space-x-1">
      {watchers.slice(0, 3).map((u) => (
        <Tooltip key={u.userId}>
          <TooltipTrigger asChild>
            <div
              className="w-4 h-4 rounded-full border border-background flex items-center justify-center text-[8px] font-bold text-white shrink-0 cursor-default"
              style={{ backgroundColor: u.color }}
              title={u.displayName}
            >
              {u.displayName[0].toUpperCase()}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p className="font-medium">{u.displayName}</p>
            {u.statusMessage && (
              <p className="text-muted-foreground">{u.statusMessage}</p>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      {watchers.length > 3 && (
        <div className="w-4 h-4 rounded-full border border-background bg-muted flex items-center justify-center text-[8px] text-muted-foreground font-bold">
          +{watchers.length - 3}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add CommitPresenceAvatars to the commit row in `src/components/VersionControl.tsx`**

  Read `src/components/VersionControl.tsx`. Find the section that renders each commit row (around line 306 where `className="flex items-center gap-2 flex-1 min-w-0"` is). This is inside the `CommitTreeView` component's render.

  Add the import at the top:
  ```typescript
  import { CommitPresenceAvatars } from '@/components/CommitPresenceAvatars';
  ```

  Inside the commit row's flex container (the div with `flex items-center gap-1` near the Cloud icon and timestamp), add before the timestamp span:
  ```tsx
  <CommitPresenceAvatars commitId={node.commit.id} />
  ```

- [ ] **Step 3: Type-check and visually verify**

  ```bash
  npx tsc --noEmit
  ```

  Then run `npm run electron:dev` and open a cloud-connected project. Open the app in a second account (or browser devtools Supabase impersonation) to see avatars appear next to commits.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/CommitPresenceAvatars.tsx src/components/VersionControl.tsx
  git commit -m "feat: show teammate avatars on commit nodes they are viewing"
  ```

---

### Task 5: TeamPresencePanel component

A collapsible panel section in the VersionControl sidebar showing all online teammates with their status messages and a field to set your own status.

**Files:**
- Create: `src/components/TeamPresencePanel.tsx`

- [ ] **Step 1: Create `src/components/TeamPresencePanel.tsx`**

```typescript
import { useState } from 'react';
import { usePresence } from '@/contexts/PresenceContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

export function TeamPresencePanel() {
  const { onlineUsers, myUserId, updatePresenceStatus } = usePresence();
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState('');

  const me = onlineUsers.find((u) => u.userId === myUserId);
  const teammates = onlineUsers.filter((u) => u.userId !== myUserId);

  if (onlineUsers.length === 0) return null;

  async function handleSetStatus() {
    const trimmed = draft.trim();
    await updatePresenceStatus(trimmed);
    setSaved(trimmed);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Users className="w-3 h-3" />
        Team
        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 ml-auto font-normal">
          {onlineUsers.length} online
        </Badge>
      </h3>

      {/* Set your own status */}
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSetStatus()}
          placeholder={saved || 'Set a status…'}
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs shrink-0"
          onClick={handleSetStatus}
          disabled={!draft.trim()}
        >
          Set
        </Button>
      </div>

      {/* Teammate list */}
      {teammates.length > 0 && (
        <div className="space-y-1">
          {teammates.map((u) => (
            <div key={u.userId} className="flex items-center gap-2 py-0.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ backgroundColor: u.color }}
              >
                {u.displayName[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{u.displayName}</p>
                {u.statusMessage && (
                  <p className="text-[10px] text-muted-foreground truncate">{u.statusMessage}</p>
                )}
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Online" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add TeamPresencePanel to `src/components/VersionControl.tsx`**

  Find the main VersionControl component's ScrollArea content (around line 536: `<div className="p-4 space-y-6">`). Add after the Cloud Sync section and before the Version History section:

  ```typescript
  import { TeamPresencePanel } from '@/components/TeamPresencePanel';
  ```

  In the render, inside the `space-y-6` div, add the section:
  ```tsx
  {/* Team Presence */}
  <TeamPresencePanel />
  ```

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 4: Run and verify**

  ```bash
  npm run electron:dev
  ```

  - Open a cloud project → presence panel should be hidden (no other users online, you won't see yourself)
  - With a second session connected to the same project, both users should appear in each other's panel
  - Setting a status message should appear under the teammate's name within ~1 second

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/TeamPresencePanel.tsx src/components/VersionControl.tsx
  git commit -m "feat: add TeamPresencePanel with online members and status messages"
  ```

---

## Chunk 3: Polish & Edge Cases

### Task 6: Hide presence features when no cloud project

Presence only works when a cloud project is connected (requires `cloudProject` to be set). Gate the join/leave and hide UI when offline.

**Files:**
- Modify: `src/contexts/VersionControlContext.tsx` (already modified in Task 3 — verify the `cloudProject?.id` guard is in place)
- Modify: `src/components/TeamPresencePanel.tsx` — already returns null when `onlineUsers.length === 0`
- Modify: `src/components/CommitPresenceAvatars.tsx` — already returns null when no watchers

- [ ] **Step 1: Verify graceful degradation**

  In `src/contexts/VersionControlContext.tsx`, confirm the `useEffect` for joining has the guard:
  ```typescript
  if (cloudProject?.id) {
    joinProject(cloudProject.id);
  }
  ```
  If not present, add it now.

- [ ] **Step 2: Handle Supabase auth not available**

  In `src/contexts/PresenceContext.tsx`, the `joinProject` function already has:
  ```typescript
  if (!user) return;
  ```
  Confirm this is in place. If not, add it.

- [ ] **Step 3: Type-check and smoke test**

  ```bash
  npx tsc --noEmit
  ```

  Open a local (non-cloud) project — TeamPresencePanel should not render, no console errors about channel subscription.

- [ ] **Step 4: Commit**

  ```bash
  git add src/contexts/VersionControlContext.tsx src/contexts/PresenceContext.tsx
  git commit -m "feat: guard presence channel join behind cloudProject and auth checks"
  ```

---

### Task 7: Show current user's own status in the status input

The `TeamPresencePanel` currently shows teammates but not your own status message in the list. Show your active status as placeholder text in the input, and display "You" inline so the user can see their current status.

**Files:**
- Modify: `src/components/TeamPresencePanel.tsx`

- [ ] **Step 1: Update TeamPresencePanel to show self**

  Locate the "Teammate list" section in `TeamPresencePanel.tsx`. Add a "You" row above the teammates:

  ```tsx
  {/* You */}
  {me && (
    <div className="flex items-center gap-2 py-0.5">
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
        style={{ backgroundColor: me.color }}
      >
        {me.displayName[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium truncate">{me.displayName}</p>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">you</Badge>
        </div>
        {(saved || me.statusMessage) && (
          <p className="text-[10px] text-muted-foreground truncate">{saved || me.statusMessage}</p>
        )}
      </div>
      <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
    </div>
  )}
  ```

  Place this before `{teammates.length > 0 && ...}`.

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/TeamPresencePanel.tsx
  git commit -m "feat: show own presence entry in team panel with 'you' badge"
  ```

---

### Task 8: Highlight commit being viewed by current user

When browsing commits, the commit the current user is viewing should update in presence so teammates can see it. `currentCommitId` in VersionControlContext already tracks the selected commit — verify the broadcast happens on selection, not just on restore.

**Files:**
- Modify: `src/contexts/VersionControlContext.tsx`

- [ ] **Step 1: Find where currentCommitId is set on browse/selection**

  Read `src/contexts/VersionControlContext.tsx`. Search for `setCurrentCommitId`. Check if it's called when the user clicks a commit to preview (not just restore). There may be a `setCurrentCommitId` call in the preview/selection logic.

- [ ] **Step 2: Ensure broadcast on browse**

  Wherever `setCurrentCommitId` is called (including preview/browse), confirm `updatePresenceCommit(id)` is called immediately after. If any call site is missing it, add it.

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/contexts/VersionControlContext.tsx
  git commit -m "feat: broadcast commit view to presence on browse, not just restore"
  ```
