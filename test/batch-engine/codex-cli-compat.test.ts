/**
 * Codex CLI compatibility — features/agent-permissions/codex-exec-flags.feature
 * (Scenario Outline "the installed codex CLI parses every posture's flags" and
 * "the CLI-compatibility check is skipped when codex is absent").
 *
 * Spawns the INSTALLED `codex exec <posture flags> --help` for every posture and
 * asserts exit 0: clap rejects an unknown option (exit 2) before printing help,
 * so a zero exit proves the generated argv parses. `--help` makes no model call.
 * Skipped when `codex` is not on PATH so CI without the binary stays green.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolvePermissionFlags } from '../../src/core/batch/runtime/agent-permissions.js';
import type { PermissionPosture } from '../../src/core/batch/permissions-policy.js';

const codexOnPath = spawnSync('codex', ['--version'], { stdio: 'ignore' }).status === 0;

const POSTURES: PermissionPosture[] = [
  'repo-sandboxed-permissive',
  'curated-allowlist',
  'full-autonomy',
];

describe.skipIf(!codexOnPath)('installed codex exec accepts every posture’s flags', () => {
  for (const posture of POSTURES) {
    it(`${posture}: codex exec parses the generated argv`, () => {
      const flags = resolvePermissionFlags(
        'codex',
        { posture, allow: [], deny: [], raw: {} },
        process.cwd()
      );
      const result = spawnSync('codex', ['exec', '-', ...flags, '--help'], {
        encoding: 'utf-8',
        timeout: 30_000,
      });
      expect(result.stderr).not.toMatch(/unexpected argument/);
      expect(result.status).toBe(0);
    });
  }
});
