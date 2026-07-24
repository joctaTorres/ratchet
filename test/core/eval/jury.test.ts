/**
 * Unit tests for the jury config schema and resolver.
 *
 * Implements features/eval-judge/jury-quorum-resolution.feature's jury
 * configuration scenarios: no config anywhere → a single majority vote, a
 * project-level default, a per-binding override replacing the default
 * outright, a per-binding override of only one field falling back to the
 * project default for the other, and the reserved-but-inert `panel` slot
 * (parsed and retained, validated). Pure in-memory inputs — no filesystem, no
 * spawn.
 */

import { describe, it, expect } from 'vitest';
import { resolveJury, JurySchema, type Jury } from '../../../src/core/eval/jury.js';

describe('resolveJury', () => {
  it('casts a single majority vote when no config or binding jury is given', () => {
    expect(resolveJury({})).toEqual({ votes: 1, quorum: 'majority' });
  });

  it('takes the project-level default when the binding declares no override', () => {
    const config: Jury = { votes: 3, quorum: 'unanimous' };
    expect(resolveJury({ config })).toEqual({ votes: 3, quorum: 'unanimous' });
  });

  it('replaces the project default outright with a per-binding override of both fields', () => {
    const config: Jury = { votes: 3, quorum: 'majority' };
    const binding: Jury = { votes: 5, quorum: 'unanimous' };
    expect(resolveJury({ config, binding })).toEqual({ votes: 5, quorum: 'unanimous' });
  });

  it('falls back to the project default for a field the binding does not override', () => {
    const config: Jury = { votes: 3, quorum: 'majority' };
    const binding: Jury = { quorum: 'unanimous' };
    expect(resolveJury({ config, binding })).toEqual({ votes: 3, quorum: 'unanimous' });
  });
});

describe('JurySchema', () => {
  it('accepts a jury block with a panel and retains it on the parsed value', () => {
    const parsed = JurySchema.safeParse({
      votes: 3,
      quorum: 'unanimous',
      panel: { families: ['llm-judge', 'deterministic'] },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.panel).toEqual({ families: ['llm-judge', 'deterministic'] });
    }
  });

  it('ignores the panel entirely when resolving votes', () => {
    const config: Jury = { votes: 2, panel: { families: ['llm-judge'] } };
    expect(resolveJury({ config })).toEqual({ votes: 2, quorum: 'majority' });
  });

  it('rejects a panel whose families list is empty', () => {
    const parsed = JurySchema.safeParse({ panel: { families: [] } });
    expect(parsed.success).toBe(false);
  });
});
