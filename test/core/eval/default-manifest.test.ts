// Implements features/eval-invariants/default-manifest.feature
// Implements features/eval-invariants/mutation-scaffold.feature
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectTestDirectory,
  buildDefaultInvariantManifestYaml,
} from '../../../src/core/eval/default-manifest.js';
import { loadInvariantManifest } from '../../../src/core/eval/invariants.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-default-manifest-'));
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

const TOOLCHAIN_LITERALS = ['pnpm', 'npm', 'yarn', 'vitest', 'jest', 'cargo', 'go test', 'mvn', 'gradle', 'pytest', 'make'];

describe('detectTestDirectory', () => {
  it('returns null when no conventional test directory exists', () => {
    const root = makeProject();
    expect(detectTestDirectory(root)).toBeNull();
  });

  it.each(['test', 'tests', 'spec', '__tests__'])('detects a conventional %s directory', (dirName) => {
    const root = makeProject();
    mkdirSync(path.join(root, dirName));
    expect(detectTestDirectory(root)).toBe(dirName);
  });

  it('returns the first match in declared precedence order when more than one exists', () => {
    const root = makeProject();
    mkdirSync(path.join(root, 'spec'));
    mkdirSync(path.join(root, 'tests'));
    mkdirSync(path.join(root, 'test'));
    expect(detectTestDirectory(root)).toBe('test');
  });
});

describe('buildDefaultInvariantManifestYaml', () => {
  it('always carries spec-not-weakened as monotonic and active', () => {
    const root = makeProject();
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    const { invariants } = loadInvariantManifest(root);
    const specNotWeakened = invariants.find((i) => i.id === 'spec-not-weakened');
    expect(specNotWeakened).toBeDefined();
    expect(specNotWeakened?.active).toBe(true);
    expect(specNotWeakened?.kind).toBe('monotonic');
    if (specNotWeakened?.kind === 'monotonic') {
      expect(specNotWeakened.measure).toBe('scenario-count');
    }
  });

  it('emits a live, inert tests-still-exist entry when a conventional test directory is detected', () => {
    const root = makeProject();
    mkdirSync(path.join(root, 'test'));
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    const { invariants } = loadInvariantManifest(root);
    const testsStillExist = invariants.find((i) => i.id === 'tests-still-exist');
    expect(testsStillExist).toBeDefined();
    expect(testsStillExist?.active).toBe(false);
    expect(testsStillExist?.kind).toBe('deterministic');
    if (testsStillExist?.kind === 'deterministic') {
      expect(testsStillExist.check.run).toContain('test');
      expect(testsStillExist.check.run).toContain('-d');
    }
  });

  it('emits a commented placeholder (no live entry) for tests-still-exist when no test directory is detected', () => {
    const root = makeProject();
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    const { invariants } = loadInvariantManifest(root);
    expect(invariants.find((i) => i.id === 'tests-still-exist')).toBeUndefined();
    expect(yaml).toContain('tests-still-exist');
  });

  it('emits a live, inert mutants-are-killed entry when a conventional test directory is detected', () => {
    const root = makeProject();
    mkdirSync(path.join(root, 'test'));
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    const { invariants } = loadInvariantManifest(root);
    const mutation = invariants.find((i) => i.id === 'mutants-are-killed');
    expect(mutation).toBeDefined();
    expect(mutation?.active).toBe(false);
    expect(mutation?.kind).toBe('mutation');
    if (mutation?.kind === 'mutation') {
      expect(mutation.test.length).toBeGreaterThan(0);
      expect(mutation.budget).toBeGreaterThan(0);
      expect(mutation.threshold).toBeGreaterThan(0);
    }
  });

  it('emits a commented placeholder (no live entry) for mutants-are-killed when no test directory is detected', () => {
    const root = makeProject();
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    const { invariants } = loadInvariantManifest(root);
    expect(invariants.find((i) => i.id === 'mutants-are-killed')).toBeUndefined();
    expect(yaml).toContain('mutants-are-killed');
  });

  it('never scaffolds mutants-are-killed as active, with or without a detected test directory', () => {
    const withoutTestDir = makeProject();
    const yamlWithout = buildDefaultInvariantManifestYaml(withoutTestDir);
    writeManifest(withoutTestDir, yamlWithout);
    expect(
      loadInvariantManifest(withoutTestDir).invariants.find((i) => i.id === 'mutants-are-killed')
    ).toBeUndefined();

    const withTestDir = makeProject();
    mkdirSync(path.join(withTestDir, 'tests'));
    const yamlWith = buildDefaultInvariantManifestYaml(withTestDir);
    writeManifest(withTestDir, yamlWith);
    const mutation = loadInvariantManifest(withTestDir).invariants.find((i) => i.id === 'mutants-are-killed');
    expect(mutation?.active).toBe(false);
  });

  it('never declares public-api-unchanged as a live invariant, with or without a test directory', () => {
    const withoutTestDir = makeProject();
    const yamlWithout = buildDefaultInvariantManifestYaml(withoutTestDir);
    writeManifest(withoutTestDir, yamlWithout);
    expect(
      loadInvariantManifest(withoutTestDir).invariants.find((i) => i.id === 'public-api-unchanged')
    ).toBeUndefined();
    expect(yamlWithout).toContain('public-api-unchanged');

    const withTestDir = makeProject();
    mkdirSync(path.join(withTestDir, 'tests'));
    const yamlWith = buildDefaultInvariantManifestYaml(withTestDir);
    writeManifest(withTestDir, yamlWith);
    expect(
      loadInvariantManifest(withTestDir).invariants.find((i) => i.id === 'public-api-unchanged')
    ).toBeUndefined();
  });

  it('round-trips through loadInvariantManifest with no error and an active set of exactly spec-not-weakened', () => {
    const root = makeProject();
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    expect(() => loadInvariantManifest(root)).not.toThrow();
    const { invariants } = loadInvariantManifest(root);
    const active = invariants.filter((i) => i.active).map((i) => i.id);
    expect(active).toEqual(['spec-not-weakened']);
  });

  it('keeps the active set to exactly spec-not-weakened even when a test directory makes two more entries live', () => {
    const root = makeProject();
    mkdirSync(path.join(root, 'test'));
    const yaml = buildDefaultInvariantManifestYaml(root);
    writeManifest(root, yaml);
    expect(() => loadInvariantManifest(root)).not.toThrow();
    const { invariants } = loadInvariantManifest(root);
    const active = invariants.filter((i) => i.active).map((i) => i.id);
    expect(active).toEqual(['spec-not-weakened']);
  });

  it('carries no package-manager, test-runner, or build-tool literal anywhere in the output', () => {
    const withTestDir = makeProject();
    mkdirSync(path.join(withTestDir, 'test'));
    const withoutTestDir = makeProject();

    for (const root of [withTestDir, withoutTestDir]) {
      const yaml = buildDefaultInvariantManifestYaml(root);
      for (const literal of TOOLCHAIN_LITERALS) {
        expect(yaml.toLowerCase()).not.toContain(literal.toLowerCase());
      }
    }
  });
});
