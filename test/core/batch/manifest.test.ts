import { describe, it, expect } from 'vitest';
import {
  parseBatchManifest,
  BatchManifestError,
  allChangeIntents,
  PROOF_OF_WORK_KINDS,
} from '../../../src/core/batch/manifest.js';

const VALID_MANIFEST = `
name: q3-auth
created: 2026-06-10
phases:
  - name: foundation
    goal: Stand up the auth skeleton
    success: A user can log in end to end
    proofOfWork:
      kind: integration
      run: pnpm test auth
      pass: exit code 0
    changes:
      - name: add-user-model
      - name: add-login-api
        after: [add-user-model]
`;

describe('parseBatchManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parseBatchManifest(VALID_MANIFEST);
    expect(manifest.name).toBe('q3-auth');
    expect(manifest.phases).toHaveLength(1);
    expect(manifest.phases[0].proofOfWork.kind).toBe('integration');
    expect(manifest.phases[0].changes[1].after).toEqual(['add-user-model']);
  });

  it('defaults after edges to an empty array', () => {
    const manifest = parseBatchManifest(VALID_MANIFEST);
    expect(manifest.phases[0].changes[0].after).toEqual([]);
  });

  it('collects all change intents across phases', () => {
    const manifest = parseBatchManifest(VALID_MANIFEST);
    expect(allChangeIntents(manifest).map((c) => c.name)).toEqual([
      'add-user-model',
      'add-login-api',
    ]);
  });

  it('rejects non-object content', () => {
    expect(() => parseBatchManifest('- just\n- a\n- list')).toThrow(BatchManifestError);
  });

  it('reports the malformed entry with its location', () => {
    const bad = `
name: q3-auth
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: not-a-kind
      run: x
      pass: y
    changes:
      - name: ok-change
`;
    try {
      parseBatchManifest(bad);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BatchManifestError);
      const msg = (err as Error).message;
      expect(msg).toContain('proofOfWork');
      expect(msg).toContain('kind');
    }
  });

  it('rejects a change intent missing a name', () => {
    const bad = `
name: q3-auth
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: blackbox
      run: x
      pass: y
    changes:
      - after: [other]
`;
    expect(() => parseBatchManifest(bad)).toThrow(BatchManifestError);
  });

  it('constrains proof-of-work kinds', () => {
    expect(PROOF_OF_WORK_KINDS).toEqual(['integration', 'blackbox', 'llm-judge']);
  });
});
