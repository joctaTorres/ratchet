/**
 * Implements features/doctor-playwright-probe/detection.feature.
 *
 * `checkPlaywright` is pure (deps injected, no fs), so this mirrors the
 * `FakeDeps` unit-test pattern from `test/core/doctor/doctor.test.ts`. Scope
 * gating (whether the check is appended at all) is covered separately by
 * `web-scope-gating.test.ts`; here the check is assumed already in scope, per
 * the feature's Background.
 */
import { describe, it, expect } from 'vitest';
import { checkPlaywright } from '../../../src/core/doctor/checks/playwright.js';
import { isReportOk } from '../../../src/core/doctor/types.js';
import { serializeReport, exitCodeFor } from '../../../src/core/doctor/render.js';
import type {
  BootstrapDeps,
  RunResult,
} from '../../../src/core/batch/engine/runtime/rex-bootstrap.js';

class FakeDeps implements BootstrapDeps {
  calls: { command: string; args: string[] }[] = [];

  constructor(private handler: (command: string, args: string[]) => RunResult) {}

  run(command: string, args: string[]): RunResult {
    this.calls.push({ command, args });
    return this.handler(command, args);
  }
  hasOnPath(): boolean {
    return true;
  }
  exists(): boolean {
    return false;
  }
  readText(): string {
    throw new Error('not used');
  }
  writeText(): void {}
  mkdirp(): void {}
  rmrf(): void {}
}

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
const fail = (stderr = 'not found'): RunResult => ({ status: 1, stdout: '', stderr });

describe('checkPlaywright', () => {
  it('Playwright CLI is installed: pass with the detected version in the detail', () => {
    const deps = new FakeDeps((command, args) => {
      if (command === 'npx' && args.includes('playwright')) return ok('Version 1.47.2');
      return ok();
    });

    const check = checkPlaywright(deps);

    expect(check.id).toBe('playwright');
    expect(check.status).toBe('pass');
    expect(check.detail).toContain('1.47.2');
    // Probes via --no-install so a missing Playwright never triggers npx's implicit install.
    expect(deps.calls[0]).toEqual({
      command: 'npx',
      args: ['--no-install', 'playwright', '--version'],
    });
  });

  it('Playwright CLI is not installed: info status with an install remedy', () => {
    const deps = new FakeDeps(() => fail());

    const check = checkPlaywright(deps);

    expect(check.status).toBe('info');
    expect(check.remedy).toBeDefined();
    expect(check.remedy?.toLowerCase()).toContain('playwright');
  });

  it('a missing Playwright CLI never fails doctor: severity is optional and exit code unaffected', () => {
    const deps = new FakeDeps(() => fail());
    const check = checkPlaywright(deps);

    expect(check.severity).toBe('optional');

    const checks = [check];
    expect(isReportOk(checks)).toBe(true);
    expect(exitCodeFor({ checks, ok: isReportOk(checks) })).toBe(0);
  });

  it('JSON output includes the playwright check with the same shape as any other check', () => {
    const deps = new FakeDeps(() => fail());
    const playwright = checkPlaywright(deps);
    const docker = {
      id: 'docker',
      label: 'Docker daemon',
      status: 'info' as const,
      severity: 'optional' as const,
      detail: 'Docker daemon is not available.',
      remedy: 'Optional: install Docker.',
    };

    const parsed = JSON.parse(
      serializeReport({ checks: [docker, playwright], ok: true })
    );

    const entry = parsed.checks.find((c: { id: string }) => c.id === 'playwright');
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(Object.keys(parsed.checks[0]).sort());
  });
});
