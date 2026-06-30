/**
 * Unit tests for `executeRun`'s per-case record assembly.
 *
 * Implements the executeRun-facing scenarios of
 * features/eval-judge/structured-evidence-persistence.feature: a skipped
 * case's persisted record carries its skip source/detail, and a record with
 * no judging detail (unbound, or whose contributor is disabled) carries no
 * rubric/clauses/votes.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeRun } from '../../../src/core/eval/execute.js';
import { ALL_CONTRIBUTOR_IDS } from '../../../src/core/eval/gate.js';
import type { ContributorId } from '../../../src/core/eval/aggregate.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-execute-'));
  roots.push(root);
  return root;
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const ALL_GATE = new Set<ContributorId>(ALL_CONTRIBUTOR_IDS);

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('executeRun: skip filters persist structured skip detail', () => {
  it('records an @skip-tagged case with skip.source "tag" and the source file as detail', async () => {
    const root = makeProject();
    writeFile(
      root,
      '.ratchet/features/skip/s.feature',
      'Feature: Skip\n  @skip\n  Scenario: Tag skipped\n    Given a\n    Then b\n'
    );
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate: ALL_GATE });
    const record = run.verdicts['features/skip/s#tag-skipped'];
    expect(record.verdict).toBe('skipped');
    expect(record.skip).toEqual({ source: 'tag', detail: 'features/skip/s.feature' });
  });

  it('records a case skipped by an eval.skip config pattern with skip.source "config" and the matched pattern as detail', async () => {
    const root = makeProject();
    writeFile(
      root,
      '.ratchet/features/cli/status.feature',
      'Feature: Status\n  Scenario: Status as JSON\n    Given a\n    Then b\n'
    );
    const { run } = await executeRun(root, {
      scope: { kind: 'store' },
      gate: ALL_GATE,
      skip: ['features/cli/status#status-as-json'],
    });
    const record = run.verdicts['features/cli/status#status-as-json'];
    expect(record.verdict).toBe('skipped');
    expect(record.skip).toEqual({ source: 'config', detail: 'features/cli/status#status-as-json' });
  });
});

describe('executeRun: absence of judging detail where there is none', () => {
  it('persists no rubric, clauses, or votes for an unbound case', async () => {
    const root = makeProject();
    writeFile(
      root,
      '.ratchet/features/cli/status.feature',
      'Feature: Status\n  Scenario: Status as JSON\n    Given a\n    Then b\n'
    );
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate: ALL_GATE });
    const record = run.verdicts['features/cli/status#status-as-json'];
    expect(record.verdict).toBe('unjudged');
    expect(record.rubric).toBeUndefined();
    expect(record.clauses).toBeUndefined();
    expect(record.votes).toBeUndefined();
  });

  it('persists no rubric, clauses, or votes for a case whose binding-kind contributor is disabled', async () => {
    const root = makeProject();
    writeFile(
      root,
      '.ratchet/features/cli/status.feature',
      'Feature: Status\n  Scenario: Status as JSON\n    Given a\n    Then b\n'
    );
    writeFile(root, '.ratchet/evals/fixtures/status-ok/output.txt', 'applyRequires: plan\n');
    writeFile(
      root,
      '.ratchet/evals/specs/cli.yaml',
      'features/cli/status#status-as-json:\n  fixture: status-ok\n  kind: deterministic\n  check:\n    run: cat output.txt\n    pass: "contains:applyRequires"\n'
    );
    const gate = new Set<ContributorId>(ALL_CONTRIBUTOR_IDS.filter((id) => id !== 'deterministic'));
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate });
    const record = run.verdicts['features/cli/status#status-as-json'];
    expect(record.verdict).toBe('unjudged');
    expect(record.rubric).toBeUndefined();
    expect(record.clauses).toBeUndefined();
    expect(record.votes).toBeUndefined();
  });

  it('persists the resolved rubric, clauses, and votes for a judged, enabled case', async () => {
    const root = makeProject();
    writeFile(
      root,
      '.ratchet/features/cli/status.feature',
      'Feature: Status\n  Scenario: Status as JSON\n    Given a\n    Then b\n'
    );
    writeFile(root, '.ratchet/evals/fixtures/status-ok/output.txt', 'applyRequires: plan\n');
    writeFile(
      root,
      '.ratchet/evals/specs/cli.yaml',
      'features/cli/status#status-as-json:\n  fixture: status-ok\n  kind: deterministic\n  check:\n    run: cat output.txt\n    pass: "contains:applyRequires"\n'
    );
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate: ALL_GATE });
    const record = run.verdicts['features/cli/status#status-as-json'];
    expect(record.verdict).toBe('pass');
    expect(record.rubric).toEqual(['contains:applyRequires']);
    expect(record.clauses).toHaveLength(1);
    expect(record.votes).toEqual([{ pass: true, clauses: record.clauses }]);
  });
});
