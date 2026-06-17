import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { enumerateEvalSet } from '../../../src/core/eval/set.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-set-'));
  roots.push(root);
  return root;
}

function writeFeature(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const FEATURE = `Feature: Status
  Scenario: Status as JSON
    Given a project
    When I run status
    Then it prints JSON

  Scenario: Status as text
    Given a project
    Then it prints text
`;

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('enumerateEvalSet', () => {
  it('produces one case per scenario from the feature store', () => {
    const root = makeProject();
    writeFeature(root, '.ratchet/features/cli/status.feature', FEATURE);
    const cases = enumerateEvalSet(root, { kind: 'store' });
    expect(cases).toHaveLength(2);
    const ids = cases.map((c) => c.id);
    expect(ids).toContain('features/cli/status#status-as-json');
    expect(ids).toContain('features/cli/status#status-as-text');
  });

  it('carries feature, scenario, source and ordered steps', () => {
    const root = makeProject();
    writeFeature(root, '.ratchet/features/cli/status.feature', FEATURE);
    const cases = enumerateEvalSet(root, { kind: 'store' });
    const json = cases.find((c) => c.scenario === 'Status as JSON')!;
    expect(json.feature).toBe('Status');
    expect(json.source).toBe('features/cli/status.feature');
    expect(json.steps.map((s) => `${s.keyword} ${s.text}`)).toEqual([
      'Given a project',
      'When I run status',
      'Then it prints JSON',
    ]);
  });

  it('is stable across runs', () => {
    const root = makeProject();
    writeFeature(root, '.ratchet/features/cli/status.feature', FEATURE);
    const a = enumerateEvalSet(root, { kind: 'store' }).map((c) => c.id);
    const b = enumerateEvalSet(root, { kind: 'store' }).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('excludes the archive from the default scope', () => {
    const root = makeProject();
    writeFeature(root, '.ratchet/features/cli/status.feature', FEATURE);
    writeFeature(
      root,
      '.ratchet/changes/archive/old-change/features/old.feature',
      'Feature: Old\n  Scenario: Old one\n    Given x\n    Then y\n'
    );
    const cases = enumerateEvalSet(root, { kind: 'store' });
    expect(cases.every((c) => !c.source.includes('archive'))).toBe(true);
    expect(cases).toHaveLength(2);
  });

  it('includes active changes with --changes but never the archive', () => {
    const root = makeProject();
    writeFeature(root, '.ratchet/features/cli/status.feature', FEATURE);
    writeFeature(
      root,
      '.ratchet/changes/add-login/features/login.feature',
      'Feature: Login\n  Scenario: Logs in\n    Given a user\n    Then they log in\n'
    );
    writeFeature(
      root,
      '.ratchet/changes/archive/old/features/old.feature',
      'Feature: Old\n  Scenario: Old one\n    Given x\n    Then y\n'
    );
    const cases = enumerateEvalSet(root, { kind: 'changes' });
    const sources = cases.map((c) => c.source);
    expect(sources.some((s) => s.includes('add-login'))).toBe(true);
    expect(sources.some((s) => s.includes('archive'))).toBe(false);
    expect(sources.some((s) => s.includes('features/cli/status'))).toBe(true);
  });

  it('targets a single change by name', () => {
    const root = makeProject();
    writeFeature(root, '.ratchet/features/cli/status.feature', FEATURE);
    writeFeature(
      root,
      '.ratchet/changes/add-login/features/login.feature',
      'Feature: Login\n  Scenario: Logs in\n    Given a user\n    Then they log in\n'
    );
    writeFeature(
      root,
      '.ratchet/changes/add-export/features/export.feature',
      'Feature: Export\n  Scenario: Exports\n    Given data\n    Then a file\n'
    );
    const cases = enumerateEvalSet(root, { kind: 'change', target: 'add-login' });
    expect(cases).toHaveLength(1);
    expect(cases[0].source).toContain('add-login');
  });

  it('narrows to a capability directory with --path', () => {
    const root = makeProject();
    writeFeature(
      root,
      '.ratchet/features/validation/v.feature',
      'Feature: V\n  Scenario: Validates\n    Given x\n    Then y\n'
    );
    writeFeature(
      root,
      '.ratchet/features/standards/s.feature',
      'Feature: S\n  Scenario: Standardizes\n    Given x\n    Then y\n'
    );
    const cases = enumerateEvalSet(root, { kind: 'path', target: 'validation' });
    expect(cases).toHaveLength(1);
    expect(cases[0].source).toContain('features/validation');
  });
});
