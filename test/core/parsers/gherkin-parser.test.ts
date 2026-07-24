import { describe, it, expect } from 'vitest';
import {
  GherkinParser,
  parseFeatureFile,
} from '../../../src/core/parsers/gherkin-parser.js';

describe('GherkinParser', () => {
  describe('Feature parsing', () => {
    it('parses the Feature name', () => {
      const feature = parseFeatureFile('Feature: User login\n');
      expect(feature.name).toBe('User login');
    });

    it('captures the free-form description after the Feature line', () => {
      const feature = parseFeatureFile(
        `Feature: Login
  As a user
  I want to sign in
  So that I can access my account

  Scenario: ok
    Given a user
    When they log in
    Then they see home
`
      );
      expect(feature.description).toBe(
        'As a user\nI want to sign in\nSo that I can access my account'
      );
    });

    it('is case-insensitive on the Feature keyword', () => {
      const feature = parseFeatureFile('feature: lowercase\n');
      expect(feature.name).toBe('lowercase');
    });

    it('returns an empty name when no Feature header is present', () => {
      const feature = parseFeatureFile('Scenario: orphan\n  Given x\n');
      expect(feature.name).toBe('');
    });
  });

  describe('Scenario parsing', () => {
    it('parses multiple scenarios', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario: first
    Given a
    When b
    Then c

  Scenario: second
    Given d
    When e
    Then f
`
      );
      expect(feature.scenarios).toHaveLength(2);
      expect(feature.scenarios.map(s => s.name)).toEqual(['first', 'second']);
    });

    it('marks Scenario Outline with isOutline=true', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario Outline: templated
    Given <a>
    When act
    Then <b>
    Examples:
      | a | b |
      | 1 | 2 |
`
      );
      expect(feature.scenarios).toHaveLength(1);
      expect(feature.scenarios[0].isOutline).toBe(true);
    });

    it('treats a plain Scenario as not an outline', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario: plain
    Given a
    When b
    Then c
`
      );
      expect(feature.scenarios[0].isOutline).toBe(false);
    });
  });

  describe('Step parsing', () => {
    it('parses Given/When/Then keywords and text', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario: s
    Given a precondition
    When an action
    Then an outcome
`
      );
      expect(feature.scenarios[0].steps).toEqual([
        { keyword: 'Given', text: 'a precondition' },
        { keyword: 'When', text: 'an action' },
        { keyword: 'Then', text: 'an outcome' },
      ]);
    });

    it('preserves And/But continuation steps verbatim', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario: s
    Given a
    And another given
    When b
    Then c
    But not d
`
      );
      const keywords = feature.scenarios[0].steps.map(s => s.keyword);
      expect(keywords).toEqual(['Given', 'And', 'When', 'Then', 'But']);
    });
  });

  // features/eval-judge/skip-filters.feature — tag capture is general (not
  // skip-specific); `@skip` is just one consumer of `FeatureScenario.tags`.
  describe('Tag parsing', () => {
    it('attaches a single tag to the Scenario it precedes', () => {
      const feature = parseFeatureFile(
        `Feature: F
  @skip
  Scenario: s
    Given a
    Then b
`
      );
      expect(feature.scenarios[0].tags).toEqual(['@skip']);
    });

    it('defaults to an empty array when no tags precede the Scenario', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario: s
    Given a
    Then b
`
      );
      expect(feature.scenarios[0].tags).toEqual([]);
    });

    it('captures multiple tags on one line', () => {
      const feature = parseFeatureFile(
        `Feature: F
  @wip @skip
  Scenario: s
    Given a
    Then b
`
      );
      expect(feature.scenarios[0].tags).toEqual(['@wip', '@skip']);
    });

    it('captures multiple tags across separate lines', () => {
      const feature = parseFeatureFile(
        `Feature: F
  @wip
  @skip
  Scenario: s
    Given a
    Then b
`
      );
      expect(feature.scenarios[0].tags).toEqual(['@wip', '@skip']);
    });

    it('resets the tag buffer between scenarios', () => {
      const feature = parseFeatureFile(
        `Feature: F
  @skip
  Scenario: first
    Given a
    Then b

  Scenario: second
    Given a
    Then b
`
      );
      expect(feature.scenarios[0].tags).toEqual(['@skip']);
      expect(feature.scenarios[1].tags).toEqual([]);
    });

    it('does not leak a tag on an Examples block onto a following Scenario', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario Outline: outline
    Given <a>
    Then <b>
    @holdout
    Examples:
      | a | b |
      | 1 | 2 |

  Scenario: next
    Given a
    Then b
`
      );
      expect(feature.scenarios.map(s => s.name)).toEqual(['outline', 'next']);
      // The @holdout tag sits above the Examples block; it must not carry over
      // to the following Scenario.
      expect(feature.scenarios[1].tags).toEqual([]);
    });

    it('does not leak a feature-level tag onto the first scenario', () => {
      const feature = parseFeatureFile(
        `@featureTag
Feature: F
  Scenario: s
    Given a
    Then b
`
      );
      expect(feature.scenarios[0].tags).toEqual([]);
    });
  });

  describe('tolerance (lenient parse)', () => {
    it('does not attach Background steps to scenarios', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Background:
    Given the app is running

  Scenario: s
    When b
    Then c
`
      );
      expect(feature.scenarios).toHaveLength(1);
      expect(feature.scenarios[0].steps.map(s => s.keyword)).toEqual([
        'When',
        'Then',
      ]);
    });

    it('treats Examples table rows as opaque (not steps)', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario Outline: s
    Given <a>
    When b
    Then <c>
    Examples:
      | a | c |
      | 1 | 2 |
      | 3 | 4 |
`
      );
      expect(feature.scenarios[0].steps).toHaveLength(3);
    });

    it('ignores docstring content', () => {
      const feature = parseFeatureFile(
        `Feature: F
  Scenario: s
    Given a request body:
      """
      When this is inside a docstring it is not a step
      Then neither is this
      """
    When b
    Then c
`
      );
      const keywords = feature.scenarios[0].steps.map(s => s.keyword);
      expect(keywords).toEqual(['Given', 'When', 'Then']);
    });

    it('ignores comments and tags', () => {
      const feature = parseFeatureFile(
        `# top-level comment
@smoke
Feature: F
  @wip
  Scenario: s
    # a comment between steps
    Given a
    When b
    Then c
`
      );
      expect(feature.name).toBe('F');
      expect(feature.scenarios[0].steps).toHaveLength(3);
    });

    it('normalizes CRLF line endings', () => {
      const feature = parseFeatureFile(
        'Feature: F\r\n  Scenario: s\r\n    Given a\r\n    When b\r\n    Then c\r\n'
      );
      expect(feature.name).toBe('F');
      expect(feature.scenarios[0].steps).toHaveLength(3);
    });
  });

  describe('error / edge cases produce a parseable (if invalid) model', () => {
    it('yields no scenarios when only a Feature header exists', () => {
      const feature = parseFeatureFile('Feature: empty\n');
      expect(feature.scenarios).toHaveLength(0);
    });

    it('yields a scenario with no steps when none are present', () => {
      const feature = parseFeatureFile('Feature: F\n  Scenario: empty\n');
      expect(feature.scenarios).toHaveLength(1);
      expect(feature.scenarios[0].steps).toHaveLength(0);
    });

    it('works via the class API as well as the free function', () => {
      const feature = new GherkinParser(
        'Feature: F\n  Scenario: s\n    Given a\n    When b\n    Then c\n'
      ).parseFeature();
      expect(feature.scenarios).toHaveLength(1);
    });
  });
});
