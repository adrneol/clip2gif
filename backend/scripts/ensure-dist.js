'use strict';
// Clip2GIF deploy-contract helper. Zero dependencies, runs on plain node
// (Windows dev machines and Render's Linux runtime alike).
//
//   node scripts/ensure-dist.js           # prestart: compile if missing, then verify
//   node scripts/ensure-dist.js --check   # build chain: verify only, fail if missing
//
// All paths resolve from THIS file's location, never from the process working
// directory, so it behaves identically whether npm runs it from backend/,
// from the repo root via --prefix, or from Render's service root directory.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(PKG_DIR, 'dist', 'server.js');
const CHECK_ONLY = process.argv.includes('--check');

function fail(msg) {
  console.error(`[clip2gif] ${msg}`);
  process.exit(1);
}

if (fs.existsSync(ENTRY)) process.exit(0); // fast path: build output present

if (CHECK_ONLY) {
  fail(
    `dist/server.js not found after build (expected at ${ENTRY}). ` +
      `The TypeScript build did not emit the server entry point — ` +
      `check tsconfig outDir/rootDir and confirm 'tsc' ran without 'noEmit'.`
  );
}

// Self-healing start: compile with the repo's own TypeScript, then re-verify.
// This covers environments where the dashboard Build Command never compiled
// (e.g. install-only builds): the service still boots instead of dying with
// MODULE_NOT_FOUND, provided devDependencies were installed.
let tscBin;
try {
  tscBin = require.resolve('typescript/bin/tsc', { paths: [PKG_DIR] });
} catch {
  fail(
    'dist/server.js is missing and local TypeScript is not installed. ' +
      'Locally run: npm install && npm run build. ' +
      'On Render set Root Directory=backend and Build Command=' +
      'npm install --include=dev && npm run build ' +
      '(devDependencies are required to compile).'
  );
}
console.error('[clip2gif] dist/server.js missing — compiling now with local TypeScript...');
const r = spawnSync(process.execPath, [tscBin], { cwd: PKG_DIR, stdio: 'inherit' });
if (r.status !== 0) {
  fail(`TypeScript build failed (exit ${r.status}). Fix the compile errors above and redeploy.`);
}
if (!fs.existsSync(ENTRY)) {
  fail(
    `Build finished but ${ENTRY} is still missing. ` +
      'Check tsconfig outDir/rootDir — the start target must match the compiler output.'
  );
}
console.error('[clip2gif] build complete, starting server...');
