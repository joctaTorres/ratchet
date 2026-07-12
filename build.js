#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, rmSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit' });
};

// tsc only emits from TypeScript inputs, so non-TS assets under src/ (e.g. the
// ReX sidecar .py) are silently dropped from a clean dist build. Copy them to
// their mirrored dist/ path so the packaged CLI ships them. Load-bearing: the
// sidecar bootstrap resolves sidecar.py relative to the COMPILED module.
const collectFiles = (dir, ext) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
};

const copyNonTsAssets = () => {
  const srcDir = path.resolve('src');
  const distDir = path.resolve('dist');
  // Ship runtime .py (the ReX sidecar), but NOT `test_*.py` unit-test harnesses
  // (stdlib unittest, run from src) — they are not part of the packaged CLI.
  const assets = collectFiles(srcDir, '.py').filter(
    (f) => !path.basename(f).startsWith('test_')
  );
  if (assets.length === 0) {
    // A note so a future rename/move of the sidecar is noticed loudly. We do
    // NOT return here: the unconditional dist assertion below is the real gate
    // and must run so a missing packaged sidecar hard-fails the build.
    console.warn(
      '⚠️  No .py assets found under src/ — expected the ReX sidecar. ' +
        'Did sidecar.py move or get renamed?'
    );
  }
  for (const asset of assets) {
    const rel = path.relative(srcDir, asset);
    const dest = path.join(distDir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(asset, dest);
    console.log(`Copied asset: ${rel}`);
  }

  // Build-time assertion: the sidecar bootstrap resolves sidecar.py relative to
  // the COMPILED runtime module (dist/core/batch/engine/runtime/sidecar.py), so
  // that exact path MUST exist after the copy. A miss hard-fails the build
  // (exit non-zero) rather than warn-and-continue, so a missing packaged
  // sidecar never ships a CLI that would crash at the first docker/local spawn.
  const expectedSidecar = path.join(
    distDir,
    'core',
    'batch',
    'engine',
    'runtime',
    'sidecar.py'
  );
  if (!existsSync(expectedSidecar)) {
    throw new Error(
      `Build assertion failed: expected packaged sidecar asset not found at ` +
        `'${path.relative('.', expectedSidecar)}'. The ReX sidecar bootstrap ` +
        `resolves sidecar.py relative to the compiled runtime module; a missing ` +
        `asset would crash at spawn. Did sidecar.py move or get renamed?`
    );
  }
};

console.log('🔨 Building ratchet...\n');

// Clean dist directory
if (existsSync('dist')) {
  console.log('Cleaning dist directory...');
  rmSync('dist', { recursive: true, force: true });
}

// Run TypeScript compiler (use local version explicitly)
console.log('Compiling TypeScript...');
try {
  runTsc(['--version']);
  runTsc();

  console.log('\nCopying non-TS assets...');
  copyNonTsAssets();

  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed!');
  if (error && error.message) {
    console.error(error.message);
  }
  process.exit(1);
}
