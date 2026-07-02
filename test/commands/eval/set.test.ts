/**
 * Integration tests for the `ratchet eval set` verb.
 *
 * Implements features/eval-command-tests/set.feature: enumerating the store
 * cases as JSON (scope, count, and each case's id/feature/scenario/source/
 * steps/binding), as text (bound tag vs `[unbound]`, with feature › scenario),
 * and the mutually-exclusive scope error rejected before enumeration. The verb
 * is pointed at an isolated tmpdir fixture by mocking
 * `resolveCurrentPlanningHomeSync`; `console.log` is spied and restored, and
 * the fixture is removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeEvalFixture,
  TWO_CASE_FEATURE,
  DETERMINISTIC_SPEC,
  FOUR_CASE_FEATURE,
  ALL_BINDINGS_SPEC,
  CASE_JSON,
  CASE_TEXT,
  CASE_LLM,
  CASE_WEB,
  type EvalFixture,
} from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalSetCommand } from '../../../src/commands/eval/set.js';

describe('evalSetCommand', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.writeFeature('cli/status.feature', TWO_CASE_FEATURE);
    await fixture.writeSpec('cli.yaml', DETERMINISTIC_SPEC);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('reports the scope, count, and per-case fields as JSON', async () => {
    await evalSetCommand({ json: true });
    const parsed = JSON.parse(output());

    expect(parsed.scope).toEqual({ kind: 'store' });
    expect(parsed.count).toBe(2);

    const byId = Object.fromEntries(parsed.cases.map((c: any) => [c.id, c]));
    const bound = byId[CASE_JSON];
    expect(bound.feature).toBe('Status');
    expect(bound.scenario).toBe('Status as JSON');
    expect(bound.source).toBe('features/cli/status.feature');
    expect(bound.binding).toBe('deterministic');
    expect(bound.steps).toEqual([
      { keyword: 'Given', text: 'a project' },
      { keyword: 'When', text: 'I run status' },
      { keyword: 'Then', text: 'it prints JSON' },
    ]);

    expect(byId[CASE_TEXT].binding).toBe('unbound');
  });

  it('tags the bound case with its binding kind and the unbound case as [unbound]', async () => {
    await evalSetCommand({});
    const text = output();

    expect(text).toContain('Eval set (store): 2 case(s)');
    expect(text).toContain(`[deterministic] ${CASE_JSON}`);
    expect(text).toContain(`[unbound] ${CASE_TEXT}`);
    expect(text).not.toContain('[check]');
    expect(text).not.toContain('[agent]');
    expect(text).toContain('Status › Status as JSON');
    expect(text).toContain('Status › Status as text');
  });

  // features/eval-web-binding/web-binding-schema.feature: eval set reports
  // web-bound cases with the new kind label
  it('tags a deterministic, llm-judge, web, and unbound case with their kind labels', async () => {
    await fixture.writeFeature('cli/status.feature', FOUR_CASE_FEATURE);
    await fixture.writeSpec('cli.yaml', ALL_BINDINGS_SPEC);

    await evalSetCommand({ json: true });
    const parsed = JSON.parse(output());
    const byId = Object.fromEntries(parsed.cases.map((c: any) => [c.id, c]));
    expect(byId[CASE_JSON].binding).toBe('deterministic');
    expect(byId[CASE_LLM].binding).toBe('llm-judge');
    expect(byId[CASE_WEB].binding).toBe('web');
    expect(byId[CASE_TEXT].binding).toBe('unbound');

    logSpy.mockClear();
    await evalSetCommand({});
    const text = output();
    expect(text).toContain(`[deterministic] ${CASE_JSON}`);
    expect(text).toContain(`[llm-judge] ${CASE_LLM}`);
    expect(text).toContain(`[web] ${CASE_WEB}`);
    expect(text).toContain(`[unbound] ${CASE_TEXT}`);
  });

  it('rejects combining scope flags before enumerating anything', async () => {
    await expect(evalSetCommand({ changes: true, change: 'x' })).rejects.toThrow(
      /at most one of --changes, --change .*, or --path/
    );
    expect(output()).toBe('');
  });
});
