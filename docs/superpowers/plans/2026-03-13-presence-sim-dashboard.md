# Presence Simulation Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone browser-based dashboard that spawns fake presence users on a real Supabase Realtime channel, letting a 2-person team visually test the Team Presence feature under realistic multi-user conditions.

**Architecture:** A set of TypeScript modules in `src/dev/` served by Vite's dev server alongside the main app. The dashboard creates its own Supabase client, authenticates with a real account, fetches tree.json via the backend API, then manages up to 20 fake user channel subscriptions on the same `presence:project:{projectId}` channel the Electron app uses. A scenario engine drives automated multi-user simulations.

**Tech Stack:** `@supabase/supabase-js` (already installed), vanilla TypeScript + DOM APIs (no React/Tailwind — this is a dev tool), Vite dev server (no config changes needed)

---

## Chunk 1: Data Layer

### Task 1: Export colorForUser from presence-service

Before creating the sim modules, export the `colorForUser` function and `PRESENCE_COLORS` array from `src/lib/presence-service.ts` so the dashboard can import them directly instead of duplicating code.

**Files:**
- Modify: `src/lib/presence-service.ts`

- [ ] **Step 1: Export PRESENCE_COLORS and colorForUser**

  In `src/lib/presence-service.ts`, change the two declarations from module-private to exported:

  ```typescript
  // Line 13-17: change `const` to `export const`
  export const PRESENCE_COLORS = [
    '#6366f1', '#ec4899', '#f59e0b', '#10b981',
    '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6',
  ];

  // Line 19: change `function` to `export function`
  export function colorForUser(userId: string): string {
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors (these were already used internally, adding `export` doesn't break anything)

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/presence-service.ts
  git commit -m "refactor: export colorForUser and PRESENCE_COLORS from presence-service"
  ```

---

### Task 2: Fake user pool

**Files:**
- Create: `src/dev/sim-users.ts`

- [ ] **Step 1: Create `src/dev/sim-users.ts`**

  This file defines the 20 fake users with hardcoded UUIDs, human-readable names, and fake emails. It imports `colorForUser` from presence-service to compute each user's avatar color.

  ```typescript
  import { colorForUser } from '../lib/presence-service';
  import type { PresenceUser } from '../lib/presence-service';

  export interface SimUser {
    userId: string;
    email: string;
    displayName: string;
    color: string;
  }

  const RAW_USERS: { name: string; email: string; uuid: string }[] = [
    { name: 'Sarah Chen', email: 'sarah.chen@studio.com', uuid: 'a1b2c3d4-1111-4000-a000-000000000001' },
    { name: 'Marcus Rivera', email: 'marcus.rivera@studio.com', uuid: 'a1b2c3d4-2222-4000-a000-000000000002' },
    { name: 'Yuki Tanaka', email: 'yuki.tanaka@studio.com', uuid: 'a1b2c3d4-3333-4000-a000-000000000003' },
    { name: 'Priya Sharma', email: 'priya.sharma@studio.com', uuid: 'a1b2c3d4-4444-4000-a000-000000000004' },
    { name: 'James O\'Brien', email: 'james.obrien@studio.com', uuid: 'a1b2c3d4-5555-4000-a000-000000000005' },
    { name: 'Amara Okafor', email: 'amara.okafor@studio.com', uuid: 'a1b2c3d4-6666-4000-a000-000000000006' },
    { name: 'Liam Petrov', email: 'liam.petrov@studio.com', uuid: 'a1b2c3d4-7777-4000-a000-000000000007' },
    { name: 'Sofia Morales', email: 'sofia.morales@studio.com', uuid: 'a1b2c3d4-8888-4000-a000-000000000008' },
    { name: 'Wei Zhang', email: 'wei.zhang@studio.com', uuid: 'a1b2c3d4-9999-4000-a000-000000000009' },
    { name: 'Elena Vasquez', email: 'elena.vasquez@studio.com', uuid: 'a1b2c3d4-aaaa-4000-a000-000000000010' },
    { name: 'David Kim', email: 'david.kim@studio.com', uuid: 'a1b2c3d4-bbbb-4000-a000-000000000011' },
    { name: 'Fatima Al-Hassan', email: 'fatima.alhassan@studio.com', uuid: 'a1b2c3d4-cccc-4000-a000-000000000012' },
    { name: 'Noah Williams', email: 'noah.williams@studio.com', uuid: 'a1b2c3d4-dddd-4000-a000-000000000013' },
    { name: 'Aisha Patel', email: 'aisha.patel@studio.com', uuid: 'a1b2c3d4-eeee-4000-a000-000000000014' },
    { name: 'Lucas Bergström', email: 'lucas.bergstrom@studio.com', uuid: 'a1b2c3d4-ffff-4000-a000-000000000015' },
    { name: 'Maya Johnson', email: 'maya.johnson@studio.com', uuid: 'a1b2c3d4-1010-4000-a000-000000000016' },
    { name: 'Ravi Gupta', email: 'ravi.gupta@studio.com', uuid: 'a1b2c3d4-2020-4000-a000-000000000017' },
    { name: 'Chloe Dubois', email: 'chloe.dubois@studio.com', uuid: 'a1b2c3d4-3030-4000-a000-000000000018' },
    { name: 'Tomás García', email: 'tomas.garcia@studio.com', uuid: 'a1b2c3d4-4040-4000-a000-000000000019' },
    { name: 'Ingrid Nylund', email: 'ingrid.nylund@studio.com', uuid: 'a1b2c3d4-5050-4000-a000-000000000020' },
  ];

  export const SIM_USERS: SimUser[] = RAW_USERS.map((u) => ({
    userId: u.uuid,
    email: u.email,
    displayName: u.name,
    color: colorForUser(u.uuid),
  }));

  /** Build a full PresenceUser state object for tracking on a channel. */
  export function buildPresenceState(
    user: SimUser,
    currentCommitId: string | null = null,
    statusMessage: string = '',
  ): PresenceUser {
    return {
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      color: user.color,
      currentCommitId,
      statusMessage,
      joinedAt: Date.now(),
    };
  }
  ```

- [ ] **Step 2: Verify import works**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors. The `src/dev/` directory is covered by the root `tsconfig.json` which compiles `src/`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/dev/sim-users.ts
  git commit -m "feat: add 20 fake users for presence simulation dashboard"
  ```

---

### Task 3: Channel manager

Manages multiple Supabase Realtime channel subscriptions — one per active fake user. This is the core bridge between the dashboard and the presence channel the Electron app listens on.

**Files:**
- Create: `src/dev/sim-channel-manager.ts`

- [ ] **Step 1: Create `src/dev/sim-channel-manager.ts`**

  ```typescript
  import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
  import type { PresenceUser } from '../lib/presence-service';
  import { SimUser, buildPresenceState } from './sim-users';

  export class SimChannelManager {
    private supabase: SupabaseClient;
    private projectId: string | null = null;
    private channels: Map<string, RealtimeChannel> = new Map(); // userId → channel
    private userStates: Map<string, PresenceUser> = new Map();  // userId → tracked state

    constructor(supabaseUrl: string, supabaseAnonKey: string) {
      this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      });
    }

    getSupabase(): SupabaseClient {
      return this.supabase;
    }

    setProjectId(projectId: string) {
      this.projectId = projectId;
    }

    /** Bring a fake user online. Returns a promise that resolves when tracked. */
    async activateUser(user: SimUser, commitId: string | null = null, status: string = ''): Promise<void> {
      if (!this.projectId) throw new Error('No project ID set');
      if (this.channels.has(user.userId)) return; // already active

      const state = buildPresenceState(user, commitId, status);
      const channel = this.supabase.channel(`presence:project:${this.projectId}`, {
        config: { presence: { key: user.userId } },
      });

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timeout subscribing ${user.displayName}`)), 10000);

        channel
          .on('presence', { event: 'sync' }, () => {})
          .subscribe(async (subStatus) => {
            if (subStatus === 'SUBSCRIBED') {
              clearTimeout(timeout);
              await channel.track(state).catch(() => {});
              this.channels.set(user.userId, channel);
              this.userStates.set(user.userId, state);
              resolve();
            }
          });
      });
    }

    /** Take a fake user offline. */
    async deactivateUser(userId: string): Promise<void> {
      const channel = this.channels.get(userId);
      if (!channel) return;
      channel.untrack();
      this.supabase.removeChannel(channel);
      this.channels.delete(userId);
      this.userStates.delete(userId);
    }

    /** Update which commit a fake user is viewing. */
    async setCommit(userId: string, commitId: string | null): Promise<void> {
      const channel = this.channels.get(userId);
      const state = this.userStates.get(userId);
      if (!channel || !state) return;
      const updated = { ...state, currentCommitId: commitId };
      this.userStates.set(userId, updated);
      await channel.track(updated).catch(() => {});
    }

    /** Update a fake user's status message. */
    async setStatus(userId: string, statusMessage: string): Promise<void> {
      const channel = this.channels.get(userId);
      const state = this.userStates.get(userId);
      if (!channel || !state) return;
      const updated = { ...state, statusMessage };
      this.userStates.set(userId, updated);
      await channel.track(updated).catch(() => {});
    }

    /** Get current tracked state for a user (or null if not active). */
    getState(userId: string): PresenceUser | null {
      return this.userStates.get(userId) ?? null;
    }

    /** Check if a user is currently active. */
    isActive(userId: string): boolean {
      return this.channels.has(userId);
    }

    /** Get all active user IDs. */
    getActiveUserIds(): string[] {
      return Array.from(this.channels.keys());
    }

    /** Deactivate all fake users. Called on page unload. */
    async deactivateAll(): Promise<void> {
      const userIds = Array.from(this.channels.keys());
      await Promise.all(userIds.map((id) => this.deactivateUser(id)));
    }
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add src/dev/sim-channel-manager.ts
  git commit -m "feat: add SimChannelManager for multi-user presence subscriptions"
  ```

---

## Chunk 2: Scenario Engine

### Task 4: Scenario definitions

Defines the 4 pre-built scenarios as declarative action timelines.

**Files:**
- Create: `src/dev/sim-scenarios.ts`

- [ ] **Step 1: Create `src/dev/sim-scenarios.ts`**

  ```typescript
  import { SIM_USERS } from './sim-users';

  export interface ScenarioAction {
    delayMs: number;
    userId: string;
    action: 'join' | 'leave' | 'setCommit' | 'setStatus';
    value?: string; // commitId (symbolic or literal) or status message
  }

  export interface Scenario {
    id: string;
    name: string;
    description: string;
    actions: ScenarioAction[];
  }

  // Helper: pick N users from the pool starting at offset
  function pickUsers(start: number, count: number): string[] {
    return SIM_USERS.slice(start, start + count).map((u) => u.userId);
  }

  /**
   * Commit value tokens resolved at runtime by the scenario runner:
   * - "latest"         → headCommitId of the main branch
   * - "random"         → random commit from the tree
   * - "same_as:{uuid}" → whatever that fake user's currentCommitId is
   * - any other string → treated as a literal commit ID
   */

  const STANDUP_STATUSES = [
    'reviewing model',
    'checking measurements',
    'updating materials',
    'back from break',
    'comparing versions',
    'annotating changes',
    'testing export',
    'reviewing feedback',
  ];

  export const SCENARIO_MORNING_STANDUP: Scenario = (() => {
    const users = pickUsers(0, 8);
    const actions: ScenarioAction[] = [];

    users.forEach((uid, i) => {
      // Join staggered ~10s apart
      actions.push({ delayMs: i === 0 ? 0 : 10000 + Math.random() * 2000, userId: uid, action: 'join' });
      // Set a status on join
      actions.push({ delayMs: 500, userId: uid, action: 'setStatus', value: STANDUP_STATUSES[i] });
      // Browse a random commit
      actions.push({ delayMs: 1000, userId: uid, action: 'setCommit', value: 'random' });
    });

    // After everyone joins, some users browse more commits
    users.slice(0, 4).forEach((uid) => {
      actions.push({ delayMs: 5000 + Math.random() * 5000, userId: uid, action: 'setCommit', value: 'random' });
    });

    return {
      id: 'morning-standup',
      name: 'Morning Standup',
      description: '8 users join over ~90s, set statuses, browse different commits',
      actions,
    };
  })();

  export const SCENARIO_CROWDED_COMMIT: Scenario = (() => {
    const users = pickUsers(0, 6);
    const actions: ScenarioAction[] = [];

    // All 6 join quickly
    users.forEach((uid, i) => {
      actions.push({ delayMs: i === 0 ? 0 : 1500, userId: uid, action: 'join' });
      actions.push({ delayMs: 200, userId: uid, action: 'setCommit', value: 'latest' });
    });

    // After 15 seconds, 2 users drift to other commits
    actions.push({ delayMs: 15000, userId: users[4], action: 'setCommit', value: 'random' });
    actions.push({ delayMs: 5000, userId: users[5], action: 'setCommit', value: 'random' });

    return {
      id: 'crowded-commit',
      name: 'Crowded Commit',
      description: '6 users all view the same commit, then 2 drift away. Tests +N overflow badge.',
      actions,
    };
  })();

  const COLLAB_STATUSES = [
    'looks good',
    'found an issue here',
    'comparing to v2',
    'checking alignment',
    'needs another look',
    'approved this section',
    'flagging for review',
    'measuring tolerance',
  ];

  export const SCENARIO_ACTIVE_COLLABORATION: Scenario = (() => {
    const users = pickUsers(0, 4);
    const actions: ScenarioAction[] = [];

    // All 4 join immediately
    users.forEach((uid, i) => {
      actions.push({ delayMs: i === 0 ? 0 : 500, userId: uid, action: 'join' });
      actions.push({ delayMs: 200, userId: uid, action: 'setCommit', value: 'random' });
    });

    // Rapid switching and status changes over ~2 minutes
    for (let round = 0; round < 8; round++) {
      users.forEach((uid, i) => {
        actions.push({
          delayMs: 3000 + Math.random() * 4000,
          userId: uid,
          action: 'setCommit',
          value: i % 2 === 0 ? 'random' : `same_as:${users[0]}`,
        });
        if (Math.random() > 0.5) {
          actions.push({
            delayMs: 1000,
            userId: uid,
            action: 'setStatus',
            value: COLLAB_STATUSES[Math.floor(Math.random() * COLLAB_STATUSES.length)],
          });
        }
      });
    }

    return {
      id: 'active-collaboration',
      name: 'Active Collaboration',
      description: '4 users rapidly switch commits and update statuses. Simulates a design review.',
      actions,
    };
  })();

  export const SCENARIO_END_OF_DAY: Scenario = (() => {
    const users = pickUsers(0, 5);
    const actions: ScenarioAction[] = [];

    // All 5 join immediately with statuses
    users.forEach((uid, i) => {
      actions.push({ delayMs: i === 0 ? 0 : 200, userId: uid, action: 'join' });
      actions.push({ delayMs: 100, userId: uid, action: 'setStatus', value: 'wrapping up' });
      actions.push({ delayMs: 100, userId: uid, action: 'setCommit', value: 'random' });
    });

    // Leave one by one over ~60 seconds
    users.forEach((uid, i) => {
      actions.push({ delayMs: 10000 + Math.random() * 3000, userId: uid, action: 'setStatus', value: '' });
      actions.push({ delayMs: 2000, userId: uid, action: 'leave' });
    });

    return {
      id: 'end-of-day',
      name: 'End of Day',
      description: '5 users online, leave one by one over ~60s. Tests cleanup on leave.',
      actions,
    };
  })();

  export const ALL_SCENARIOS: Scenario[] = [
    SCENARIO_MORNING_STANDUP,
    SCENARIO_CROWDED_COMMIT,
    SCENARIO_ACTIVE_COLLABORATION,
    SCENARIO_END_OF_DAY,
  ];
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add src/dev/sim-scenarios.ts
  git commit -m "feat: add 4 presence simulation scenario definitions"
  ```

---

### Task 5: Scenario runner engine

Executes scenario action timelines against the SimChannelManager. Resolves symbolic commit references (`"latest"`, `"random"`, `"same_as:{userId}"`) at runtime.

**Files:**
- Create: `src/dev/sim-scenario-runner.ts`

- [ ] **Step 1: Create `src/dev/sim-scenario-runner.ts`**

  ```typescript
  import type { Scenario, ScenarioAction } from './sim-scenarios';
  import type { SimChannelManager } from './sim-channel-manager';
  import { SIM_USERS, SimUser } from './sim-users';

  export interface CommitTree {
    commits: { id: string; branchId: string }[];
    branches: { id: string; headCommitId: string; isMain: boolean }[];
  }

  export type ActionLogCallback = (message: string) => void;

  export type ProgressCallback = (current: number, total: number, elapsedMs: number) => void;

  export class ScenarioRunner {
    private manager: SimChannelManager;
    private commitTree: CommitTree;
    private cancelHandle: (() => void) | null = null;
    private scenarioUserIds: Set<string> = new Set(); // users activated by this scenario run
    private _running = false;
    private _currentScenarioId: string | null = null;
    private onLog: ActionLogCallback = () => {};
    private onProgress: ProgressCallback = () => {};
    private onActionExecuted: (() => void) | null = null; // called after each action for UI refresh

    constructor(manager: SimChannelManager, commitTree: CommitTree) {
      this.manager = manager;
      this.commitTree = commitTree;
    }

    get running(): boolean {
      return this._running;
    }

    get currentScenarioId(): string | null {
      return this._currentScenarioId;
    }

    setLogCallback(cb: ActionLogCallback) {
      this.onLog = cb;
    }

    setProgressCallback(cb: ProgressCallback) {
      this.onProgress = cb;
    }

    /** Called after each action so the dashboard can refresh the roster. */
    setActionCallback(cb: () => void) {
      this.onActionExecuted = cb;
    }

    async run(scenario: Scenario): Promise<void> {
      if (this._running) throw new Error('A scenario is already running');
      this._running = true;
      this._currentScenarioId = scenario.id;
      this.scenarioUserIds.clear();
      let cancelled = false;
      const startTime = Date.now();
      const totalActions = scenario.actions.length;

      this.cancelHandle = () => { cancelled = true; };

      this.onLog(`▶ Starting scenario: ${scenario.name}`);
      this.onProgress(0, totalActions, 0);

      for (let i = 0; i < scenario.actions.length; i++) {
        if (cancelled) break;
        const action = scenario.actions[i];

        // Wait for the delay
        if (action.delayMs > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, action.delayMs);
            const prevCancel = this.cancelHandle;
            this.cancelHandle = () => {
              cancelled = true;
              clearTimeout(timer);
              resolve();
              prevCancel?.();
            };
          });
        }

        if (cancelled) break;

        await this.executeAction(action);
        this.onProgress(i + 1, totalActions, Date.now() - startTime);
        this.onActionExecuted?.();
      }

      if (cancelled) {
        this.onLog('⏹ Scenario cancelled — cleaning up');
        await this.cleanupScenarioUsers();
      } else {
        this.onLog(`✓ Scenario "${scenario.name}" complete`);
      }

      this._running = false;
      this._currentScenarioId = null;
      this.cancelHandle = null;
    }

    async stop(): Promise<void> {
      if (this.cancelHandle) {
        this.cancelHandle();
      }
    }

    private async executeAction(action: ScenarioAction): Promise<void> {
      const user = this.findUser(action.userId);
      if (!user) return;

      switch (action.action) {
        case 'join': {
          this.scenarioUserIds.add(user.userId);
          await this.manager.activateUser(user);
          this.onLog(`${user.displayName} joined`);
          break;
        }
        case 'leave': {
          await this.manager.deactivateUser(user.userId);
          this.scenarioUserIds.delete(user.userId);
          this.onLog(`${user.displayName} left`);
          break;
        }
        case 'setCommit': {
          const commitId = this.resolveCommitRef(action.value ?? 'random');
          await this.manager.setCommit(user.userId, commitId);
          this.onLog(`${user.displayName} → commit ${commitId?.slice(0, 7) ?? 'none'}`);
          break;
        }
        case 'setStatus': {
          await this.manager.setStatus(user.userId, action.value ?? '');
          this.onLog(`${user.displayName} set status: "${action.value ?? ''}"`);
          break;
        }
      }
    }

    private resolveCommitRef(ref: string): string | null {
      if (ref === 'latest') {
        const mainBranch = this.commitTree.branches.find((b) => b.isMain);
        return mainBranch?.headCommitId ?? this.commitTree.commits[0]?.id ?? null;
      }
      if (ref === 'random') {
        const commits = this.commitTree.commits;
        if (commits.length === 0) return null;
        return commits[Math.floor(Math.random() * commits.length)].id;
      }
      if (ref.startsWith('same_as:')) {
        const targetId = ref.slice('same_as:'.length);
        const state = this.manager.getState(targetId);
        return state?.currentCommitId ?? null;
      }
      // Literal commit ID
      return ref;
    }

    private findUser(userId: string): SimUser | undefined {
      return SIM_USERS.find((u) => u.userId === userId);
    }

    private async cleanupScenarioUsers(): Promise<void> {
      const ids = Array.from(this.scenarioUserIds);
      await Promise.all(ids.map((id) => this.manager.deactivateUser(id)));
      this.scenarioUserIds.clear();
    }
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add src/dev/sim-scenario-runner.ts
  git commit -m "feat: add ScenarioRunner engine with symbolic commit resolution"
  ```

---

## Chunk 3: Dashboard UI

### Task 6: HTML entry point and main orchestration

The standalone HTML page and the main TypeScript file that wires together auth, project connection, and the three UI panels.

**Files:**
- Create: `src/dev/presence-sim.html`
- Create: `src/dev/presence-sim.ts`

- [ ] **Step 1: Create `src/dev/presence-sim.html`**

  Minimal HTML shell with the three-panel layout structure. No external CSS — all styles are inline or in a `<style>` block. Loads the TS entry point as a module.

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Presence Simulation Dashboard</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; height: 100vh; display: flex; flex-direction: column; }

      /* Setup bar */
      #setup { padding: 12px 16px; background: #171717; border-bottom: 1px solid #262626; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
      #setup input { background: #262626; border: 1px solid #404040; color: #e5e5e5; padding: 6px 10px; border-radius: 4px; font-size: 13px; }
      #setup input::placeholder { color: #737373; }
      #setup button { background: #3b82f6; color: white; border: none; padding: 6px 14px; border-radius: 4px; font-size: 13px; cursor: pointer; }
      #setup button:hover { background: #2563eb; }
      #setup button:disabled { background: #404040; cursor: not-allowed; }
      #setup .status { font-size: 12px; color: #a3a3a3; }
      #setup .error { color: #ef4444; font-size: 12px; }

      /* Three-panel layout */
      #panels { display: flex; flex: 1; overflow: hidden; }
      .panel { flex: 1; border-right: 1px solid #262626; display: flex; flex-direction: column; overflow: hidden; }
      .panel:last-child { border-right: none; }
      .panel-header { padding: 10px 14px; background: #171717; border-bottom: 1px solid #262626; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #a3a3a3; }
      .panel-body { flex: 1; overflow-y: auto; padding: 8px; }

      /* Roster */
      .user-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 13px; }
      .user-row:hover { background: #1a1a1a; }
      .user-row.active { background: #1c1c1c; }
      .avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: white; flex-shrink: 0; }
      .user-info { flex: 1; min-width: 0; }
      .user-name { font-weight: 500; }
      .user-detail { font-size: 11px; color: #737373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .toggle { width: 36px; height: 20px; border-radius: 10px; background: #404040; position: relative; cursor: pointer; flex-shrink: 0; transition: background 0.2s; }
      .toggle.on { background: #22c55e; }
      .toggle::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: white; top: 2px; left: 2px; transition: transform 0.2s; }
      .toggle.on::after { transform: translateX(16px); }
      .user-controls { padding: 6px 8px 10px 40px; display: none; }
      .user-controls.visible { display: flex; gap: 8px; flex-direction: column; }
      .user-controls select, .user-controls input { background: #262626; border: 1px solid #404040; color: #e5e5e5; padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 100%; }

      /* Scenarios */
      .scenario-card { background: #171717; border: 1px solid #262626; border-radius: 6px; padding: 12px; margin-bottom: 8px; }
      .scenario-name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
      .scenario-desc { font-size: 12px; color: #a3a3a3; margin-bottom: 8px; }
      .scenario-btn { background: #3b82f6; color: white; border: none; padding: 5px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; }
      .scenario-btn:hover { background: #2563eb; }
      .scenario-btn:disabled { background: #404040; cursor: not-allowed; }
      .scenario-btn.stop { background: #ef4444; }
      .scenario-btn.stop:hover { background: #dc2626; }
      .progress-bar { height: 3px; background: #262626; border-radius: 2px; margin-top: 8px; overflow: hidden; display: none; }
      .progress-bar.visible { display: block; }
      .progress-fill { height: 100%; background: #3b82f6; transition: width 0.5s; }

      /* Event log */
      .log-entry { font-size: 12px; font-family: 'SF Mono', 'Fira Code', monospace; padding: 2px 6px; border-bottom: 1px solid #1a1a1a; }
      .log-time { color: #737373; margin-right: 8px; }
      .log-clear { font-size: 11px; background: none; border: 1px solid #404040; color: #a3a3a3; padding: 3px 8px; border-radius: 3px; cursor: pointer; float: right; }
      .log-clear:hover { background: #262626; }

      /* Disabled state before connection */
      #panels.disabled { opacity: 0.4; pointer-events: none; }
    </style>
  </head>
  <body>
    <div id="setup">
      <input id="email" type="email" placeholder="Email" />
      <input id="password" type="password" placeholder="Password" />
      <button id="signInBtn">Sign In</button>
      <input id="projectId" type="text" placeholder="Cloud Project ID" disabled />
      <button id="connectBtn" disabled>Connect</button>
      <span id="setupStatus" class="status">Not signed in</span>
    </div>

    <div id="panels" class="disabled">
      <div class="panel" id="rosterPanel">
        <div class="panel-header">User Roster (0 / 20 active)</div>
        <div class="panel-body" id="rosterBody"></div>
      </div>
      <div class="panel" id="scenarioPanel">
        <div class="panel-header">Scenarios</div>
        <div class="panel-body" id="scenarioBody"></div>
      </div>
      <div class="panel" id="logPanel">
        <div class="panel-header">Event Log <button class="log-clear" id="logClear">Clear</button></div>
        <div class="panel-body" id="logBody"></div>
      </div>
    </div>

    <script type="module" src="./presence-sim.ts"></script>
  </body>
  </html>
  ```

- [ ] **Step 2: Create `src/dev/presence-sim.ts`**

  Main orchestration: handles auth, project connection, renders all three panels, and wires up events.

  ```typescript
  import { SimChannelManager } from './sim-channel-manager';
  import { SIM_USERS, SimUser } from './sim-users';
  import { ALL_SCENARIOS } from './sim-scenarios';
  import { ScenarioRunner, type CommitTree } from './sim-scenario-runner';

  // ——— State ———
  let manager: SimChannelManager | null = null;
  let runner: ScenarioRunner | null = null;
  let commitTree: CommitTree | null = null;
  let commitIds: string[] = [];
  let expandedUserId: string | null = null;
  let backendUrl = '';

  // ——— DOM refs ———
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const emailInput = $<HTMLInputElement>('email');
  const passwordInput = $<HTMLInputElement>('password');
  const signInBtn = $<HTMLButtonElement>('signInBtn');
  const projectIdInput = $<HTMLInputElement>('projectId');
  const connectBtn = $<HTMLButtonElement>('connectBtn');
  const setupStatus = $<HTMLSpanElement>('setupStatus');
  const panels = $<HTMLDivElement>('panels');
  const rosterBody = $<HTMLDivElement>('rosterBody');
  const rosterHeader = document.querySelector('#rosterPanel .panel-header')!;
  const scenarioBody = $<HTMLDivElement>('scenarioBody');
  const logBody = $<HTMLDivElement>('logBody');
  const logClear = $<HTMLButtonElement>('logClear');

  // ——— Logging ———
  function log(message: string) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
    logBody.appendChild(entry);
    logBody.scrollTop = logBody.scrollHeight;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  logClear.addEventListener('click', () => { logBody.innerHTML = ''; });

  // ——— Auth ———
  signInBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if (!email || !password) return;

    signInBtn.disabled = true;
    setupStatus.textContent = 'Signing in…';
    setupStatus.className = 'status';

    // Detect env — Vite injects import.meta.env at build time
    const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
    const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';
    backendUrl = (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:3000';

    if (!supabaseUrl || !supabaseAnonKey) {
      setupStatus.textContent = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY';
      setupStatus.className = 'error';
      signInBtn.disabled = false;
      return;
    }

    manager = new SimChannelManager(supabaseUrl, supabaseAnonKey);

    const { error } = await manager.getSupabase().auth.signInWithPassword({ email, password });
    if (error) {
      setupStatus.textContent = `Auth failed: ${error.message}`;
      setupStatus.className = 'error';
      signInBtn.disabled = false;
      return;
    }

    setupStatus.textContent = `Signed in as ${email}`;
    projectIdInput.disabled = false;
    connectBtn.disabled = false;
    log(`Signed in as ${email}`);
  });

  // ——— Project connection ———
  connectBtn.addEventListener('click', async () => {
    const projectId = projectIdInput.value.trim();
    if (!projectId || !manager) return;

    connectBtn.disabled = true;
    setupStatus.textContent = 'Fetching tree.json…';

    try {
      const session = await manager.getSupabase().auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No auth session');

      // Get presigned download URL for tree.json
      const pullRes = await fetch(`${backendUrl}/api/projects/${projectId}/sync/pull-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ file_key: 'tree.json' }),
      });

      if (pullRes.status === 403) throw new Error('Access denied — check your project membership');
      if (pullRes.status === 404) throw new Error('tree.json not found — has this project been synced to cloud?');
      if (!pullRes.ok) throw new Error(`Backend error: ${pullRes.status}`);

      const { download_url } = await pullRes.json();

      // Fetch tree.json from S3
      const treeRes = await fetch(download_url);
      if (!treeRes.ok) throw new Error('Failed to download tree.json from S3');
      const treeData = await treeRes.json();

      commitTree = {
        commits: (treeData.commits ?? []).map((c: any) => ({ id: c.id, branchId: c.branchId })),
        branches: (treeData.branches ?? []).map((b: any) => ({ id: b.id, headCommitId: b.headCommitId, isMain: b.isMain })),
      };
      commitIds = commitTree.commits.map((c) => c.id);

      manager.setProjectId(projectId);
      runner = new ScenarioRunner(manager, commitTree);
      runner.setLogCallback(log);
      runner.setProgressCallback(onScenarioProgress);
      runner.setActionCallback(() => renderRoster());

      setupStatus.textContent = `Connected — ${commitIds.length} commits loaded`;
      panels.classList.remove('disabled');

      renderRoster();
      renderScenarios();
      log(`Connected to project ${projectId} — ${commitIds.length} commits`);

    } catch (err: any) {
      setupStatus.textContent = err.message;
      setupStatus.className = 'error';
      connectBtn.disabled = false;
    }
  });

  // ——— Roster rendering ———
  function renderRoster() {
    rosterBody.innerHTML = '';
    const activeCount = manager?.getActiveUserIds().length ?? 0;
    rosterHeader.textContent = `User Roster (${activeCount} / 20 active)`;

    SIM_USERS.forEach((user) => {
      const isActive = manager?.isActive(user.userId) ?? false;
      const state = manager?.getState(user.userId);

      // Row
      const row = document.createElement('div');
      row.className = `user-row ${expandedUserId === user.userId ? 'active' : ''}`;
      row.innerHTML = `
        <div class="avatar" style="background-color: ${user.color}">${user.displayName[0]}</div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(user.displayName)}</div>
          <div class="user-detail">${state?.currentCommitId ? state.currentCommitId.slice(0, 7) : 'no commit'}${state?.statusMessage ? ' · ' + escapeHtml(state.statusMessage) : ''}</div>
        </div>
        <div class="toggle ${isActive ? 'on' : ''}" data-uid="${user.userId}"></div>
      `;

      // Click row to expand/collapse controls
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('toggle')) return;
        expandedUserId = expandedUserId === user.userId ? null : user.userId;
        renderRoster();
      });

      // Toggle online/offline
      const toggle = row.querySelector('.toggle')! as HTMLElement;
      toggle.addEventListener('click', async () => {
        if (isActive) {
          await manager?.deactivateUser(user.userId);
          log(`${user.displayName} left (manual)`);
        } else {
          await manager?.activateUser(user);
          log(`${user.displayName} joined (manual)`);
        }
        renderRoster();
      });

      rosterBody.appendChild(row);

      // Expandable controls
      const controls = document.createElement('div');
      controls.className = `user-controls ${expandedUserId === user.userId ? 'visible' : ''}`;
      controls.innerHTML = `
        <select data-uid="${user.userId}">
          <option value="">— select commit —</option>
          ${commitIds.map((id) => `<option value="${id}" ${state?.currentCommitId === id ? 'selected' : ''}>${id.slice(0, 10)}</option>`).join('')}
        </select>
        <input type="text" placeholder="Status message" value="${escapeHtml(state?.statusMessage ?? '')}" data-uid="${user.userId}" />
      `;

      const select = controls.querySelector('select')!;
      select.addEventListener('change', async () => {
        await manager?.setCommit(user.userId, select.value || null);
        log(`${user.displayName} → commit ${select.value ? select.value.slice(0, 7) : 'none'} (manual)`);
        renderRoster();
      });

      const input = controls.querySelector('input')!;
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await manager?.setStatus(user.userId, input.value);
          log(`${user.displayName} set status: "${input.value}" (manual)`);
          renderRoster();
        }
      });
      input.addEventListener('blur', async () => {
        const currentStatus = manager?.getState(user.userId)?.statusMessage ?? '';
        if (input.value !== currentStatus) {
          await manager?.setStatus(user.userId, input.value);
          log(`${user.displayName} set status: "${input.value}" (manual)`);
          renderRoster();
        }
      });

      // Stop click propagation on controls
      controls.addEventListener('click', (e) => e.stopPropagation());

      rosterBody.appendChild(controls);
    });
  }

  // ——— Scenario rendering ———
  // Track progress bar elements per scenario for live updates
  const progressBars: Map<string, { bar: HTMLElement; fill: HTMLElement; elapsed: HTMLElement }> = new Map();

  function renderScenarios() {
    scenarioBody.innerHTML = '';
    progressBars.clear();

    const runningId = runner?.currentScenarioId ?? null;

    ALL_SCENARIOS.forEach((scenario) => {
      const card = document.createElement('div');
      card.className = 'scenario-card';

      const isThisRunning = runningId === scenario.id;
      const anyRunning = runningId !== null;

      card.innerHTML = `
        <div class="scenario-name">${escapeHtml(scenario.name)}</div>
        <div class="scenario-desc">${escapeHtml(scenario.description)}</div>
        <button class="scenario-btn ${isThisRunning ? 'stop' : ''}" ${anyRunning && !isThisRunning ? 'disabled' : ''}>
          ${isThisRunning ? 'Stop' : 'Run'}
        </button>
        <div class="progress-bar ${isThisRunning ? 'visible' : ''}">
          <div class="progress-fill" style="width: 0%"></div>
        </div>
        <div class="scenario-elapsed" style="font-size:11px;color:#737373;margin-top:4px;${isThisRunning ? '' : 'display:none'}">0s elapsed</div>
      `;

      // Store refs for live progress updates
      const bar = card.querySelector('.progress-bar')! as HTMLElement;
      const fill = card.querySelector('.progress-fill')! as HTMLElement;
      const elapsed = card.querySelector('.scenario-elapsed')! as HTMLElement;
      progressBars.set(scenario.id, { bar, fill, elapsed });

      const btn = card.querySelector('button')!;
      btn.addEventListener('click', async () => {
        if (isThisRunning) {
          await runner?.stop();
          renderScenarios();
          renderRoster();
        } else if (!anyRunning) {
          renderScenarios(); // update button states
          await runner?.run(scenario);
          renderScenarios();
          renderRoster();
        }
      });

      scenarioBody.appendChild(card);
    });
  }

  /** Called by ScenarioRunner after each action — update progress bar and roster. */
  function onScenarioProgress(current: number, total: number, elapsedMs: number) {
    const runningId = runner?.currentScenarioId;
    if (!runningId) return;
    const refs = progressBars.get(runningId);
    if (!refs) return;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    refs.fill.style.width = `${pct}%`;
    refs.elapsed.textContent = `${Math.round(elapsedMs / 1000)}s elapsed`;
  }

  // ——— Cleanup on page unload ———
  // Note: deactivateAll() is async but beforeunload may not wait for it.
  // In practice, closing the WebSocket connection triggers Supabase server-side
  // presence leave events. If ghost users persist briefly (~30s), that's expected
  // and handled by Supabase's built-in presence timeout.
  window.addEventListener('beforeunload', () => {
    manager?.deactivateAll();
  });
  ```

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 4: Verify the dashboard loads in the browser**

  Start the dev server if not running:
  ```bash
  npm run dev
  ```

  Open `http://localhost:5173/src/dev/presence-sim.html` in a browser. Verify:
  - The page renders with the setup bar and three panels (greyed out)
  - No console errors

- [ ] **Step 5: Commit**

  ```bash
  git add src/dev/presence-sim.html src/dev/presence-sim.ts
  git commit -m "feat: add presence simulation dashboard UI and orchestration"
  ```

---

### Task 7: End-to-end manual verification

Run the full simulation against the Electron app to verify everything works together.

**Files:** none (verification only)

- [ ] **Step 1: Start the Electron app**

  ```bash
  npm run electron:dev
  ```
  Sign in and open a cloud-connected project. Note the `cloudProject.id` (visible in devtools or the Settings page).

- [ ] **Step 2: Open the simulation dashboard**

  Open `http://localhost:5173/src/dev/presence-sim.html` in a separate browser window. Sign in with your Supabase credentials. Paste the project ID and click Connect.

- [ ] **Step 3: Test manual controls**

  - Toggle 2-3 users online via the roster
  - Verify they appear in the Electron app's TeamPresencePanel
  - Set a commit on one user — verify the avatar appears on that commit node in the Electron app
  - Set a status message — verify it appears under the user's name in the Electron app
  - Toggle a user offline — verify they disappear from the Electron app

- [ ] **Step 4: Test each scenario**

  Run each of the 4 scenarios one at a time:
  - **Morning Standup** — 8 users should appear in the panel over ~90s
  - **Crowded Commit** — 6 avatars on one commit, verify the +3 overflow badge
  - **Active Collaboration** — rapid commit switching visible in the Electron app
  - **End of Day** — users disappear one by one

  For each: verify the event log in the dashboard matches what you see in the Electron app.

- [ ] **Step 5: Test cleanup**

  Close the dashboard browser tab. Verify all fake users disappear from the Electron app within a few seconds.

- [ ] **Step 6: Commit** (no code changes expected — skip if nothing to commit)
