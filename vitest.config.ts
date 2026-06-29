import { defineConfig } from 'vitest/config';
import os from 'node:os';

function resolveMaxWorkers(): number | undefined {
  // Allow callers (CI/agents) to override without editing config.
  const raw = process.env.VITEST_MAX_WORKERS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Vitest v3 defaults to `pool: "forks"` and scales worker processes with CPU.
  // This repo's tests can spawn many Node processes (CLI invocations, temp FS),
  // so cap parallelism to avoid runaway CPU/memory usage in automation.
  const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.min(4, Math.max(1, cpuCount));
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './vitest.setup.ts',
    // Tests rely on per-file process isolation (e.g., `process.cwd()` assumptions).
    pool: 'forks',
    maxWorkers: resolveMaxWorkers(),
    include: ['test/**/*.test.ts'],
    coverage: {
      // `json-summary` emits coverage/coverage-summary.json with a `total` block;
      // the coverage-gate evaluator reads that total. Enforcement does NOT live
      // here (no `coverage.thresholds`) — it lives in the unit-tested runner.
      reporter: ['text', 'json', 'html', 'json-summary'],
      exclude: [
        'node_modules/',
        'dist/',
        'bin/',
        '*.config.ts',
        'build.js',
        'test/**',
        // Untracked, local-only vendored reference checkouts of other tools live
        // under `.agents/` (gitignored). They are not this repo's code, so they
        // must never be instrumented — `all: true` would otherwise drag the
        // measured total down by tens of thousands of foreign, untested lines.
        // A no-op in CI (where `.agents/` does not exist).
        '.agents/**',
        // Non-application sources: the terminal-animation demo scripts under
        // `scripts/**` (braille / spin / preview demos, run by hand, not part of
        // the shipped CLI) and the root tooling config `eslint.config.js`.
        // Measuring them as uncovered application lines understates real coverage,
        // so they are excluded alongside `.agents/**`. `website/` is NOT excluded —
        // it is application code and stays measured.
        'scripts/**',
        'eslint.config.js'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 3000
  }
});
