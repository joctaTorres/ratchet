/**
 * Integration tests for the `ratchet eval` shared helpers.
 *
 * Implements features/eval-command-tests/shared.feature: `resolveScope`
 * (store default, --change, --path, --changes, and the mutually-exclusive
 * error) and `resolveJudgeMode` (explicit valid flag wins, invalid flag
 * rejected, the `eval.judge` config default over a fixture config, and the
 * `auto` fallback). The helpers are exercised directly — no command
 * entrypoint — with judge-default cases reading a real `config.yaml` from an
 * isolated tmpdir fixture removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveScope, resolveJudgeMode } from '../../../src/commands/eval/shared.js';
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

describe('resolveJudgeMode', () => {
  let fixture: EvalFixture;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it('uses an explicit valid --judge flag without reading project config', () => {
    // No config.yaml is written, so a config read would surface as `auto`;
    // the explicit flag must win regardless.
    expect(resolveJudgeMode(fixture.root, 'deterministic')).toBe('deterministic');
  });

  it('rejects an invalid --judge flag listing the valid modes', () => {
    expect(() => resolveJudgeMode(fixture.root, 'nonsense')).toThrow(
      /auto \| deterministic \| llm-judge/
    );
  });

  it('uses the configured eval.judge default when no flag is given', async () => {
    await fixture.writeConfig('schema: ratchet\neval:\n  judge: llm-judge\n');
    expect(resolveJudgeMode(fixture.root, undefined)).toBe('llm-judge');
  });

  it('falls back to auto when unflagged and the config does not set eval.judge', async () => {
    await fixture.writeConfig('schema: ratchet\n');
    expect(resolveJudgeMode(fixture.root, undefined)).toBe('auto');
  });
});
