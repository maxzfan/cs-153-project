#!/usr/bin/env node
/**
 * Block new `console.error` and `console.warn` calls. The project uses
 * electron-log (`log.error` / `log.warn`) so messages flow through the on-disk
 * log file with redaction applied. console-only writes are invisible to the
 * tester preflight and bypass redaction.
 *
 * Allowlist:
 *   - *.test.* files — test code uses Node's test reporter, not electron-log
 *   - src/dev/*      — internal dev tooling, not in the production renderer bundle
 *   - src/main.tsx   — pre-bootstrap env-validation runs before the IPC bridge
 *                      to main is guaranteed to be available
 *
 * Exit 0 if clean, exit 1 (with a list of offenders) otherwise.
 */
const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOTS = ['electron', 'src'];
const ALLOWED_FILES = new Set([path.join('src', 'main.tsx')]);
const ALLOWED_DIRS = [path.join('src', 'dev') + path.sep];
const PATTERN = /\bconsole\.(error|warn)\s*\(/;
const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile()) {
      yield full;
    }
  }
}

const offenders = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!FILE_EXTS.has(path.extname(file))) continue;
    if (file.includes('.test.')) continue;
    if (ALLOWED_FILES.has(file)) continue;
    if (ALLOWED_DIRS.some((d) => file.startsWith(d))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (PATTERN.test(line)) {
        offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
      }
    });
  }
}

if (offenders.length > 0) {
  console.log('lint:no-console — found console.error/warn calls. Use log.error/warn from electron-log instead.');
  for (const line of offenders) console.log('  ' + line);
  process.exit(1);
}

console.log('lint:no-console — clean');
