import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  runVersionGuard,
  writeShouldPublishOutput,
} from '../../src/core/ci/version-guard.js';
import { PUBLISH, SKIP } from '../../src/core/ci/version-decision.js';

/**
 * The version-guard runner is the thin bridge between the workflow's environment
 * and the pure version-decision module. These tests feed it an environment and
 * assert its decision, the (always-zero) exit code, and the `should_publish`
 * step output — no Actions runner or child process needed. The PUBLISH/SKIP rule
 * itself is proven in version-decision.test.ts; here we prove the runner reads
 * its inputs, reports the verdict, and — crucially — exits 0 on BOTH outcomes so
 * an already-published version is a green, idempotent no-op.
 */

/**
 * Build the runner environment: the local version (via the `PACKAGE_VERSION`
 * override so tests never touch the manifest) and the comma-separated
 * already-published set.
 */
function env(vars: { version?: string; published?: string }): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  if (vars.version !== undefined) e.PACKAGE_VERSION = vars.version;
  if (vars.published !== undefined) e.PUBLISHED_VERSIONS = vars.published;
  return e;
}

describe('runVersionGuard', () => {
  it('PUBLISHes and exits zero for a version absent from the published set', () => {
    const result = runVersionGuard(env({ version: '1.2.0', published: '1.0.0,1.1.0' }));

    expect(result.decision.shouldPublish).toBe(true);
    expect(result.decision.outcome).toBe(PUBLISH);
    expect(result.should_publish).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain(PUBLISH);
  });

  it('SKIPs and STILL exits zero for an already-published version (idempotent no-op)', () => {
    const result = runVersionGuard(env({ version: '1.1.0', published: '1.0.0,1.1.0,1.2.0' }));

    expect(result.decision.shouldPublish).toBe(false);
    expect(result.decision.outcome).toBe(SKIP);
    expect(result.should_publish).toBe(false);
    // The crux of idempotency: a SKIP is success, not failure.
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain(SKIP);
  });

  it('PUBLISHes against an absent/empty PUBLISHED_VERSIONS (nothing shipped yet)', () => {
    const result = runVersionGuard(env({ version: '0.1.0' }));

    expect(result.should_publish).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});

/**
 * The runner's direct-run path lifts the verdict into a GitHub Actions step
 * output by appending `should_publish=true|false` to the file named by
 * `GITHUB_OUTPUT`. Only this impure writer touches the file, so it is exercised
 * directly against a scratch file. This is the signal the publish step is
 * conditioned on (`steps.<guard>.outputs.should_publish == 'true'`).
 */
describe('should_publish step output (GITHUB_OUTPUT)', () => {
  let dir: string;
  let outFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'version-guard-output-'));
    outFile = path.join(dir, 'github_output');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes should_publish=true for a new version', () => {
    const result = runVersionGuard(env({ version: '1.2.0', published: '1.0.0,1.1.0' }));
    writeShouldPublishOutput({ GITHUB_OUTPUT: outFile }, result.should_publish);

    expect(readFileSync(outFile, 'utf8')).toContain('should_publish=true');
  });

  it('writes should_publish=false for an already-published version', () => {
    const result = runVersionGuard(env({ version: '1.1.0', published: '1.0.0,1.1.0' }));
    writeShouldPublishOutput({ GITHUB_OUTPUT: outFile }, result.should_publish);

    expect(readFileSync(outFile, 'utf8')).toContain('should_publish=false');
  });

  it('is a no-op when GITHUB_OUTPUT is unset (keeps the local/pure path clean)', () => {
    expect(() => writeShouldPublishOutput({}, true)).not.toThrow();
  });
});
