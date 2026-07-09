/**
 * Manifest load rejects degenerate proof-of-work pass conditions.
 *
 * Pins `manifest-load-rejection.feature`: a hard-gate proof-of-work must never
 * be vacuous by construction. Empty/whitespace `contains:` needles, an empty
 * `regex:` pattern, an invalid `regex:` (compile error surfaced), and the
 * echo-your-own-pass-phrase self-satisfying shape are rejected at manifest
 * parse — through the single `parseBatchManifest` parser, so both
 * `ratchet validate` and `loadBatchManifest` (the `batch apply` load) reject
 * identically with located, actionable messages. Exit-zero directives and
 * well-formed conditions still load.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  parseBatchManifest,
  loadBatchManifest,
  getBatchManifestPath,
  BatchManifestError,
} from '../../src/core/batch/manifest.js';

/** A minimal valid phase shell with the proof-of-work supplied inline. */
function manifest(run: string, pass: string): string {
  return `
name: proof-cond
phases:
  - name: only
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: ${JSON.stringify(run)}
      pass: ${JSON.stringify(pass)}
    changes:
      - name: ok-change
        done: it works
`;
}

/** Assert parsing fails with a located error mentioning the cause. */
function expectRejected(
  content: string,
  ...causeFragments: string[]
): void {
  try {
    parseBatchManifest(content);
    throw new Error('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BatchManifestError);
    const msg = (err as Error).message;
    // Located: the offending pass condition is named by its zod path.
    expect(msg).toContain('proofOfWork.pass');
    for (const fragment of causeFragments) {
      expect(msg).toContain(fragment);
    }
  }
}

describe('manifest load rejects degenerate pass conditions', () => {
  it('rejects an empty contains: needle at parse', () => {
    expectRejected(manifest('echo ok', 'contains:'), 'contains', 'empty');
  });

  it('rejects a whitespace-only contains: needle at parse', () => {
    expectRejected(manifest('echo ok', 'contains:   '), 'contains', 'empty');
  });

  it('rejects an empty regex: pattern at parse', () => {
    expectRejected(manifest('echo ok', 'regex:'), 'regex', 'empty');
  });

  it('rejects an invalid regex: pattern with the compile error surfaced', () => {
    // Capture the actual RegExp compile error for this pattern so the assertion
    // is robust across JS engines — the manifest error must include that text.
    let compileError = '';
    try {
      new RegExp('[unclosed');
    } catch (err) {
      compileError = (err as Error).message;
    }
    expect(compileError.length).toBeGreaterThan(0);
    expectRejected(manifest('echo ok', 'regex:[unclosed'), 'regex', 'invalid', compileError);
  });

  it('rejects the echo-your-own-pass-phrase contains: shape', () => {
    // The pass needle appears verbatim in the run command — the command can
    // satisfy its own gate.
    expectRejected(
      manifest('echo ALL GREEN', 'contains:ALL GREEN'),
      'self-satisfying',
      'ALL GREEN'
    );
  });

  it('rejects the echo-your-own-pass-phrase bare-string shape', () => {
    expectRejected(
      manifest('echo PROOF DONE', 'PROOF DONE'),
      'self-satisfying',
      'PROOF DONE'
    );
  });

  it('never lints an exit-zero directive against the run command', () => {
    // An exit-zero directive gates on exit status, not stdout — even when the
    // directive prose appears in the run command, it is exempt from the lint.
    const content = manifest(
      '# run mentions exit code 0 in a comment\ntrue',
      'exit code 0 — suite green'
    );
    expect(() => parseBatchManifest(content)).not.toThrow();
  });

  it('loads a well-formed contains: condition whose needle is not in the run', () => {
    const content = manifest('pnpm test', 'contains:12 passed');
    expect(() => parseBatchManifest(content)).not.toThrow();
  });

  it('loads a well-formed regex: condition', () => {
    const content = manifest('pnpm test', 'regex:\\d+ passed');
    expect(() => parseBatchManifest(content)).not.toThrow();
  });
});

describe('loadBatchManifest enforces the same validation', () => {
  let projectRoot: string;
  const BATCH = 'pcv';

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pcv-'));
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('rejects an on-disk batch carrying an empty regex: pattern identically', async () => {
    const onDisk = `
name: ${BATCH}
phases:
  - name: only
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: echo ok
      pass: 'regex:'
    changes:
      - name: ok-change
        done: it works
`;
    await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), onDisk, 'utf-8');

    try {
      loadBatchManifest(projectRoot, BATCH);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BatchManifestError);
      const msg = (err as Error).message;
      // Same located, actionable message as direct parsing.
      expect(msg).toContain('proofOfWork.pass');
      expect(msg).toContain('regex');
      expect(msg).toContain('empty');
    }
  });
});
