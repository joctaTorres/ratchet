import { describe, it, expect } from 'vitest';
import { BatchDag, BatchDagError } from '../../../src/core/batch/dag.js';
import type { ChangeIntent } from '../../../src/core/batch/manifest.js';

function intent(name: string, after: string[] = []): ChangeIntent {
  return { name, after, done: `${name} is implemented` };
}

describe('BatchDag', () => {
  it('marks only the chain head ready for a serial chain', () => {
    const dag = BatchDag.fromIntents([
      intent('add-user-model'),
      intent('add-login-api', ['add-user-model']),
      intent('add-oauth', ['add-login-api']),
    ]);
    const result = dag.compute(new Set());
    expect(result.ready).toEqual(['add-user-model']);
    expect(Object.keys(result.blocked).sort()).toEqual(['add-login-api', 'add-oauth']);
    expect(result.blocked['add-login-api']).toEqual(['add-user-model']);
  });

  it('marks all nodes ready when there are no edges (parallel)', () => {
    const dag = BatchDag.fromIntents([
      intent('add-audit-log'),
      intent('add-metrics'),
      intent('add-tracing'),
    ]);
    const result = dag.compute(new Set());
    expect(result.ready).toEqual(['add-audit-log', 'add-metrics', 'add-tracing']);
    expect(result.blocked).toEqual({});
  });

  it('readies dependents once their dependency is done', () => {
    const dag = BatchDag.fromIntents([
      intent('add-user-model'),
      intent('add-login-api', ['add-user-model']),
      intent('add-oauth', ['add-user-model']),
    ]);
    const result = dag.compute(new Set(['add-user-model']));
    expect(result.ready).toEqual(['add-login-api', 'add-oauth']);
  });

  it('treats a newly-added edge-free change as ready without affecting others', () => {
    const dag = BatchDag.fromIntents([
      intent('add-user-model'),
      intent('add-oauth', ['add-user-model']),
      intent('add-sso'),
    ]);
    const result = dag.compute(new Set(['add-user-model']));
    expect(result.ready).toContain('add-sso');
    expect(result.ready).toContain('add-oauth');
  });

  it('rejects a cycle naming the changes involved', () => {
    expect(() =>
      BatchDag.fromIntents([
        intent('change-a', ['change-b']),
        intent('change-b', ['change-a']),
      ])
    ).toThrowError(/change-a.*change-b|change-b.*change-a/);
  });

  it('rejects an after edge referencing an unknown entry, naming it', () => {
    try {
      BatchDag.fromIntents([intent('add-login-api', ['not-in-this-batch'])]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BatchDagError);
      expect((err as Error).message).toContain('not-in-this-batch');
    }
  });

  it('rejects duplicate change intents', () => {
    expect(() =>
      BatchDag.fromIntents([intent('dup'), intent('dup')])
    ).toThrowError(/Duplicate/);
  });
});
