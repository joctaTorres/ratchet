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
        done: the user model exists and persists
      - name: add-login-api
        after: [add-user-model]
        done: the login endpoint authenticates a user
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

  // Per-change `done` criterion (required, non-empty) — manifest-schema.feature.
  it('retains a change intent done criterion when present', () => {
    const withDone = `
name: ci-npx-release
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: y
    changes:
      - name: release-decision-module
        done: module returns DENY unless all gate signals are green
`;
    const manifest = parseBatchManifest(withDone);
    const intent = allChangeIntents(manifest).find(
      (c) => c.name === 'release-decision-module'
    );
    expect(intent?.done).toBe('module returns DENY unless all gate signals are green');
  });

  it('rejects a change intent missing a done criterion, naming the field', () => {
    const noDone = `
name: ci-npx-release
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: y
    changes:
      - name: release-decision-module
        after: []
`;
    try {
      parseBatchManifest(noDone);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BatchManifestError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/changes\.0\.done/);
    }
  });

  it('rejects an empty done criterion, naming the offending field', () => {
    const emptyDone = `
name: ci-npx-release
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: y
    changes:
      - name: release-decision-module
        done: ''
`;
    try {
      parseBatchManifest(emptyDone);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BatchManifestError);
      const msg = (err as Error).message;
      expect(msg).toContain('done');
      expect(msg).toMatch(/changes\.0\.done/);
    }
  });

  it('no longer recognizes the old per-change success key (requires done)', () => {
    const onlySuccess = `
name: ci-npx-release
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: y
    changes:
      - name: release-decision-module
        success: module returns DENY unless all gate signals are green
`;
    try {
      parseBatchManifest(onlySuccess);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BatchManifestError);
      // Fails because the required `done` is missing.
      expect((err as Error).message).toMatch(/changes\.0\.done/);
    }
  });

  it('keeps the phase-level success criterion valid (unchanged)', () => {
    const manifest = parseBatchManifest(VALID_MANIFEST);
    expect(manifest.phases[0].success).toBe('A user can log in end to end');
  });
});
