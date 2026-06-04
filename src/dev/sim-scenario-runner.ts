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
  private scenarioUserIds: Set<string> = new Set();
  private _running = false;
  private _currentScenarioId: string | null = null;
  private onLog: ActionLogCallback = () => {};
  private onProgress: ProgressCallback = () => {};
  private onActionExecuted: (() => void) | null = null;

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

    try {
      for (let i = 0; i < scenario.actions.length; i++) {
        if (cancelled) break;
        const action = scenario.actions[i];

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

        try {
          await this.executeAction(action);
        } catch (err) {
          const user = this.findUser(action.userId);
          const name = user?.displayName ?? action.userId;
          const msg = err instanceof Error ? err.message : String(err);
          this.onLog(`⚠ Error [${name}/${action.action}]: ${msg}`);
        }
        this.onProgress(i + 1, totalActions, Date.now() - startTime);
        this.onActionExecuted?.();
      }

      if (cancelled) {
        this.onLog('⏹ Scenario cancelled — cleaning up');
        await this.cleanupScenarioUsers();
      } else {
        this.onLog(`✓ Scenario "${scenario.name}" complete`);
      }
    } finally {
      this._running = false;
      this._currentScenarioId = null;
      this.cancelHandle = null;
    }
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
