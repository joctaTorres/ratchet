/**
 * Unit tests for the hold-out tag resolver and scope filter.
 *
 * Implements features/eval-holdout/holdout-tag-resolution.feature: a case
 * tagged `@holdout` resolves true; a case with no tags, or other tags but not
 * `@holdout`, resolves false; a case tagged both `@holdout` and `@skip`
 * resolves true for hold-out independent of skip status. Pure in-memory
 * inputs — no filesystem, no spawn.
 *
 * Also implements features/eval-holdout/holdout-scope-filter.feature's
 * pure-filter cases for `filterCasesByHoldout`.
 *
 * The domain-neutral `filterHoldoutContent` transform relocated to the parser
 * layer; its text-filter and parser-lockstep tests live in
 * test/core/parsers/holdout-filter.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveHoldout,
  HOLDOUT_TAG,
  filterCasesByHoldout,
} from '../../../src/core/eval/holdout.js';
import { SKIP_TAG } from '../../../src/core/eval/skip.js';
import type { EvalCase } from '../../../src/core/eval/set.js';

function mkCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'features/cli/status#status-as-json',
    feature: 'F',
    scenario: 'S',
    source: 'features/cli/status.feature',
    steps: [{ keyword: 'Given', text: 'a' }, { keyword: 'Then', text: 'b' }],
    tags: [],
    ...overrides,
  };
}

describe('resolveHoldout', () => {
  it('resolves true when the case is tagged @holdout', () => {
    expect(resolveHoldout(mkCase({ tags: [HOLDOUT_TAG] }))).toBe(true);
  });

  it('resolves false when the case has no tags', () => {
    expect(resolveHoldout(mkCase())).toBe(false);
  });

  it('resolves false when the case has other tags but not @holdout', () => {
    expect(resolveHoldout(mkCase({ tags: ['@wip', '@smoke'] }))).toBe(false);
  });

  it('resolves true for hold-out independent of skip status when tagged both @holdout and @skip', () => {
    expect(resolveHoldout(mkCase({ tags: [HOLDOUT_TAG, SKIP_TAG] }))).toBe(true);
  });
});

describe('filterCasesByHoldout', () => {
  const held = mkCase({ id: 'features/cli/held#held', tags: [HOLDOUT_TAG] });
  const kept = mkCase({ id: 'features/cli/kept#kept', tags: [] });
  const cases = [held, kept];

  it('keeps only @holdout-tagged cases when holdout is true', () => {
    expect(filterCasesByHoldout(cases, true)).toEqual([held]);
  });

  it('keeps only untagged cases when holdout is false', () => {
    expect(filterCasesByHoldout(cases, false)).toEqual([kept]);
  });

  it('returns the input array unchanged, in order, when holdout is undefined', () => {
    expect(filterCasesByHoldout(cases, undefined)).toEqual(cases);
  });

  it('returns an empty array for empty input regardless of the flag', () => {
    expect(filterCasesByHoldout([], true)).toEqual([]);
    expect(filterCasesByHoldout([], false)).toEqual([]);
    expect(filterCasesByHoldout([], undefined)).toEqual([]);
  });
});
