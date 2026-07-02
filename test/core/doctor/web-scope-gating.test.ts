/**
 * Implements features/doctor-playwright-probe/scope-gating.feature.
 *
 * `hasWebBindingInScope` and the conditional `runDoctorChecks` wiring read
 * real `.ratchet/evals/specs/*.yaml` through `loadEvalSpecs`, so this is an
 * integration test over a tmpdir fixture repo rather than a pure unit test.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hasWebBindingInScope } from '../../../src/core/doctor/web-scope.js';
import { runDoctorChecks } from '../../../src/core/doctor/index.js';
import type {
  BootstrapDeps,
  RunResult,
} from '../../../src/core/batch/engine/runtime/rex-bootstrap.js';

/** Minimal `BootstrapDeps` fake: every probe passes, so only scope gates the check. */
class FakeDeps implements BootstrapDeps {
  run(): RunResult {
    return { status: 0, stdout: '', stderr: '' };
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

function includesPlaywright(projectRoot: string): boolean {
  const report = runDoctorChecks(new FakeDeps(), projectRoot);
  return report.checks.some((c) => c.id === 'playwright');
}

describe('web binding scope gating', () => {
  const tempDirs: string[] = [];

  function makeProjectRoot(): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-web-scope-'));
    tempDirs.push(tempDir);
    return tempDir;
  }

  function writeSpec(projectRoot: string, fileName: string, contents: string): void {
    const specsDir = path.join(projectRoot, '.ratchet', 'evals', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, fileName), contents, 'utf-8');
  }

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('no web binding anywhere: only deterministic and llm-judge bindings -> absent', () => {
    const projectRoot = makeProjectRoot();
    writeSpec(
      projectRoot,
      'specs.yaml',
      [
        '"features/checkout#totals":',
        '  fixture: storefront-app',
        '  kind: deterministic',
        '  check:',
        '    run: "pnpm test totals"',
        '    pass: exit-zero',
        '"features/checkout#refund-copy":',
        '  fixture: storefront-app',
        '  kind: llm-judge',
        '  success: "Refund copy matches the Then-clauses."',
        '',
      ].join('\n')
    );

    expect(hasWebBindingInScope(projectRoot)).toBe(false);
    expect(includesPlaywright(projectRoot)).toBe(false);
  });

  it('a web binding is present among the resolved bindings -> included', () => {
    const projectRoot = makeProjectRoot();
    writeSpec(
      projectRoot,
      'specs.yaml',
      [
        '"features/checkout#add-to-cart":',
        '  fixture: storefront-app',
        '  kind: web',
        '  start: "pnpm dev"',
        '  readiness:',
        '    url: "http://localhost:3000"',
        '    timeoutMs: 15000',
        '  spec: e2e/add-to-cart.spec.ts',
        '',
      ].join('\n')
    );

    expect(hasWebBindingInScope(projectRoot)).toBe(true);
    expect(includesPlaywright(projectRoot)).toBe(true);
  });

  it('no .ratchet/evals/specs directory at all -> absent', () => {
    const projectRoot = makeProjectRoot();

    expect(hasWebBindingInScope(projectRoot)).toBe(false);
    expect(includesPlaywright(projectRoot)).toBe(false);
  });

  it('a spec file that fails to parse (no valid bindings resolve) -> absent', () => {
    const projectRoot = makeProjectRoot();
    writeSpec(projectRoot, 'broken.yaml', ':\n  - this is not valid yaml: [\n');

    expect(hasWebBindingInScope(projectRoot)).toBe(false);
    expect(includesPlaywright(projectRoot)).toBe(false);
  });
});
