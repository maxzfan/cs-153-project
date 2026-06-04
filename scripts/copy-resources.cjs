#!/usr/bin/env node
/**
 * copy-resources.cjs
 *
 * Cross-platform replacement for the Unix-only `mkdir -p && cp` shell
 * built-ins that previously lived in package.json's `copy:rhino3dm` and
 * `copy:web-ifc` scripts. PowerShell on `windows-latest` rejects the
 * `mkdir -p` syntax, which is why the build-windows CI job has never
 * produced a working .exe (see docs/handoffs/2026-04-26-windows-tester-round-1.md
 * §0b for the empirical confirmation).
 *
 * Uses Node 16+ built-ins (`fs.mkdirSync({ recursive: true })`,
 * `fs.copyFileSync`, `fs.statSync`) — no helper deps like shx/cpx/ncp.
 *
 * Usage:
 *   node scripts/copy-resources.cjs
 *
 * Idempotent: safe to run multiple times. Logs each copy with size.
 */

const fs = require('node:fs');
const path = require('node:path');

const COPIES = [
  { src: 'node_modules/rhino3dm/rhino3dm.min.js', dst: 'public/rhino3dm/rhino3dm.min.js' },
  { src: 'node_modules/rhino3dm/rhino3dm.wasm',   dst: 'public/rhino3dm/rhino3dm.wasm'   },
  { src: 'node_modules/web-ifc/web-ifc.wasm',     dst: 'public/web-ifc/web-ifc.wasm'     },
];

function fail(msg) {
  console.error(`copy-resources: FAIL — ${msg}`);
  process.exit(1);
}

let copied = 0;
for (const { src, dst } of COPIES) {
  const srcAbs = path.resolve(src);
  const dstAbs = path.resolve(dst);
  if (!fs.existsSync(srcAbs)) {
    fail(`source missing: ${src}. Run \`npm install\` first.`);
  }
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  fs.copyFileSync(srcAbs, dstAbs);
  const { size } = fs.statSync(dstAbs);
  console.log(`copy-resources: ${src} → ${dst} (${size.toLocaleString()} bytes)`);
  copied++;
}
console.log(`copy-resources: ${copied} resource(s) copied.`);
