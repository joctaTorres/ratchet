import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadEvalSpecs, resolveBinding } from '../../../src/core/eval/spec.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-spec-'));
  roots.push(root);
  return root;
}

function writeSpec(root: string, name: string, content: string): void {
  const dir = path.join(root, '.ratchet', 'evals', 'specs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), content, 'utf-8');
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('loadEvalSpecs', () => {
  it('loads a check binding with a pass condition', () => {
    const root = makeProject();
    writeSpec(
      root,
      'cli.yaml',
      `features/cli/status#status-as-json:
  fixture: status-ok
  kind: check
  check:
    run: ratchet status --json
    pass: "contains:applyRequires"
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'features/cli/status#status-as-json');
    expect(b?.binding.kind).toBe('check');
    if (b?.binding.kind === 'check') {
      expect(b.binding.fixture).toBe('status-ok');
      expect(b.binding.check.pass).toBe('contains:applyRequires');
    }
    expect(specs.warnings).toHaveLength(0);
  });

  it('loads an agent binding with success criteria and votes', () => {
    const root = makeProject();
    writeSpec(
      root,
      'cli.yaml',
      `features/cli/status#x:
  fixture: fx
  kind: agent
  success: it prints a JSON object
  agentVotes: 3
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'features/cli/status#x');
    expect(b?.binding.kind).toBe('agent');
    if (b?.binding.kind === 'agent') {
      expect(b.binding.success).toContain('JSON');
      expect(b.binding.agentVotes).toBe(3);
    }
  });

  it('supports multiple bindings in one file and a bindings: key', () => {
    const root = makeProject();
    writeSpec(
      root,
      'multi.yaml',
      `bindings:
  a#one:
    fixture: fx
    kind: check
    check:
      run: "true"
  a#two:
    fixture: fx
    kind: agent
    success: works
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#one')?.binding.kind).toBe('check');
    expect(resolveBinding(specs, 'a#two')?.binding.kind).toBe('agent');
  });

  it('warns on an invalid binding and leaves the case unbound', () => {
    const root = makeProject();
    writeSpec(
      root,
      'bad.yaml',
      `a#bad:
  fixture: fx
  kind: check
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#bad')).toBeUndefined();
    expect(specs.warnings.length).toBeGreaterThan(0);
  });

  it('returns undefined for a case with no binding (unbound)', () => {
    const root = makeProject();
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'never#bound')).toBeUndefined();
  });
});
