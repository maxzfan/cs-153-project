import { SIM_USERS } from './sim-users';

export interface ScenarioAction {
  delayMs: number;
  userId: string;
  action: 'join' | 'leave' | 'setCommit' | 'setStatus';
  value?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  actions: ScenarioAction[];
}

function pickUsers(start: number, count: number): string[] {
  return SIM_USERS.slice(start, start + count).map((u) => u.userId);
}

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
    actions.push({ delayMs: i === 0 ? 0 : 10000 + Math.random() * 2000, userId: uid, action: 'join' });
    actions.push({ delayMs: 500, userId: uid, action: 'setStatus', value: STANDUP_STATUSES[i] });
    actions.push({ delayMs: 1000, userId: uid, action: 'setCommit', value: 'random' });
  });

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

  users.forEach((uid, i) => {
    actions.push({ delayMs: i === 0 ? 0 : 1500, userId: uid, action: 'join' });
    actions.push({ delayMs: 200, userId: uid, action: 'setCommit', value: 'latest' });
  });

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

  users.forEach((uid, i) => {
    actions.push({ delayMs: i === 0 ? 0 : 500, userId: uid, action: 'join' });
    actions.push({ delayMs: 200, userId: uid, action: 'setCommit', value: 'random' });
  });

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

  users.forEach((uid, i) => {
    actions.push({ delayMs: i === 0 ? 0 : 200, userId: uid, action: 'join' });
    actions.push({ delayMs: 100, userId: uid, action: 'setStatus', value: 'wrapping up' });
    actions.push({ delayMs: 100, userId: uid, action: 'setCommit', value: 'random' });
  });

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
