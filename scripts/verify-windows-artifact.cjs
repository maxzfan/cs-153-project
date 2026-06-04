#!/usr/bin/env node
/**
 * verify-windows-artifact.cjs
 *
 * Phase 0b deliverable from docs/plans/2026-04-26-001-feat-windows-build-hardening-plan.md.
 *
 * Asserts that a Windows .exe artifact (electron-builder NSIS output) contains
 * the WASM blobs the renderer needs to load 3D models. The April 5 packaging
 * scaffold uses Unix-only `mkdir -p` + `cp` in `copy:rhino3dm` / `copy:web-ifc`
 * scripts, which fail silently on PowerShell on `windows-latest`. Without those
 * resources in the asar, the app launches but every .3dm/.rvt/.ifc fails to load.
 *
 * Usage:
 *   node scripts/verify-windows-artifact.cjs <path-to-installer.exe>
 *
 * Exits 0 on pass, 1 on any verification failure.
 *
 * Strategy:
 *   1. NSIS installer is a self-extracting wrapper around 7z. Use 7z to extract
 *      `$PLUGINSDIR/app-64.7z` (the squashed app payload), then extract that
 *      to find `resources/app.asar` and `resources/app.asar.unpacked/`.
 *   2. Use `npx asar list` to inspect contents and check the unpacked directory
 *      directly for WASM blobs (rhino3dm and web-ifc are listed in `asarUnpack`
 *      per package.json:120-124, so they live in app.asar.unpacked/).
 *   3. Required artifacts:
 *      - dist/rhino3dm/rhino3dm.wasm (>1 MB — the WASM blob is ~7-10MB)
 *      - dist/rhino3dm/rhino3dm.min.js
 *      - dist/web-ifc/web-ifc.wasm (>1 MB)
 *
 * Once Phase 1 lands, this should also run as a CI step on every Windows build
 * to prevent regressions. See plan §0b / Quality Gates.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const REQUIRED = [
  { rel: 'dist/rhino3dm/rhino3dm.wasm',    minBytes: 1_000_000 },
  { rel: 'dist/rhino3dm/rhino3dm.min.js',  minBytes: 10_000   },
  { rel: 'dist/web-ifc/web-ifc.wasm',      minBytes: 1_000_000 },
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`OK:   ${msg}`);
}

function which(cmd) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return res.status === 0;
}

function extract7z(archive, outDir) {
  if (!which('7z') && !which('7zz')) {
    fail('7z (or 7zz) not on PATH. macOS: `brew install sevenzip`. Windows runners have it preinstalled.');
  }
  const bin = which('7z') ? '7z' : '7zz';
  const res = spawnSync(bin, ['x', '-y', `-o${outDir}`, archive], { encoding: 'utf8' });
  if (res.status !== 0) {
    fail(`7z extraction of ${archive} failed:\n${res.stderr || res.stdout}`);
  }
}

function main() {
  const installer = process.argv[2];
  if (!installer) {
    console.error('Usage: node scripts/verify-windows-artifact.cjs <path-to-Setup.exe>');
    process.exit(2);
  }
  if (!fs.existsSync(installer)) fail(`installer not found: ${installer}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-win-artifact-'));
  console.log(`workdir: ${work}`);

  // Step 1: extract the NSIS installer wrapper
  console.log('extracting installer wrapper…');
  const wrapper = path.join(work, 'wrapper');
  extract7z(installer, wrapper);

  // electron-builder NSIS layout: $PLUGINSDIR/app-64.7z is the inner app payload
  const innerCandidates = [
    path.join(wrapper, '$PLUGINSDIR', 'app-64.7z'),
    path.join(wrapper, '$PLUGINSDIR', 'app-32.7z'),
  ];
  const inner = innerCandidates.find(p => fs.existsSync(p));
  if (!inner) {
    fail(`could not find app-64.7z in ${wrapper}/$PLUGINSDIR/. Listing:\n${fs.readdirSync(path.join(wrapper, '$PLUGINSDIR')).join('\n')}`);
  }
  pass(`found inner payload: ${path.basename(inner)}`);

  // Step 2: extract the inner payload
  console.log('extracting app payload…');
  const app = path.join(work, 'app');
  extract7z(inner, app);

  // Step 3: locate resources/app.asar.unpacked/
  const unpacked = path.join(app, 'resources', 'app.asar.unpacked');
  if (!fs.existsSync(unpacked)) {
    fail(`resources/app.asar.unpacked/ missing — asarUnpack config may be wrong. Looked at ${unpacked}.`);
  }
  pass('resources/app.asar.unpacked/ exists');

  // Step 4: assert each required artifact exists with sufficient size
  let failures = 0;
  for (const { rel, minBytes } of REQUIRED) {
    const full = path.join(unpacked, rel);
    if (!fs.existsSync(full)) {
      console.error(`FAIL: ${rel} missing`);
      failures++;
      continue;
    }
    const { size } = fs.statSync(full);
    if (size < minBytes) {
      console.error(`FAIL: ${rel} present but only ${size} bytes (expected >= ${minBytes})`);
      failures++;
      continue;
    }
    pass(`${rel} (${size.toLocaleString()} bytes)`);
  }

  // Step 5: also assert the asar itself was produced (sanity check)
  const asar = path.join(app, 'resources', 'app.asar');
  if (!fs.existsSync(asar)) {
    console.error('FAIL: resources/app.asar missing');
    failures++;
  } else {
    pass(`resources/app.asar (${fs.statSync(asar).size.toLocaleString()} bytes)`);
  }

  if (failures > 0) {
    fail(`${failures} required artifact(s) missing or undersized. The build-windows CI job is probably silently dropping the rhino3dm/web-ifc copy step (see plan §1a).`);
  }

  console.log('\nAll required artifacts present. Workdir kept for inspection: ' + work);
  process.exit(0);
}

main();
