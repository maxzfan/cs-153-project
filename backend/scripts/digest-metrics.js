/**
 * Pure metric functions for the Weekly Founder Digest.
 *
 * No I/O. Every function takes typed inputs and returns typed outputs.
 * The orchestrator in weekly-digest.js composes these against real
 * Supabase / S3 / SES inputs.
 *
 * See docs/plans/2026-04-28-001-feat-weekly-founder-digest-plan.md
 * (Phase 1) and docs/brainstorms/2026-04-28-weekly-founder-digest-requirements.md
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the Monday 00:00 UTC for the ISO week containing `input`.
 * Accepts a Date, a millisecond epoch, or an ISO string.
 *
 *   weekStartUtc('2026-04-30T15:30:00Z') → 2026-04-27T00:00:00.000Z
 *   weekStartUtc('2026-04-27T00:00:00Z') → 2026-04-27T00:00:00.000Z
 *   weekStartUtc('2026-04-26T23:59:59Z') → 2026-04-20T00:00:00.000Z
 */
export function weekStartUtc(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`weekStartUtc: invalid date input: ${input}`);
  }
  const day = d.getUTCDay();           // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = (day + 6) % 7;      // Sun→6, Mon→0, Tue→1, ..., Sat→5
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysBack,
    0, 0, 0, 0
  ));
}

/**
 * True when `timestamp` falls within the 7-day window [weekStart, weekStart + 7d).
 * Inclusive at the start, exclusive at the end (so Monday 00:00 is in the new week).
 */
export function inWeek(timestamp, weekStart) {
  const t = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  const start = weekStart instanceof Date ? weekStart.getTime() : new Date(weekStart).getTime();
  return t >= start && t < start + WEEK_MS;
}

/**
 * Returns `YYYY-MM-DD` for a Date (UTC).
 */
export function isoDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The North Star: % of users whose first commit was 14+ days before
 * `weekStart`, AND who have a commit in any week strictly later than the
 * ISO week of their first commit.
 *
 * Excludes users whose first commit is within the last 14 days (KD7) — they
 * cannot have made a 2nd-week commit yet.
 *
 * @param {Object<string, number[]>} perUserCommitTimes  userId → ms epochs
 * @param {Date|string|number} weekStart                 the ISO Monday for the digest
 * @returns {{ numerator: number, denominator: number, percent: number }}
 */
export function computeReturnCommitCohort(perUserCommitTimes, weekStart) {
  const wsMs = weekStartUtc(weekStart).getTime();
  const cutoff = wsMs - 14 * DAY_MS;
  let denominator = 0;
  let numerator = 0;
  for (const times of Object.values(perUserCommitTimes)) {
    if (!times || times.length === 0) continue;
    const sorted = [...times].sort((a, b) => a - b);
    const firstMs = sorted[0];
    if (firstMs > cutoff) continue;                      // signed up too recently
    denominator++;
    const firstWeek = weekStartUtc(firstMs).getTime();
    const returned = sorted.some((t) => weekStartUtc(t).getTime() > firstWeek);
    if (returned) numerator++;
  }
  const percent = denominator > 0 ? Math.round(1000 * numerator / denominator) / 10 : 0;
  return { numerator, denominator, percent };
}

/**
 * Identify projects that had ≥minPriorCommitsPerWeek commits in each of the
 * prior `minPriorWeeks` weeks AND zero commits in the current week.
 *
 * @param {Object<string, number[]>} perProjectCommitTimes  projectId → ms epochs
 * @param {Date|string|number} weekStart
 * @param {{ minPriorWeeks?: number, minPriorCommitsPerWeek?: number }} opts
 * @returns {string[]}  project IDs that just went silent
 */
export function detectProjectSilence(perProjectCommitTimes, weekStart, opts = {}) {
  const minPriorWeeks = opts.minPriorWeeks ?? 3;
  const minPriorCommits = opts.minPriorCommitsPerWeek ?? 1;
  const wsMs = weekStartUtc(weekStart).getTime();
  const silent = [];
  for (const [projectId, times] of Object.entries(perProjectCommitTimes)) {
    if (!times || times.length === 0) continue;
    const thisWeekCount = times.filter((t) => inWeek(t, wsMs)).length;
    if (thisWeekCount > 0) continue;                     // not silent
    let qualifies = true;
    for (let w = 1; w <= minPriorWeeks; w++) {
      const priorStart = wsMs - w * WEEK_MS;
      const inThatWeek = times.filter((t) => inWeek(t, priorStart)).length;
      if (inThatWeek < minPriorCommits) {
        qualifies = false;
        break;
      }
    }
    if (qualifies) silent.push(projectId);
  }
  return silent;
}

/**
 * Identify paying users whose most recent commit was more than 14 days before
 * `weekStart`. Users on `plan_status='active'` who never committed are also
 * considered silent.
 *
 * @param {Object<string, string>} plans                  userId → plan_status
 * @param {Object<string, number|null>} lastCommitTimes   userId → ms epoch or null
 * @param {Date|string|number} weekStart
 * @returns {string[]}  user IDs of silent paying users
 */
export function detectSilentPayingUsers(plans, lastCommitTimes, weekStart) {
  const wsMs = weekStartUtc(weekStart).getTime();
  const cutoff = wsMs - 14 * DAY_MS;
  const silent = [];
  for (const [userId, planStatus] of Object.entries(plans)) {
    if (planStatus !== 'active') continue;
    const last = lastCommitTimes[userId];
    if (last == null || last < cutoff) silent.push(userId);
  }
  return silent;
}

/**
 * Identify free users with high-engagement signals worth reaching out to.
 * Excludes users already flagged in any of the last 4 weeks.
 *
 * @param {Object<string, string>} plans              userId → plan_status
 * @param {Object<string, number>} commitsThisWeek    userId → count
 * @param {Object<string, number>} projectsThisWeek   userId → distinct project count
 * @param {Set<string>} recentlyFlaggedUserIds        users flagged in last 4 weeks
 * @returns {string[]}
 */
export function detectConversionCandidates(plans, commitsThisWeek, projectsThisWeek, recentlyFlaggedUserIds) {
  const flagged = recentlyFlaggedUserIds instanceof Set
    ? recentlyFlaggedUserIds
    : new Set(recentlyFlaggedUserIds || []);
  const candidates = [];
  for (const [userId, planStatus] of Object.entries(plans)) {
    if (planStatus !== 'free') continue;
    if (flagged.has(userId)) continue;
    if ((commitsThisWeek[userId] ?? 0) < 3) continue;
    if ((projectsThisWeek[userId] ?? 0) < 2) continue;
    candidates.push(userId);
  }
  return candidates;
}

/**
 * Top N projects by commit count this week, tiebreak by most-recent commit.
 *
 * @param {Object<string, number>} perProjectCommitCounts        projectId → count this week
 * @param {Object<string, number>} perProjectMostRecentCommit    projectId → ms epoch
 * @param {number} n
 * @returns {{ projectId: string, commitCount: number, mostRecent: number }[]}
 */
export function topProjectsByVolume(perProjectCommitCounts, perProjectMostRecentCommit, n = 5) {
  const entries = Object.entries(perProjectCommitCounts)
    .filter(([, count]) => count > 0)
    .map(([projectId, count]) => ({
      projectId,
      commitCount: count,
      mostRecent: perProjectMostRecentCommit[projectId] ?? 0,
    }));
  entries.sort((a, b) => {
    if (b.commitCount !== a.commitCount) return b.commitCount - a.commitCount;
    return b.mostRecent - a.mostRecent;
  });
  return entries.slice(0, n);
}

/**
 * Detect free→Pro transitions by diffing two weeks of usage_pulse rows.
 * "Free" includes 'free', 'canceled', 'past_due', 'trialing' — anything
 * other than 'active' last week, then 'active' this week, counts.
 *
 * Users not present in `lastWeekPulses` default to 'free' (never seen).
 *
 * @param {{ user_id: string, plan_status: string }[]} thisWeekPulses
 * @param {{ user_id: string, plan_status: string }[]} lastWeekPulses
 * @returns {{ userId: string, fromStatus: string }[]}
 */
export function freeToPayConversions(thisWeekPulses, lastWeekPulses) {
  const lastWeekByUser = new Map();
  for (const p of lastWeekPulses) lastWeekByUser.set(p.user_id, p.plan_status);
  const transitions = [];
  for (const p of thisWeekPulses) {
    if (p.plan_status !== 'active') continue;
    const lastStatus = lastWeekByUser.get(p.user_id) ?? 'free';
    if (lastStatus !== 'active') transitions.push({ userId: p.user_id, fromStatus: lastStatus });
  }
  return transitions;
}
