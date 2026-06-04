# Presence Simulation Dashboard — Design Spec

**Date:** 2026-03-13
**Goal:** A standalone browser-based dashboard that spawns fake presence users on a real Supabase Realtime channel, letting a 2-person team visually test the Team Presence feature under realistic multi-user conditions without needing additional accounts.

---

## Overview

The dashboard connects to the same `presence:project:{projectId}` Supabase Realtime channel the Electron app uses. It manages up to 20 fake user identities, each with their own channel subscription. The Electron app sees these fake users as real teammates — their avatars appear on commit nodes, they show up in the TeamPresencePanel, and their status messages are visible.

Supabase Realtime presence does not validate user identity. The presence key is a string (the fake user's UUID), and the tracked state is arbitrary JSON. This means a single browser tab can maintain multiple channel subscriptions with different presence keys, and the real app cannot distinguish them from real users.

---

## Fake User Pool

20 pre-built users with hardcoded UUIDs, names, and emails. Each user's avatar color is derived from their UUID using the same `colorForUser` hash function in `src/lib/presence-service.ts`, ensuring visual consistency between the dashboard and the Electron app.

Example users:
```
Sarah Chen        sarah.chen@studio.com        uuid: a1b2c3d4-...
Marcus Rivera     marcus.rivera@studio.com     uuid: e5f6a7b8-...
Yuki Tanaka       yuki.tanaka@studio.com       uuid: c9d0e1f2-...
Priya Sharma      priya.sharma@studio.com      uuid: ...
...
```

Fake users set `displayName` to their human-readable name (e.g., "Sarah Chen") rather than the email-derived form (e.g., "sarah.chen"). The real app derives `displayName` by splitting email on `@`, but for simulation realism, pretty names look better in the Electron UI. This is purely cosmetic — the tracked state accepts any string.

The `PresenceUser` state tracked per fake user:
```typescript
{
  userId: string;        // hardcoded UUID
  email: string;         // fake email
  displayName: string;   // human-readable name (e.g., "Sarah Chen")
  color: string;         // deterministic from userId
  currentCommitId: string | null;
  statusMessage: string;
  joinedAt: number;      // Date.now() at activation
}
```

---

## Connection & Setup Flow

1. **Sign in** — minimal Supabase auth form (email/password). Uses the same Supabase project URL and anon key as the main app. A real account is needed to call the backend API for fetching tree.json.

2. **Enter project ID** — text field for `cloudProject.id`. The dashboard calls `POST /api/projects/:projectId/sync/pull-url` with body `{ file_key: "tree.json" }`. The response is `{ download_url, s3_key }`. Fetch `download_url` to get the raw tree.json content, then parse it to extract commit IDs. Show inline error messages for auth failure, invalid project ID (403), or missing tree.json (404).

3. **Ready state** — roster populates with 20 offline fake users; commit dropdowns populate with real commit IDs from the tree; scenario runner is enabled.

**Cleanup:** A `beforeunload` handler calls `untrack()` and `removeChannel()` on every active fake user's channel subscription so the Electron app does not show ghost users.

---

## Dashboard UI Layout

Three side-by-side panels in a single-page layout.

### Left Panel — User Roster

All 20 fake users listed vertically. Each row shows:
- Colored avatar circle with initial (matching Electron app rendering)
- Display name
- Current commit ID (truncated) or "none"
- Current status message or empty
- Online/offline toggle switch

Clicking a user row expands inline controls:
- **Commit dropdown** — populated from fetched tree.json commit IDs. Selecting a value immediately calls `channel.track()` with the updated `currentCommitId`.
- **Status text field** — typing and pressing Enter (or blur) immediately tracks the new `statusMessage`.

Toggling a user online:
1. Creates a new Supabase channel subscription for `presence:project:{projectId}` with `config.presence.key` set to the fake user's UUID.
2. On `SUBSCRIBED`, calls `channel.track()` with the user's full `PresenceUser` state.

Toggling offline:
1. Calls `channel.untrack()`.
2. Calls `supabase.removeChannel(channel)`.

### Center Panel — Scenario Runner

A list of pre-built scenarios, each with a name, description, and "Run" button:

**Morning Standup**
- 8 users join over 90 seconds (staggered at ~10s intervals)
- Each sets a status on join: "reviewing model", "checking measurements", "updating materials", "back from break", etc.
- Users browse different commits (randomly assigned from the tree)
- Duration: ~2 minutes total

**Crowded Commit**
- 6 users join and all navigate to the same commit within 10 seconds
- After 15 seconds, 2 users drift to adjacent commits over 30 seconds
- Tests the CommitPresenceAvatars overflow badge (+N) and tooltip stacking (the component shows 3 avatars then a +N badge, so 6 fake users produces 3 faces + "+3")
- Duration: ~1 minute

**Active Collaboration**
- 4 users online, rapidly switching between 3-4 commits
- Status messages change every 10-15 seconds: "looks good", "found an issue here", "comparing to v2", "checking alignment"
- Simulates a live design review session
- Duration: ~2 minutes

**End of Day**
- Starts with 5 users online (immediately joined)
- Users leave one by one over 60 seconds
- Each clears their status message before departing
- Tests cleanup and UI updates on leave events
- Duration: ~1.5 minutes

Each running scenario shows a progress bar and elapsed time. A "Stop" button cancels the scenario mid-run: all fake users activated by the scenario are immediately untracked and removed.

Only one scenario can run at a time. Manually activated users (from the roster) persist across scenario runs — scenarios only control users they activated.

### Right Panel — Event Log

A scrolling log of timestamped events:
```
12:34:01  Sarah Chen joined
12:34:03  Sarah Chen → commit a3f2c1d
12:34:05  Sarah Chen set status: "reviewing model"
12:34:12  Marcus Rivera joined
12:34:45  Sarah Chen → commit b7e9f02
12:35:30  Marcus Rivera left
```

Useful for verifying the Electron app is reacting correctly. A "Clear" button resets the log.

---

## Scenario Engine

Each scenario is a declarative timeline of actions:

```typescript
interface ScenarioAction {
  delayMs: number;         // delay from previous action
  userId: string;          // which fake user
  action: 'join' | 'leave' | 'setCommit' | 'setStatus';
  value?: string;          // commitId or status message
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  actions: ScenarioAction[];
}
```

The runner iterates through actions sequentially, awaiting each `delayMs` before executing. Actions that reference commits use symbolic identifiers resolved at runtime:
- `"latest"` — the `headCommitId` of the main branch in tree.json
- `"random"` — a random commit ID from the full commit list in tree.json
- `"same_as:{userId}"` — whatever `currentCommitId` the named fake user currently has

Tree.json structure (relevant fields): `{ commits: [{ id, parentCommitId, branchId, ... }], branches: [{ id, name, headCommitId, isMain, ... }], currentCommitId }`. The implementer can reference `src/contexts/VersionControlContext.tsx` (the `TreeData` type and `loadTreeFromDisk` logic) for the full schema.

A `ScenarioRunner` class manages execution:
- `run(scenario)` — starts execution, returns a cancel handle
- `stop()` — cancels pending actions, cleans up users the scenario activated
- `onAction` callback — feeds events to the log panel

---

## File Structure

```
src/dev/
  presence-sim.html           — standalone HTML entry point
  presence-sim.ts             — main: auth, project connection, UI orchestration
  sim-users.ts                — fake user pool (20 users with UUIDs, names, emails)
  sim-scenarios.ts            — scenario definitions (action timelines)
  sim-scenario-runner.ts      — scenario execution engine
  sim-channel-manager.ts      — manages multiple Supabase channel subscriptions
```

### Vite Dev Server

No Vite config changes are needed. Vite's dev server automatically serves any HTML file from the project root. The dashboard is accessible at `http://localhost:5173/src/dev/presence-sim.html` during `npm run dev`. It is not included in production Electron builds since `electron:dist` only bundles the main entry point.

### Dependencies

No new dependencies. Uses:
- `@supabase/supabase-js` (already installed) — for Realtime channel subscriptions
- Inline styles or a minimal CSS file — no Tailwind/Shadcn needed for a dev tool
- The `colorForUser` function and `PRESENCE_COLORS` array are copied from `src/lib/presence-service.ts` into `sim-users.ts` (both are module-private, not exported). Alternatively, export them from presence-service.ts and import directly — both files are bundled by Vite anyway.

### Supabase Client

The dashboard creates its own Supabase client instance using the same project URL and anon key as the main app (imported from environment variables or hardcoded for dev). It does NOT share the Electron app's client instance.

---

## Known Limitations

- **Supabase channel limits** — each fake user creates its own channel subscription. Supabase may throttle many concurrent subscriptions from a single client/IP. If issues arise, reduce the active pool to 10 users or stagger subscription creation with short delays.

---

## What This Does NOT Cover

- **Stress testing** (50+ users, performance benchmarks) — deferred to a separate backend stress test
- **Invite/sharing simulation** — this tool only simulates presence, not the invite flow or cloud sync
- **Automated assertions** — this is a visual testing tool, not an automated test suite
- **Production deployment** — dev-only tool, never shipped to users
