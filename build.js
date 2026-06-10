#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit' });
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

  // Build the licensed engine package AFTER the root. Its tsc build consumes the
  // root `ratchet` package's emitted types (it declares `"ratchet": "workspace:*"`),
  // so the root must be compiled first. The engine stays an optional, non-declared
  // dependency of the open CLI — we only emit its dist so that, when installed, the
  // CLI's dynamic import resolves to a real `dist/index.js`.
  const engineTsconfig = 'packages/batch-engine/tsconfig.json';
  if (existsSync(engineTsconfig)) {
    console.log('Compiling @ratchet/batch-engine...');
    runTsc(['-p', engineTsconfig]);
  }

  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed!');
  process.exit(1);
}
