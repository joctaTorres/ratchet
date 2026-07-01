// Implements features/eval-invariants/manifest-loader.feature
// Implements features/eval-invariants/mutation-kind.feature
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadInvariantManifest,
  invariantsManifestPath,
  InvariantManifestError,
} from '../../../src/core/eval/invariants.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-invariants-'));
  roots.push(root);
  return root;
}

function writeManifest(root: string, content: string): void {
  const dir = path.join(root, '.ratchet', 'evals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'invariants.yaml'), content, 'utf-8');
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('loadInvariantManifest', () => {
  it('resolves the manifest path under .ratchet/evals/', () => {
    const root = makeProject();
    expect(invariantsManifestPath(root)).toBe(
      path.join(root, '.ratchet', 'evals', 'invariants.yaml')
    );
  });

  // Scenario: Load a manifest carrying all three invariant kinds with active flags
  it('loads all three kinds in declared order with their active flags', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: spec-not-weakened
    kind: monotonic
    active: true
    measure: scenario-count
  - id: tests-still-exist
    kind: deterministic
    active: false
    check:
      run: "test -d test"
  - id: public-api-unchanged
    kind: snapshot
    active: false
    golden: .ratchet/evals/golden/public-api.txt
    produce:
      run: "ratchet api --json"
`
    );
    const { invariants } = loadInvariantManifest(root);
    expect(invariants.map((i) => i.id)).toEqual([
      'spec-not-weakened',
      'tests-still-exist',
      'public-api-unchanged',
    ]);

    const [mono, det, snap] = invariants;
    expect(mono.kind).toBe('monotonic');
    expect(mono.active).toBe(true);
    expect(det.kind).toBe('deterministic');
    expect(det.active).toBe(false);
    expect(snap.kind).toBe('snapshot');
    expect(snap.active).toBe(false);
  });

  // Scenario: Each kind carries its kind-specific fields
  it('exposes each kind its kind-specific fields', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: det
    kind: deterministic
    active: true
    check:
      run: "pnpm lint"
      pass: "exit-zero"
  - id: mono
    kind: monotonic
    active: true
    measure: scenario-count
  - id: snap
    kind: snapshot
    active: true
    golden: golden/api.txt
    produce:
      run: "produce-api"
`
    );
    const { invariants } = loadInvariantManifest(root);
    const det = invariants[0];
    const mono = invariants[1];
    const snap = invariants[2];
    if (det.kind === 'deterministic') {
      expect(det.check.run).toBe('pnpm lint');
      expect(det.check.pass).toBe('exit-zero');
    } else {
      throw new Error('expected deterministic');
    }
    if (mono.kind === 'monotonic') {
      expect(mono.measure).toBe('scenario-count');
    } else {
      throw new Error('expected monotonic');
    }
    if (snap.kind === 'snapshot') {
      expect(snap.golden).toBe('golden/api.txt');
      expect(snap.produce.run).toBe('produce-api');
    } else {
      throw new Error('expected snapshot');
    }
  });

  // Scenario: Load a mutation invariant exposing its test/budget/threshold fields
  it('loads a mutation invariant exposing its test/budget/threshold fields', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: mutants-are-killed
    kind: mutation
    active: true
    test: "pnpm test"
    budget: 5
    threshold: 3
`
    );
    const mut = loadInvariantManifest(root).invariants[0];
    if (mut.kind !== 'mutation') throw new Error('expected mutation');
    expect(mut.test).toBe('pnpm test');
    expect(mut.budget).toBe(5);
    expect(mut.threshold).toBe(3);
  });

  // Scenario: A mutation invariant coexists with the existing three kinds
  it('loads all four kinds together, each still exposing its own fields', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: det
    kind: deterministic
    active: true
    check:
      run: "pnpm lint"
  - id: mono
    kind: monotonic
    active: true
    measure: scenario-count
  - id: snap
    kind: snapshot
    active: true
    golden: golden/api.txt
    produce:
      run: "produce-api"
  - id: mut
    kind: mutation
    active: true
    test: "pnpm test"
    budget: 5
    threshold: 3
`
    );
    const { invariants } = loadInvariantManifest(root);
    expect(invariants.map((i) => i.kind)).toEqual([
      'deterministic',
      'monotonic',
      'snapshot',
      'mutation',
    ]);
    const [det, mono, snap, mut] = invariants;
    if (det.kind !== 'deterministic') throw new Error('expected deterministic');
    expect(det.check.run).toBe('pnpm lint');
    if (mono.kind !== 'monotonic') throw new Error('expected monotonic');
    expect(mono.measure).toBe('scenario-count');
    if (snap.kind !== 'snapshot') throw new Error('expected snapshot');
    expect(snap.golden).toBe('golden/api.txt');
    if (mut.kind !== 'mutation') throw new Error('expected mutation');
    expect(mut.test).toBe('pnpm test');
    expect(mut.budget).toBe(5);
    expect(mut.threshold).toBe(3);
  });

  // Scenario Outline: A mutation invariant missing a required field fails closed
  it.each(['test', 'budget', 'threshold'])(
    'throws naming the mutation invariant that omits %s',
    (field) => {
      const root = makeProject();
      const fields: Record<string, string> = {
        test: 'test: "pnpm test"',
        budget: 'budget: 5',
        threshold: 'threshold: 3',
      };
      delete fields[field];
      writeManifest(
        root,
        `invariants:
  - id: missing-${field}
    kind: mutation
    active: true
    ${Object.values(fields).join('\n    ')}
`
      );
      expect(() => loadInvariantManifest(root)).toThrow(InvariantManifestError);
      expect(() => loadInvariantManifest(root)).toThrow(new RegExp(`missing-${field}`));
    }
  );

  // Scenario Outline: A non-positive budget or threshold fails closed
  it.each(['budget', 'threshold'])('throws when mutation %s is 0', (field) => {
    const root = makeProject();
    const fields: Record<string, string> = {
      budget: 'budget: 5',
      threshold: 'threshold: 3',
    };
    fields[field] = `${field}: 0`;
    writeManifest(
      root,
      `invariants:
  - id: zero-${field}
    kind: mutation
    active: true
    test: "pnpm test"
    ${Object.values(fields).join('\n    ')}
`
    );
    expect(() => loadInvariantManifest(root)).toThrow(InvariantManifestError);
  });

  it('defaults a deterministic check pass condition to exit-zero', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: det
    kind: deterministic
    active: true
    check:
      run: "true"
`
    );
    const det = loadInvariantManifest(root).invariants[0];
    if (det.kind !== 'deterministic') throw new Error('expected deterministic');
    expect(det.check.pass).toBe('exit-zero');
  });

  // Scenario: A missing manifest yields an empty set, not an error
  it('returns an empty set when the manifest is absent', () => {
    const root = makeProject();
    expect(loadInvariantManifest(root)).toEqual({ invariants: [] });
  });

  it('returns an empty set for an empty invariants list', () => {
    const root = makeProject();
    writeManifest(root, `invariants: []\n`);
    expect(loadInvariantManifest(root).invariants).toHaveLength(0);
  });

  // Scenario: Malformed YAML fails closed by surfacing a parse error
  it('throws InvariantManifestError on malformed YAML (never a silent empty set)', () => {
    const root = makeProject();
    writeManifest(root, `invariants: [unterminated\n  - : :\n`);
    expect(() => loadInvariantManifest(root)).toThrow(InvariantManifestError);
  });

  // Scenario Outline: An invalid invariant fails closed by surfacing a validation error
  it('throws naming the invariant that declares an unknown kind', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: weird
    kind: bogus
    active: true
`
    );
    expect(() => loadInvariantManifest(root)).toThrow(/weird/);
    expect(() => loadInvariantManifest(root)).toThrow(InvariantManifestError);
  });

  it('throws naming the invariant that omits the required active flag', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: no-active
    kind: monotonic
    measure: scenario-count
`
    );
    expect(() => loadInvariantManifest(root)).toThrow(/no-active/);
  });

  it('throws naming the invariant that omits a kind-required field', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: missing-measure
    kind: monotonic
    active: true
`
    );
    expect(() => loadInvariantManifest(root)).toThrow(/missing-measure/);
  });

  it('throws naming the duplicate id when an id is reused', () => {
    const root = makeProject();
    writeManifest(
      root,
      `invariants:
  - id: dup
    kind: monotonic
    active: true
    measure: scenario-count
  - id: dup
    kind: monotonic
    active: false
    measure: scenario-count
`
    );
    expect(() => loadInvariantManifest(root)).toThrow(/dup/);
    expect(() => loadInvariantManifest(root)).toThrow(InvariantManifestError);
  });

  it('throws on a top-level invariants key that is not a list', () => {
    const root = makeProject();
    writeManifest(root, `invariants:\n  not: a-list\n`);
    expect(() => loadInvariantManifest(root)).toThrow(InvariantManifestError);
  });
});
