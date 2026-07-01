/**
 * Unit tests for the skip-filter resolver.
 *
 * Implements features/eval-judge/skip-filters.feature's in-file `@skip` tag and
 * project `eval.skip` config pattern scenarios: the tag wins regardless of
 * config, a matching config pattern excludes the case, a non-matching pattern
 * does not, and no tag with no config resolves to no skip. Pure in-memory
 * inputs — no filesystem, no spawn.
 */

import { describe, it, expect } from 'vitest';
import { resolveSkip, SKIP_TAG } from '../../../src/core/eval/skip.js';
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

describe('resolveSkip', () => {
  it('returns null when the case has no @skip tag and no config patterns match', () => {
    expect(resolveSkip(mkCase(), undefined)).toBeNull();
    expect(resolveSkip(mkCase(), ['features/legacy/*'])).toBeNull();
  });

  it('returns a tag reason naming the source file when the case is tagged @skip', () => {
    const c = mkCase({ tags: [SKIP_TAG] });
    expect(resolveSkip(c)).toEqual({ source: 'tag', detail: c.source });
  });

  it('returns a config reason naming the matched pattern when the case id matches an eval.skip glob', () => {
    const c = mkCase({ id: 'features/legacy/old#case' });
    expect(resolveSkip(c, ['features/legacy/*'])).toEqual({
      source: 'config',
      detail: 'features/legacy/*',
    });
  });

  it('does not skip a case whose id does not match any eval.skip pattern', () => {
    const c = mkCase({ id: 'features/cli/status#status-as-json' });
    expect(resolveSkip(c, ['features/legacy/*'])).toBeNull();
  });

  it('checks the @skip tag before config, even when a config pattern also matches', () => {
    const c = mkCase({ id: 'features/legacy/old#case', tags: [SKIP_TAG] });
    expect(resolveSkip(c, ['features/legacy/*'])).toEqual({ source: 'tag', detail: c.source });
  });

  it('is unaffected by other, non-skip tags', () => {
    const c = mkCase({ tags: ['@wip', '@smoke'] });
    expect(resolveSkip(c, undefined)).toBeNull();
  });
});
