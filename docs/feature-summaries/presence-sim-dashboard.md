# Presence Simulation Dashboard

**Implemented:** 2026-03-13

## Overview

A dev-only browser-based tool that spawns up to 20 fake presence users on real Supabase Realtime channels. Enables the team to visually test the Team Presence feature under realistic multi-user conditions without needing additional accounts.

Accessible at `http://localhost:5173/src/dev/presence-sim.html` during dev mode.

## What It Does

1. Authenticates with Supabase using real credentials
2. Fetches `tree.json` from cloud storage via the backend proxy endpoint
3. Creates independent Supabase Realtime channel subscriptions for each fake user
4. Allows manual per-user control (toggle online/offline, set commit, set status) or automated scenario execution
5. The Electron app cannot distinguish fake users from real ones — presence avatars and the team panel update in real time

## Architecture

### Components

| File | Role |
|------|------|
| `src/dev/presence-sim.html` | Standalone HTML entry point with three-panel dark theme UI |
| `src/dev/presence-sim.ts` | Main orchestrator: auth flow, project connection, DOM rendering, state management |
| `src/dev/sim-users.ts` | Pool of 20 fake users with hardcoded UUIDs, names, emails, and deterministic colors |
| `src/dev/sim-scenarios.ts` | 4 pre-built scenario definitions with action timelines |
| `src/dev/sim-scenario-runner.ts` | Execution engine: runs scenarios sequentially with symbolic commit resolution |
| `src/dev/sim-channel-manager.ts` | Manages multiple Supabase channel subscriptions and user presence state |

### How It Connects to the Real System

- Uses the **same** `PresenceUser` interface and `colorForUser()` function from `src/lib/presence-service.ts`
- Broadcasts on the **same** channel (`presence:project:{projectId}`)
- Creates its own Supabase client instance (separate from the Electron app's)
- Supabase Realtime doesn't validate identity — dashboard keys are arbitrary strings

### Backend Dependency

Uses `POST /api/projects/{projectId}/sync/pull-content` (backend/server.js line ~917) to fetch `tree.json`. This endpoint proxies the S3 download to avoid CORS issues in the browser.

## Fake User Pool

20 hardcoded users in `sim-users.ts`, each with:
- Deterministic UUID (consistent across runs)
- Human-readable name and email (e.g. "Sarah Chen", sarah.chen@studio.com)
- Avatar color derived from the same `colorForUser()` hash used by the real app

## Scenario Runner

The `ScenarioRunner` class executes declarative action timelines:

```typescript
interface ScenarioAction {
  delayMs: number;
  userId: string;
  action: 'join' | 'leave' | 'setCommit' | 'setStatus';
  value?: string;
}
```

### Symbolic Commit References

Commit values in scenarios can use symbolic references resolved at runtime:
- `"latest"` — main branch's `headCommitId`
- `"random"` — random commit from the tree
- `"same_as:{userId}"` — whatever commit the named user currently has

### Built-in Scenarios

| Scenario | Duration | Users | Tests |
|----------|----------|-------|-------|
| **Morning Standup** | ~2 min | 8 | Staggered joins over 90s, varied statuses, random commit browsing |
| **Crowded Commit** | ~1 min | 6 | All navigate to `latest` within 10s; 2 drift away. Tests `+N` overflow badge. |
| **Active Collaboration** | ~2 min | 4 | Rapid commit switching (3-7s) and status updates (10-15s). Simulates design review. |
| **End of Day** | ~1.5 min | 5 | Users join then leave one-by-one over 60s. Tests cleanup behavior. |

Only one scenario runs at a time. Manually activated users persist across scenario runs.

## Channel Manager

`SimChannelManager` wraps Supabase Realtime subscriptions:

- `activateUser(user, commitId?, status?)` — creates channel, subscribes, tracks
- `deactivateUser(userId)` — untracks and removes channel
- `setCommit(userId, commitId)` / `setStatus(userId, message)` — re-tracks updated state
- 10-second subscription timeout (rejects if SUBSCRIBED doesn't fire)
- `beforeunload` hook calls `deactivateAll()` to prevent ghost users on page close

## UI Layout

Three-panel dashboard:

- **Left — User Roster**: 20 users with online/offline toggle, expandable inline controls for commit dropdown and status input
- **Center — Scenario Runner**: Cards for each scenario with Run/Stop, progress bar, elapsed time
- **Right — Event Log**: Timestamped entries (join, leave, commit change, status update) with clear button and auto-scroll

**Top bar**: Email/password sign-in, project ID input, connection status

## How to Use

1. Run `npm run electron:dev` (starts Vite on port 5173)
2. Open `http://localhost:5173/src/dev/presence-sim.html` in a browser
3. Sign in with a real Supabase account
4. Enter a cloud project ID (project must already be synced to cloud)
5. Toggle users on/off manually or run a scenario
6. Watch the Electron app's `CommitPresenceAvatars` and `TeamPresencePanel` update in real time
7. Verify the UI handles many users, overflow badges, status messages, and leave events correctly

## Notable Fixes

- Commit `a1f81a8`: Fixed leaked channel on subscription timeout in `SimChannelManager`
- Commit `6f53d58`: Proxied `tree.json` through backend to avoid S3 CORS issues
