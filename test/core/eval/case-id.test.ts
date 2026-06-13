import { describe, it, expect } from 'vitest';
import {
  slugifyScenario,
  featurePathToken,
  buildCaseId,
  assignCaseIds,
} from '../../../src/core/eval/case-id.js';

describe('eval case-id', () => {
  it('slugifies a scenario name', () => {
    expect(slugifyScenario('Status as JSON!')).toBe('status-as-json');
    expect(slugifyScenario('  Multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugifyScenario('---')).toBe('scenario');
  });

  it('strips the .feature extension and normalises separators', () => {
    expect(featurePathToken('.ratchet/features/cli/status.feature')).toBe(
      '.ratchet/features/cli/status'
    );
    expect(featurePathToken('a\\b\\c.feature')).toBe('a/b/c');
  });

  it('builds a stable case id from path and scenario', () => {
    expect(buildCaseId('features/cli/status.feature', 'Status as JSON')).toBe(
      'features/cli/status#status-as-json'
    );
  });

  it('assigns ordinal suffixes to duplicate scenario slugs in document order', () => {
    const ids = assignCaseIds('f/x.feature', ['Do a thing', 'Do a thing', 'Other', 'Do a thing']);
    expect(ids).toEqual([
      'f/x#do-a-thing',
      'f/x#do-a-thing-2',
      'f/x#other',
      'f/x#do-a-thing-3',
    ]);
  });

  it('produces identical ids for the same input across calls (stability)', () => {
    const a = assignCaseIds('f/x.feature', ['One', 'Two']);
    const b = assignCaseIds('f/x.feature', ['One', 'Two']);
    expect(a).toEqual(b);
  });
});
