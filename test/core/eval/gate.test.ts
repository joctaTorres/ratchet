/**
 * Unit tests for the contributor-gate resolver.
 *
 * Implements features/eval-contributor-gate/gate-selection.feature: every
 * contributor enabled by default, `eval.gate` config disabling a contributor,
 * each CLI override (`--gate`, `--only`, `--no-llm-judge`), the legacy `--judge`
 * mapping, CLI-over-config precedence, and unknown-id rejection with the valid
 * ids listed. Pure in-memory inputs — no filesystem, no spawn.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveGate,
  ALL_CONTRIBUTOR_IDS,
  type GateConfig,
  type GateFlags,
} from '../../../src/core/eval/gate.js';
import type { ContributorId } from '../../../src/core/eval/aggregate.js';

function enabled(config?: GateConfig, flags?: GateFlags): ContributorId[] {
  return [...resolveGate({ config, flags })];
}

describe('resolveGate', () => {
  it('enables every built-in contributor by default', () => {
    // No config, no flags ⇒ all enabled.
    expect(enabled()).toEqual(ALL_CONTRIBUTOR_IDS);
    // The id vocabulary is ecosystem-neutral: tiers, never tools.
    expect(ALL_CONTRIBUTOR_IDS).toEqual([
      'deterministic',
      'llm-judge',
      'invariants',
      'regression',
    ]);
  });

  it('disables a contributor through eval.gate config', () => {
    const set = resolveGate({ config: { 'llm-judge': false } });
    expect(set.has('llm-judge')).toBe(false);
    expect(set.has('deterministic')).toBe(true);
    expect(set.has('invariants')).toBe(true);
    expect(set.has('regression')).toBe(true);
  });

  it('treats an explicit true in eval.gate as enabled', () => {
    expect(resolveGate({ config: { deterministic: true } }).has('deterministic')).toBe(true);
  });

  it('disables llm-judge from --no-llm-judge (llmJudge=false)', () => {
    const set = resolveGate({ flags: { llmJudge: false } });
    expect(set.has('llm-judge')).toBe(false);
    expect(set.has('deterministic')).toBe(true);
  });

  it('leaves llm-judge enabled when the --no-llm-judge flag is absent (llmJudge=true)', () => {
    expect(resolveGate({ flags: { llmJudge: true } }).has('llm-judge')).toBe(true);
  });

  it('restricts the set to the listed ids with --only', () => {
    expect(enabled(undefined, { only: 'deterministic' })).toEqual(['deterministic']);
    expect(enabled(undefined, { only: 'deterministic,regression' })).toEqual([
      'deterministic',
      'regression',
    ]);
  });

  it('sets the enabled set outright with --gate', () => {
    expect(enabled(undefined, { gate: 'deterministic,regression' })).toEqual([
      'deterministic',
      'regression',
    ]);
  });

  it('maps the legacy --judge flag onto contributor selection', () => {
    // deterministic ⇒ llm-judge off; llm-judge ⇒ deterministic off; auto ⇒ both on.
    expect(resolveGate({ flags: { judge: 'deterministic' } }).has('llm-judge')).toBe(false);
    expect(resolveGate({ flags: { judge: 'deterministic' } }).has('deterministic')).toBe(true);
    expect(resolveGate({ flags: { judge: 'llm-judge' } }).has('deterministic')).toBe(false);
    expect(resolveGate({ flags: { judge: 'llm-judge' } }).has('llm-judge')).toBe(true);
    const auto = resolveGate({ config: { 'llm-judge': false }, flags: { judge: 'auto' } });
    expect(auto.has('llm-judge')).toBe(true);
    expect(auto.has('deterministic')).toBe(true);
  });

  it('lets a CLI flag override the config default (CLI precedence)', () => {
    // Config leaves llm-judge on; --no-llm-judge wins.
    expect(resolveGate({ config: { 'llm-judge': true }, flags: { llmJudge: false } }).has('llm-judge')).toBe(
      false
    );
    // Config disables deterministic; --gate re-includes it explicitly.
    expect(
      resolveGate({ config: { deterministic: false }, flags: { gate: 'deterministic' } }).has(
        'deterministic'
      )
    ).toBe(true);
  });

  it('rejects an unknown id in --only with the valid ids listed', () => {
    expect(() => resolveGate({ flags: { only: 'not-a-contributor' } })).toThrow(
      /Unknown contributor id 'not-a-contributor'/
    );
    expect(() => resolveGate({ flags: { only: 'not-a-contributor' } })).toThrow(
      /deterministic, llm-judge, invariants, regression/
    );
  });

  it('rejects an unknown id in --gate with the valid ids listed', () => {
    expect(() => resolveGate({ flags: { gate: 'bogus' } })).toThrow(/Unknown contributor id 'bogus'/);
  });

  it('rejects an invalid legacy --judge mode', () => {
    expect(() => resolveGate({ flags: { judge: 'nonsense' } })).toThrow(
      /Invalid --judge.*auto \| deterministic \| llm-judge/
    );
  });
});
