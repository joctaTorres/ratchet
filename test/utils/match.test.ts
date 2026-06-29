/**
 * Unit tests for src/utils/match.ts.
 *
 * Implements features/utils-helper-tests/match.feature: the pure
 * string-matching helpers `levenshtein` (edit distance) and `nearestMatches`
 * (distance-ranked suggestion list). Both are deterministic over in-memory
 * inputs, so these are unit tests that touch no filesystem and spawn no
 * process.
 */
import { describe, it, expect } from 'vitest';

import { levenshtein, nearestMatches } from '../../src/utils/match.js';

describe('levenshtein', () => {
  it('returns zero for identical strings', () => {
    expect(levenshtein('apply', 'apply')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('apply', 'apple')).toBe(1);
  });

  it('handles insertion and deletion', () => {
    // one character added → one insertion
    expect(levenshtein('aply', 'apply')).toBe(1);
    // two characters removed → two deletions
    expect(levenshtein('applying', 'apply')).toBe(3);
  });

  it('returns the length of the non-empty operand when the other is empty', () => {
    expect(levenshtein('', 'apply')).toBe(5);
    expect(levenshtein('change', '')).toBe(6);
  });
});

describe('nearestMatches', () => {
  it('ranks candidates by distance and caps the result at the maximum', () => {
    const result = nearestMatches('apply', ['apple', 'apples', ' archive', 'verify', 'list', 'batch'], 3);
    expect(result).toHaveLength(3);
    // closest first: 'apple' (1) then 'apples' (2)
    expect(result[0]).toBe('apple');
    expect(result[1]).toBe('apples');
  });

  it('returns every candidate ordered by distance when fewer than the default maximum', () => {
    const result = nearestMatches('apply', ['apple', 'archive', 'list']);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('apple');
    expect(result).toEqual(expect.arrayContaining(['apple', 'archive', 'list']));
  });

  it('honors a custom maximum', () => {
    const result = nearestMatches('apply', ['apple', 'apples', 'archive', 'list'], 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('apple');
    expect(result[1]).toBe('apples');
  });

  it('returns an empty list when there are no candidates', () => {
    expect(nearestMatches('apply', [])).toEqual([]);
    expect(nearestMatches('apply', [], 3)).toEqual([]);
  });
});
