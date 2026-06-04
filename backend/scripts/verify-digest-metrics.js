#!/usr/bin/env node
/**
 * Manual verification harness for backend/scripts/digest-metrics.js.
 *
 * The codebase has no automated test runner; this script asserts every
 * metric function against hand-built fixtures and exits non-zero if any
 * case fails. Run before committing changes to digest-metrics.js:
 *
 *   node backend/scripts/verify-digest-metrics.js
 *
 * Each `check()` prints a single line; failures throw and the script
 * exits 1.
 */

import {
  weekStartUtc,
  inWeek,
  isoDate,
  computeReturnCommitCohort,
  detectProjectSilence,
  detectSilentPayingUsers,
  detectConversionCandidates,
  topProjectsByVolume,
  freeToPayConversions,
} from './digest-metrics.js';

import {
  REFERENCE_WEEK_START,
  COMMITS_BY_USER,
  EXPECTED_COHORT,
  COMMITS_BY_PROJECT,
  EXPECTED_SILENT_PROJECTS,
  PLANS,
  LAST_COMMIT_TIMES,
  EXPECTED_SILENT_PAYING,
  COMMITS_THIS_WEEK,
  PROJECTS_THIS_WEEK,
  RECENTLY_FLAGGED,
  EXPECTED_CONVERSION_CANDIDATES,
  PROJECT_COMMIT_COUNTS,
  PROJECT_MOST_RECENT_COMMIT,
  EXPECTED_TOP_5,
  PULSES_THIS_WEEK,
  PULSES_LAST_WEEK,
  EXPECTED_CONVERSIONS,
} from '../test-fixtures/digest/fixtures.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected, deepEqual = true) {
  const ok = deepEqual
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (ok) {
    passed++;
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.error(`✗ ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// weekStartUtc
// ============================================================
console.log('\n— weekStartUtc —');
check(
  'mid-week date returns prior Monday 00:00 UTC',
  weekStartUtc('2026-04-30T15:30:00Z').toISOString(),
  '2026-04-27T00:00:00.000Z',
);
check(
  'Monday 00:00 UTC returns itself',
  weekStartUtc('2026-04-27T00:00:00Z').toISOString(),
  '2026-04-27T00:00:00.000Z',
);
check(
  'Sunday 23:59 UTC returns previous Monday',
  weekStartUtc('2026-04-26T23:59:59Z').toISOString(),
  '2026-04-20T00:00:00.000Z',
);
check(
  'Saturday returns Monday of same week',
  weekStartUtc('2026-05-02T12:00:00Z').toISOString(),
  '2026-04-27T00:00:00.000Z',
);
check(
  'accepts ms epoch',
  weekStartUtc(REFERENCE_WEEK_START.getTime()).toISOString(),
  '2026-04-27T00:00:00.000Z',
);

let invalid = false;
try {
  weekStartUtc('not-a-date');
} catch (err) {
  invalid = err instanceof TypeError;
}
check('throws TypeError on invalid input', invalid, true, false);

// ============================================================
// inWeek
// ============================================================
console.log('\n— inWeek —');
check(
  'first millisecond of week is in window',
  inWeek('2026-04-27T00:00:00.000Z', REFERENCE_WEEK_START),
  true,
  false,
);
check(
  'last millisecond before next Monday is in window',
  inWeek('2026-05-03T23:59:59.999Z', REFERENCE_WEEK_START),
  true,
  false,
);
check(
  'next Monday 00:00 is NOT in window (exclusive end)',
  inWeek('2026-05-04T00:00:00.000Z', REFERENCE_WEEK_START),
  false,
  false,
);
check(
  'one ms before window is NOT in window',
  inWeek('2026-04-26T23:59:59.999Z', REFERENCE_WEEK_START),
  false,
  false,
);

// ============================================================
// isoDate
// ============================================================
console.log('\n— isoDate —');
check('formats UTC date', isoDate('2026-04-27T00:00:00Z'), '2026-04-27', false);
check('zero-pads single-digit month/day', isoDate('2026-01-05T00:00:00Z'), '2026-01-05', false);

// ============================================================
// computeReturnCommitCohort (the North Star)
// ============================================================
console.log('\n— computeReturnCommitCohort —');
const cohort = computeReturnCommitCohort(COMMITS_BY_USER, REFERENCE_WEEK_START);
check('numerator', cohort.numerator, EXPECTED_COHORT.numerator, false);
check('denominator', cohort.denominator, EXPECTED_COHORT.denominator, false);
check('percent', cohort.percent, EXPECTED_COHORT.percent, false);

const emptyCohort = computeReturnCommitCohort({}, REFERENCE_WEEK_START);
check('empty input → 0/0/0', emptyCohort, { numerator: 0, denominator: 0, percent: 0 });

// ============================================================
// detectProjectSilence
// ============================================================
console.log('\n— detectProjectSilence —');
const silentProjects = detectProjectSilence(COMMITS_BY_PROJECT, REFERENCE_WEEK_START);
check('default thresholds (3 prior weeks, ≥1 each)', silentProjects.sort(), EXPECTED_SILENT_PROJECTS.sort());

const noPriorRequired = detectProjectSilence(COMMITS_BY_PROJECT, REFERENCE_WEEK_START, {
  minPriorWeeks: 0,
});
check(
  'minPriorWeeks=0 surfaces every silent project',
  noPriorRequired.includes('project-silent') && noPriorRequired.includes('project-quiet-history'),
  true,
  false,
);

// ============================================================
// detectSilentPayingUsers
// ============================================================
console.log('\n— detectSilentPayingUsers —');
const silentPaying = detectSilentPayingUsers(PLANS, LAST_COMMIT_TIMES, REFERENCE_WEEK_START).sort();
check('14d cutoff + null last-commit', silentPaying, EXPECTED_SILENT_PAYING.sort());

// ============================================================
// detectConversionCandidates
// ============================================================
console.log('\n— detectConversionCandidates —');
const candidates = detectConversionCandidates(
  PLANS,
  COMMITS_THIS_WEEK,
  PROJECTS_THIS_WEEK,
  RECENTLY_FLAGGED,
);
check('happy path (engaged free user)', candidates, EXPECTED_CONVERSION_CANDIDATES);

const arrayFlagged = detectConversionCandidates(
  PLANS,
  COMMITS_THIS_WEEK,
  PROJECTS_THIS_WEEK,
  ['user-free-recently-flagged'],
);
check('accepts array for recentlyFlaggedUserIds', arrayFlagged, EXPECTED_CONVERSION_CANDIDATES);

// ============================================================
// topProjectsByVolume
// ============================================================
console.log('\n— topProjectsByVolume —');
const top5 = topProjectsByVolume(PROJECT_COMMIT_COUNTS, PROJECT_MOST_RECENT_COMMIT, 5);
check('top 5 with recency tiebreak', top5.map(p => p.projectId), EXPECTED_TOP_5);

const top2 = topProjectsByVolume(PROJECT_COMMIT_COUNTS, PROJECT_MOST_RECENT_COMMIT, 2);
check('top 2 truncates correctly', top2.map(p => p.projectId), ['proj-a', 'proj-b']);

const noEntries = topProjectsByVolume({ 'p-zero': 0 }, { 'p-zero': 0 }, 5);
check('zero-commit projects are excluded', noEntries, []);

// ============================================================
// freeToPayConversions
// ============================================================
console.log('\n— freeToPayConversions —');
const conversions = freeToPayConversions(PULSES_THIS_WEEK, PULSES_LAST_WEEK)
  .sort((a, b) => a.userId.localeCompare(b.userId));
check(
  'detects free→active and canceled→active, ignores still-active and never-paid',
  conversions,
  EXPECTED_CONVERSIONS.sort((a, b) => a.userId.localeCompare(b.userId)),
);

const emptyLast = freeToPayConversions(PULSES_THIS_WEEK, []);
check(
  'never-seen-before users default to "free" baseline',
  emptyLast.length,
  PULSES_THIS_WEEK.filter(p => p.plan_status === 'active').length,
  false,
);

// ============================================================
// Summary
// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
