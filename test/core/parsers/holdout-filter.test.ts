/**
 * Unit tests for the domain-neutral hold-out content filter.
 *
 * Implements features/apply-holdout/apply-time-filter.feature's text-filtering
 * cases for `filterHoldoutContent`: an `@holdout`-tagged Scenario (including a
 * Scenario Outline plus its Examples table) is stripped from raw `.feature`
 * text, everything else is left byte-for-byte, docstring content is opaque, and
 * `@holdout` combined with other tags on one line is still detected.
 *
 * The final `describe` is the lockstep cross-fixture guard: `filterHoldoutContent`
 * re-implements the gherkin parser's tag accumulate/reset rules on raw lines, so
 * it feeds one `.feature` through both the filter and `parseFeatureFile` and
 * asserts they agree on which scenarios are `@holdout` — catching silent drift if
 * a future parser change is not mirrored into the filter (or vice versa). It sits
 * beside the relocated filter it guards.
 */

import { describe, it, expect } from 'vitest';
import { filterHoldoutContent, HOLDOUT_TAG } from '../../../src/core/parsers/holdout-filter.js';
import { parseFeatureFile } from '../../../src/core/parsers/gherkin-parser.js';

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

    const result = filterHoldoutContent(content);

    expect(result.content).toContain('Feature: Sample');
    expect(result.content).toContain('Scenario: Kept');
    expect(result.content).toContain('Given c');
    expect(result.content).not.toContain('Held out');
    expect(result.content).not.toContain('Given a');
    expect(result.heldOutCount).toBe(1);
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

    const result = filterHoldoutContent(content);
    expect(result.content).toBe(content);
    expect(result.heldOutCount).toBe(0);
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

    const result = filterHoldoutContent(content);

    expect(result.content).toContain('Feature: Sample');
    expect(result.content).toContain('A description line.');
    expect(result.content).not.toMatch(/Scenario:/);
    expect(result.heldOutCount).toBe(2);
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

    const result = filterHoldoutContent(content);

    expect(result.content).not.toContain('Held out outline');
    expect(result.content).not.toContain('| value |');
    expect(result.content).not.toContain('| 1     |');
    expect(result.content).toContain('Scenario: Kept');
    // A Scenario Outline counts as one held-out block, not two (Outline + Examples)
    expect(result.heldOutCount).toBe(1);
  });

  it('treats docstring content as opaque, not as tags or Scenario headers', () => {
    const content = [
      'Feature: Sample',
      '  Scenario: Kept',
      '    Given a request body:',
      '      """',
      '      @holdout',
      '      Scenario: not a real scenario',
      '      """',
      '    Then b',
      '',
      '  @holdout',
      '  Scenario: Held',
      '    Given c',
      '    Then d',
      '',
    ].join('\n');

    const result = filterHoldoutContent(content);

    // The @holdout / Scenario: lines inside the docstring are inert; only the
    // genuinely tagged Scenario is dropped.
    expect(result.content).toContain('Scenario: Kept');
    expect(result.content).toContain('not a real scenario');
    expect(result.content).not.toContain('Scenario: Held');
    expect(result.content).not.toContain('Given c');
    expect(result.heldOutCount).toBe(1);
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

    const result = filterHoldoutContent(content);

    expect(result.content).not.toContain('Held out');
    expect(result.content).toContain('Scenario: Kept');
    expect(result.heldOutCount).toBe(1);
  });

  it('counts zero held-out blocks when there are no @holdout tags', () => {
    const content = [
      'Feature: Clean',
      '  Scenario: Alpha',
      '    Given x',
      '    Then y',
      '',
    ].join('\n');

    const result = filterHoldoutContent(content);
    expect(result.heldOutCount).toBe(0);
    expect(result.content).toBe(content);
  });

  it('counts each held-out Scenario Outline with Examples table as one block, not two', () => {
    const content = [
      'Feature: Outline Test',
      '  @holdout',
      '  Scenario Outline: Held outline',
      '    Given <x>',
      '    Then <y>',
      '',
      '    Examples:',
      '      | x | y |',
      '      | 1 | 2 |',
      '      | 3 | 4 |',
      '',
      '  Scenario: Kept',
      '    Given a',
      '    Then b',
      '',
    ].join('\n');

    const result = filterHoldoutContent(content);
    expect(result.heldOutCount).toBe(1);
    expect(result.content).toContain('Scenario: Kept');
    expect(result.content).not.toContain('Held outline');
  });
});

// `filterHoldoutContent` re-implements the gherkin parser's tag
// accumulate/reset rules on raw lines. Nothing at the type level keeps the two
// in lockstep, so this cross-fixture test feeds one `.feature` through both and
// asserts they agree on which scenarios are @holdout — catching silent drift if
// a future parser change is not mirrored into the filter (or vice versa).
describe('filterHoldoutContent / parser tag agreement', () => {
  const FIXTURE = [
    '@featureLevel',
    'Feature: Mixed',
    '  A description.',
    '',
    '  Background:',
    '    Given the app is running',
    '',
    '  @holdout',
    '  Scenario: HeldPlain',
    '    Given a',
    '    Then b',
    '',
    '  @smoke',
    '  Scenario: KeptTagged',
    '    Given c',
    '    Then d',
    '',
    '  @holdout @smoke',
    '  Scenario Outline: HeldOutline',
    '    Given e <v>',
    '    Then f',
    '    @holdout',
    '    Examples:',
    '      | v |',
    '      | 1 |',
    '',
    '  Scenario: KeptAfterExamples',
    '    Given g',
    '    Then h',
    '',
  ].join('\n');

  it('agrees on which scenarios are @holdout', () => {
    const feature = parseFeatureFile(FIXTURE);
    const parserHeldout = new Set(
      feature.scenarios.filter((s) => s.tags.includes(HOLDOUT_TAG)).map((s) => s.name)
    );

    const result = filterHoldoutContent(FIXTURE);
    const keptByFilter = new Set(
      parseFeatureFile(result.content).scenarios.map((s) => s.name)
    );

    for (const s of feature.scenarios) {
      const heldByParser = parserHeldout.has(s.name);
      // A scenario is dropped by the filter exactly when the parser tags it
      // @holdout; kept exactly when it does not.
      expect(keptByFilter.has(s.name)).toBe(!heldByParser);
    }

    // Sanity: the fixture actually exercises both branches.
    expect(parserHeldout).toEqual(new Set(['HeldPlain', 'HeldOutline']));
    expect(keptByFilter).toEqual(new Set(['KeptTagged', 'KeptAfterExamples']));
    // Two held-out blocks (one plain Scenario, one Scenario Outline)
    expect(result.heldOutCount).toBe(2);
  });
});
