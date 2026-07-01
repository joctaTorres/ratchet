/**
 * Unit tests for the hold-out tag resolver and content filter.
 *
 * Implements features/eval-holdout/holdout-tag-resolution.feature: a case
 * tagged `@holdout` resolves true; a case with no tags, or other tags but not
 * `@holdout`, resolves false; a case tagged both `@holdout` and `@skip`
 * resolves true for hold-out independent of skip status. Pure in-memory
 * inputs — no filesystem, no spawn.
 *
 * Also implements features/apply-holdout/apply-time-filter.feature's
 * text-filtering cases for `filterHoldoutContent`.
 */

import { describe, it, expect } from 'vitest';
import { resolveHoldout, HOLDOUT_TAG, filterHoldoutContent } from '../../../src/core/eval/holdout.js';
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

describe('filterHoldoutContent', () => {
  it('keeps the untagged Scenario and drops the @holdout one', () => {
    const content = [
      'Feature: Sample',
      '  @holdout',
      '  Scenario: Held out',
      '    Given a',
      '    Then b',
      '',
      '  Scenario: Kept',
      '    Given c',
      '    Then d',
      '',
    ].join('\n');

    const filtered = filterHoldoutContent(content);

    expect(filtered).toContain('Feature: Sample');
    expect(filtered).toContain('Scenario: Kept');
    expect(filtered).toContain('Given c');
    expect(filtered).not.toContain('Held out');
    expect(filtered).not.toContain('Given a');
  });

  it('returns content unchanged when no @holdout tags are present', () => {
    const content = [
      'Feature: Sample',
      '  Scenario: One',
      '    Given a',
      '    Then b',
      '',
      '  @smoke',
      '  Scenario: Two',
      '    Given c',
      '    Then d',
      '',
    ].join('\n');

    expect(filterHoldoutContent(content)).toBe(content);
  });

  it('returns just the Feature header/description when every Scenario is @holdout', () => {
    const content = [
      'Feature: Sample',
      '  A description line.',
      '',
      '  @holdout',
      '  Scenario: One',
      '    Given a',
      '    Then b',
      '',
      '  @holdout',
      '  Scenario: Two',
      '    Given c',
      '    Then d',
      '',
    ].join('\n');

    const filtered = filterHoldoutContent(content);

    expect(filtered).toContain('Feature: Sample');
    expect(filtered).toContain('A description line.');
    expect(filtered).not.toMatch(/Scenario:/);
  });

  it('removes a held-out Scenario Outline along with its Examples table', () => {
    const content = [
      'Feature: Sample',
      '  @holdout',
      '  Scenario Outline: Held out outline',
      '    Given a <value>',
      '    Then b',
      '',
      '    Examples:',
      '      | value |',
      '      | 1     |',
      '',
      '  Scenario: Kept',
      '    Given c',
      '    Then d',
      '',
    ].join('\n');

    const filtered = filterHoldoutContent(content);

    expect(filtered).not.toContain('Held out outline');
    expect(filtered).not.toContain('| value |');
    expect(filtered).not.toContain('| 1     |');
    expect(filtered).toContain('Scenario: Kept');
  });

  it('detects @holdout combined with another tag on the same line', () => {
    const content = [
      'Feature: Sample',
      '  @holdout @smoke',
      '  Scenario: Held out',
      '    Given a',
      '    Then b',
      '',
      '  Scenario: Kept',
      '    Given c',
      '    Then d',
      '',
    ].join('\n');

    const filtered = filterHoldoutContent(content);

    expect(filtered).not.toContain('Held out');
    expect(filtered).toContain('Scenario: Kept');
  });
});
