/**
 * Hand-built fixtures for verifying backend/scripts/digest-metrics.js.
 *
 * All timestamps are anchored to a reference week: 2026-04-27 (Monday 00:00 UTC).
 * Each fixture set is sized to demonstrate one boundary plus one happy path.
 */

export const REFERENCE_WEEK_START = new Date('2026-04-27T00:00:00Z');

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const ws = REFERENCE_WEEK_START.getTime();

// Helper to express "X days into week N" relative to reference week.
// week 0 = the digest week; week -1 = last week; week -3 = three weeks ago.
function weekDay(weekIndex, dayOffset = 0, hourOffset = 12) {
  return ws + weekIndex * WEEK + dayOffset * DAY + hourOffset * 60 * 60 * 1000;
}

// ============================================================
// User commit timelines (for return-commit cohort)
// ============================================================
export const COMMITS_BY_USER = {
  // Returning user: first commit 30d ago, second commit this week → in numerator
  'user-returning': [weekDay(-4, 1), weekDay(0, 2)],

  // One-shot: first and only commit 30d ago, no return → in denominator only
  'user-one-shot': [weekDay(-4, 3)],

  // Multiple commits in same week as first commit, never returned → denominator only
  'user-same-week-only': [weekDay(-3, 1), weekDay(-3, 3), weekDay(-3, 5)],

  // First commit 5 days ago: signed up too recently, EXCLUDED from denominator
  'user-recent-signup': [weekDay(0, -5)],

  // Empty commit list — should be ignored
  'user-no-commits': [],
};

// Expected: denominator=3 (returning, one-shot, same-week-only), numerator=1 (returning), pct=33.3
export const EXPECTED_COHORT = { numerator: 1, denominator: 3, percent: 33.3 };

// ============================================================
// Project commit timelines (for project-silence detection)
// ============================================================
export const COMMITS_BY_PROJECT = {
  // Silent: 1+ commits each of 3 prior weeks, 0 this week → SILENT
  'project-silent': [weekDay(-3, 2), weekDay(-2, 1), weekDay(-1, 4)],

  // Active this week → not silent regardless of priors
  'project-active': [weekDay(-3, 1), weekDay(-2, 2), weekDay(-1, 3), weekDay(0, 1)],

  // Quiet history: only 2 prior weeks have commits → does NOT qualify
  'project-quiet-history': [weekDay(-2, 1), weekDay(-1, 4)],

  // Brand new: only commits 4+ weeks ago → does NOT qualify
  'project-ancient': [weekDay(-5, 1), weekDay(-5, 2)],

  // Empty
  'project-empty': [],
};

export const EXPECTED_SILENT_PROJECTS = ['project-silent'];

// ============================================================
// Plans + last-commit times (for silent-paying-user + conversion candidates)
// ============================================================
export const PLANS = {
  'user-paying-active':   'active',
  'user-paying-silent':   'active',
  'user-paying-no-history': 'active',
  'user-free-engaged':    'free',
  'user-free-low':        'free',
  'user-free-recently-flagged': 'free',
  'user-canceled':        'canceled',
};

export const LAST_COMMIT_TIMES = {
  'user-paying-active':     weekDay(0, 0),         // committed today
  'user-paying-silent':     weekDay(-3, 0),        // last commit 3 weeks ago → silent
  'user-paying-no-history': null,                  // never committed → silent
  'user-free-engaged':      weekDay(0, 1),
  'user-free-low':          weekDay(0, 2),
  'user-free-recently-flagged': weekDay(0, 1),
  'user-canceled':          weekDay(-1, 0),
};

export const EXPECTED_SILENT_PAYING = ['user-paying-silent', 'user-paying-no-history'];

// ============================================================
// Conversion candidate fixtures
// ============================================================
export const COMMITS_THIS_WEEK = {
  'user-free-engaged':           5,    // ≥3 ✓
  'user-free-low':               1,    // <3 ✗
  'user-free-recently-flagged':  6,    // ≥3 ✓ but flagged in prior weeks
  'user-paying-active':          4,    // not free
};

export const PROJECTS_THIS_WEEK = {
  'user-free-engaged':           3,    // ≥2 ✓
  'user-free-low':               1,    // <2 ✗
  'user-free-recently-flagged':  4,    // ≥2 ✓
  'user-paying-active':          2,
};

export const RECENTLY_FLAGGED = new Set(['user-free-recently-flagged']);

export const EXPECTED_CONVERSION_CANDIDATES = ['user-free-engaged'];

// ============================================================
// Top-projects fixture
// ============================================================
export const PROJECT_COMMIT_COUNTS = {
  'proj-a': 12,
  'proj-b': 12,                                     // tied with proj-a
  'proj-c': 7,
  'proj-d': 0,                                      // zero commits → excluded
  'proj-e': 3,
  'proj-f': 3,                                      // tied with proj-e
};

export const PROJECT_MOST_RECENT_COMMIT = {
  'proj-a': weekDay(0, 4),                          // more recent than proj-b
  'proj-b': weekDay(0, 1),
  'proj-c': weekDay(0, 0),
  'proj-d': 0,
  'proj-e': weekDay(0, 5),                          // more recent than proj-f
  'proj-f': weekDay(0, 2),
};

// Expected order: proj-a, proj-b (tie broken by recency), proj-c, proj-e, proj-f
export const EXPECTED_TOP_5 = ['proj-a', 'proj-b', 'proj-c', 'proj-e', 'proj-f'];

// ============================================================
// Free → Pro conversion fixtures
// ============================================================
export const PULSES_THIS_WEEK = [
  { user_id: 'u-converted-from-free',     plan_status: 'active' },
  { user_id: 'u-converted-from-canceled', plan_status: 'active' },
  { user_id: 'u-still-active',            plan_status: 'active' },
  { user_id: 'u-still-free',              plan_status: 'free' },
  { user_id: 'u-new-trialing',            plan_status: 'trialing' },
];

export const PULSES_LAST_WEEK = [
  { user_id: 'u-converted-from-free',     plan_status: 'free' },
  { user_id: 'u-converted-from-canceled', plan_status: 'canceled' },
  { user_id: 'u-still-active',            plan_status: 'active' },
  // u-still-free, u-new-trialing not present last week → defaults to 'free'
];

export const EXPECTED_CONVERSIONS = [
  { userId: 'u-converted-from-free',     fromStatus: 'free' },
  { userId: 'u-converted-from-canceled', fromStatus: 'canceled' },
];
