/**
 * Unit tests for `executeRun`'s per-case record assembly.
 *
 * Implements the executeRun-facing scenarios of
 * features/eval-judge/structured-evidence-persistence.feature: a skipped
 * case's persisted record carries its skip source/detail, and a record with
 * no judging detail (unbound, or whose contributor is disabled) carries no
 * rubric/clauses/votes.
 *
 * Also implements the executeRun-facing scenarios of
 * features/eval-holdout/holdout-scope-filter.feature: `holdout: true`/`false`
 * restricts the persisted run's cases/verdicts to only the held-out or only
 * the non-held-out case(s), and a held-out, deterministic-bound case run
 * under `holdout: true` is judged and gated exactly like any other bound
 * case.
 *
 * Also implements the last two scenarios of
 * features/web-deterministic-fold/deterministic-contributor-fold.feature:
 * disabling the `deterministic` contributor leaves a `web`-bound case
 * unjudged without ever starting its app, and restricting the gate to
 * `deterministic` still judges a `web`-bound case while a sibling
 * `llm-judge`-bound case is recorded unjudged.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeRun } from '../../../src/core/eval/execute.js';
import { ALL_CONTRIBUTOR_IDS } from '../../../src/core/eval/gate.js';
import type { ContributorId } from '../../../src/core/eval/aggregate.js';
import type { ProcessHandle, ProcessStarter } from '../../../src/core/eval/web-lifecycle.js';

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

describe('executeRun: holdout scope filter', () => {
  const HELD_OUT_CASE = 'features/eval-holdout/sample#held-out-scenario';
  const KEPT_CASE = 'features/eval-holdout/sample#kept-scenario';

  function writeHoldoutFeature(root: string): void {
    writeFile(
      root,
      '.ratchet/features/eval-holdout/sample.feature',
      [
        'Feature: Sample',
        '  @holdout',
        '  Scenario: Held out scenario',
        '    Given a precondition',
        '    Then an outcome',
        '',
        '  Scenario: Kept scenario',
        '    Given a precondition',
        '    Then an outcome',
        '',
      ].join('\n')
    );
  }

  it('persists a run whose cases/verdicts include only the held-out case(s) when holdout is true', async () => {
    const root = makeProject();
    writeHoldoutFeature(root);
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate: ALL_GATE, holdout: true });
    expect(run.cases.map((c) => c.id)).toEqual([HELD_OUT_CASE]);
    expect(Object.keys(run.verdicts)).toEqual([HELD_OUT_CASE]);
  });

  it('persists a run whose cases/verdicts include only the non-held-out case(s) when holdout is false', async () => {
    const root = makeProject();
    writeHoldoutFeature(root);
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate: ALL_GATE, holdout: false });
    expect(run.cases.map((c) => c.id)).toEqual([KEPT_CASE]);
    expect(Object.keys(run.verdicts)).toEqual([KEPT_CASE]);
  });

  it('judges and gates a held-out, deterministic-bound case exactly like any other bound case', async () => {
    const root = makeProject();
    writeHoldoutFeature(root);
    writeFile(root, '.ratchet/evals/fixtures/status-ok/output.txt', 'applyRequires: plan\n');
    writeFile(
      root,
      '.ratchet/evals/specs/eval-holdout.yaml',
      `${HELD_OUT_CASE}:\n  fixture: status-ok\n  kind: deterministic\n  check:\n    run: cat output.txt\n    pass: "contains:applyRequires"\n`
    );
    const { run } = await executeRun(root, { scope: { kind: 'store' }, gate: ALL_GATE, holdout: true });
    const record = run.verdicts[HELD_OUT_CASE];
    expect(record.verdict).toBe('pass');
    expect(record.rubric).toEqual(['contains:applyRequires']);
    expect(record.clauses).toHaveLength(1);
    expect(record.votes).toEqual([{ pass: true, clauses: record.clauses }]);
  });
});

describe('executeRun: web-bound cases gate through the deterministic contributor', () => {
  const WEB_CASE = 'features/web/checkout#checkout-flow';
  const LLM_CASE = 'features/web/review#review-flow';

  function fakeStart(calls: Array<{ command: string; cwd: string }>): ProcessStarter {
    return (command, cwd) => {
      calls.push({ command, cwd });
      const handle: ProcessHandle = { pid: 1, kill() {} };
      return handle;
    };
  }

  function writeWebFixtures(root: string): void {
    writeFile(
      root,
      '.ratchet/features/web/checkout.feature',
      'Feature: Checkout\n  Scenario: Checkout flow\n    Given a cart\n    Then it checks out\n'
    );
    mkdirSync(path.join(root, '.ratchet/evals/fixtures/storefront-app'), { recursive: true });
    writeFile(
      root,
      '.ratchet/evals/specs/web.yaml',
      [
        `${WEB_CASE}:`,
        '  fixture: storefront-app',
        '  kind: web',
        '  start: pnpm dev',
        '  readiness:',
        '    url: http://localhost:3000',
        '    timeoutMs: 5000',
        '  spec: e2e/checkout.spec.ts',
        '',
      ].join('\n')
    );
  }

  it('leaves a web-bound case unjudged naming the disabled deterministic contributor, never starting its app', async () => {
    const root = makeProject();
    writeWebFixtures(root);
    const startCalls: Array<{ command: string; cwd: string }> = [];
    const gate = new Set<ContributorId>(ALL_CONTRIBUTOR_IDS.filter((id) => id !== 'deterministic'));
    const { run } = await executeRun(root, {
      scope: { kind: 'store' },
      gate,
      judge: { web: { start: fakeStart(startCalls), checkReadiness: async () => true } },
    });
    const record = run.verdicts[WEB_CASE];
    expect(record.verdict).toBe('unjudged');
    expect(record.reason).toContain("'deterministic'");
    expect(startCalls).toEqual([]);
  });

  it('still judges a web-bound case when the gate is restricted to deterministic, while a sibling llm-judge case is disabled', async () => {
    const root = makeProject();
    writeWebFixtures(root);
    writeFile(
      root,
      '.ratchet/features/web/review.feature',
      'Feature: Review\n  Scenario: Review flow\n    Given a review\n    Then it is submitted\n'
    );
    writeFile(
      root,
      '.ratchet/evals/specs/review.yaml',
      [`${LLM_CASE}:`, '  fixture: storefront-app', '  kind: llm-judge', '  success: it works', ''].join('\n')
    );
    const startCalls: Array<{ command: string; cwd: string }> = [];
    const gate = new Set<ContributorId>(['deterministic']);
    const { run } = await executeRun(root, {
      scope: { kind: 'store' },
      gate,
      judge: {
        web: {
          start: fakeStart(startCalls),
          checkReadiness: async () => true,
          bash: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        },
      },
    });
    expect(run.verdicts[WEB_CASE].verdict).toBe('pass');
    expect(startCalls).toHaveLength(1);
    expect(run.verdicts[LLM_CASE].verdict).toBe('unjudged');
    expect(run.verdicts[LLM_CASE].reason).toContain("'llm-judge'");
  });
});
