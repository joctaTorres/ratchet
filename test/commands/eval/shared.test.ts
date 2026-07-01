/**
 * Integration tests for the `ratchet eval` shared helpers.
 *
 * Implements features/eval-command-tests/shared.feature and
 * features/eval-contributor-gate/gate-selection.feature: `resolveScope` (store
 * default, --change, --path, --changes, and the mutually-exclusive error) and
 * `resolveContributorGate` (all-enabled default, the `eval.gate` config default
 * over a fixture config, a CLI flag overriding that config, and unknown-id
 * rejection). The helpers are exercised directly — no command entrypoint — with
 * gate cases reading a real `config.yaml` from an isolated tmpdir fixture
 * removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveScope, resolveContributorGate } from '../../../src/commands/eval/shared.js';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

describe('resolveScope', () => {
  it('defaults to the permanent feature store when no flags are set', () => {
    expect(resolveScope({})).toEqual({ kind: 'store' });
  });

  it('selects a single change scope from --change', () => {
    expect(resolveScope({ change: 'my-change' })).toEqual({
      kind: 'change',
      target: 'my-change',
    });
  });

  it('selects a path scope from --path', () => {
    expect(resolveScope({ path: 'some/dir' })).toEqual({
      kind: 'path',
      target: 'some/dir',
    });
  });

  it('selects the all-changes scope from --changes', () => {
    expect(resolveScope({ changes: true })).toEqual({ kind: 'changes' });
  });

  it('rejects combining more than one scope flag', () => {
    expect(() => resolveScope({ changes: true, change: 'x' })).toThrow(
      /at most one of --changes, --change .*, or --path/
    );
    expect(() => resolveScope({ change: 'x', path: 'y' })).toThrow(/at most one/);
  });
});

describe('resolveContributorGate', () => {
  let fixture: EvalFixture;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it('enables every contributor when neither config nor flags select a gate', async () => {
    await fixture.writeConfig('schema: ratchet\n');
    const gate = resolveContributorGate(fixture.root, {});
    expect([...gate]).toEqual(['deterministic', 'llm-judge', 'invariants', 'regression']);
  });

  it('disables a contributor from the eval.gate config default', async () => {
    await fixture.writeConfig('schema: ratchet\neval:\n  gate:\n    llm-judge: false\n');
    const gate = resolveContributorGate(fixture.root, {});
    expect(gate.has('llm-judge')).toBe(false);
    expect(gate.has('deterministic')).toBe(true);
  });

  it('lets a CLI flag override the config default', async () => {
    // Config leaves every contributor enabled; --no-llm-judge wins for the run.
    await fixture.writeConfig('schema: ratchet\n');
    const gate = resolveContributorGate(fixture.root, { llmJudge: false });
    expect(gate.has('llm-judge')).toBe(false);
  });

  it('disables invariants from the eval.gate config default', async () => {
    await fixture.writeConfig('schema: ratchet\neval:\n  gate:\n    invariants: false\n');
    const gate = resolveContributorGate(fixture.root, {});
    expect(gate.has('invariants')).toBe(false);
    expect(gate.has('deterministic')).toBe(true);
  });

  it('lets --no-invariants override the config default', async () => {
    await fixture.writeConfig('schema: ratchet\n');
    const gate = resolveContributorGate(fixture.root, { invariants: false });
    expect(gate.has('invariants')).toBe(false);
  });

  it('rejects an unknown --only id listing the valid ids', async () => {
    await fixture.writeConfig('schema: ratchet\n');
    expect(() => resolveContributorGate(fixture.root, { only: 'not-a-contributor' })).toThrow(
      /Unknown contributor id 'not-a-contributor'.*deterministic, llm-judge, invariants, regression/
    );
  });
});
