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
  it('loads a deterministic binding with a pass condition', () => {
    const root = makeProject();
    writeSpec(
      root,
      'cli.yaml',
      `features/cli/status#status-as-json:
  fixture: status-ok
  kind: deterministic
  check:
    run: ratchet status --json
    pass: "contains:applyRequires"
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'features/cli/status#status-as-json');
    expect(b?.binding.kind).toBe('deterministic');
    if (b?.binding.kind === 'deterministic') {
      expect(b.binding.fixture).toBe('status-ok');
      expect(b.binding.check.pass).toBe('contains:applyRequires');
    }
    expect(specs.warnings).toHaveLength(0);
  });

  it('loads an llm-judge binding with success criteria and a jury override', () => {
    const root = makeProject();
    writeSpec(
      root,
      'cli.yaml',
      `features/cli/status#x:
  fixture: fx
  kind: llm-judge
  success: it prints a JSON object
  jury:
    votes: 3
    quorum: unanimous
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'features/cli/status#x');
    expect(b?.binding.kind).toBe('llm-judge');
    if (b?.binding.kind === 'llm-judge') {
      expect(b.binding.success).toContain('JSON');
      expect(b.binding.jury).toEqual({ votes: 3, quorum: 'unanimous' });
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
    kind: deterministic
    check:
      run: "true"
  a#two:
    fixture: fx
    kind: llm-judge
    success: works
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#one')?.binding.kind).toBe('deterministic');
    expect(resolveBinding(specs, 'a#two')?.binding.kind).toBe('llm-judge');
  });

  it('warns on an invalid binding and leaves the case unbound', () => {
    const root = makeProject();
    writeSpec(
      root,
      'bad.yaml',
      `a#bad:
  fixture: fx
  kind: deterministic
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#bad')).toBeUndefined();
    expect(specs.warnings.length).toBeGreaterThan(0);
  });

  it('rejects a legacy "check" kind, warns, and leaves the case unbound', () => {
    const root = makeProject();
    writeSpec(
      root,
      'legacy.yaml',
      `a#legacy:
  fixture: fx
  kind: check
  check:
    run: "true"
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#legacy')).toBeUndefined();
    expect(specs.warnings.some((w) => w.includes('a#legacy'))).toBe(true);
  });

  it('rejects a legacy "agentVotes" key on an llm-judge binding and names jury.votes', () => {
    const root = makeProject();
    writeSpec(
      root,
      'stale.yaml',
      `a#stale:
  fixture: fx
  kind: llm-judge
  success: works
  agentVotes: 3
`
    );
    const specs = loadEvalSpecs(root);
    // Fail loud rather than silently dropping to the default single vote.
    expect(resolveBinding(specs, 'a#stale')).toBeUndefined();
    const warning = specs.warnings.find((w) => w.includes('a#stale'));
    expect(warning).toBeDefined();
    expect(warning).toContain('agentVotes');
    expect(warning).toContain('jury.votes');
  });

  it('returns undefined for a case with no binding (unbound)', () => {
    const root = makeProject();
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'never#bound')).toBeUndefined();
  });

  // features/eval-web-binding/web-binding-schema.feature
  it('loads a web binding with a URL readiness probe', () => {
    const root = makeProject();
    writeSpec(
      root,
      'web.yaml',
      `a#web-url:
  fixture: web-app
  kind: web
  start: "pnpm start"
  readiness:
    url: "http://localhost:3000"
    timeoutMs: 5000
  spec: e2e/login.spec.ts
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'a#web-url');
    expect(b?.binding.kind).toBe('web');
    if (b?.binding.kind === 'web') {
      expect(b.binding.fixture).toBe('web-app');
      expect(b.binding.start).toBe('pnpm start');
      expect(b.binding.readiness).toEqual({ url: 'http://localhost:3000', timeoutMs: 5000 });
      expect(b.binding.spec).toBe('e2e/login.spec.ts');
    }
    expect(specs.warnings).toHaveLength(0);
  });

  it('loads a web binding with a command readiness probe', () => {
    const root = makeProject();
    writeSpec(
      root,
      'web.yaml',
      `a#web-cmd:
  fixture: web-app
  kind: web
  start: "pnpm start"
  readiness:
    command: "curl -sf http://localhost:3000"
    timeoutMs: 5000
  spec: e2e/login.spec.ts
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'a#web-cmd');
    expect(b?.binding.kind).toBe('web');
    if (b?.binding.kind === 'web') {
      expect(b.binding.readiness).toEqual({ command: 'curl -sf http://localhost:3000', timeoutMs: 5000 });
    }
    expect(specs.warnings).toHaveLength(0);
  });

  it('rejects a web binding whose readiness names neither a url nor a command', () => {
    const root = makeProject();
    writeSpec(
      root,
      'web.yaml',
      `a#web-neither:
  fixture: web-app
  kind: web
  start: "pnpm start"
  readiness:
    timeoutMs: 5000
  spec: e2e/login.spec.ts
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#web-neither')).toBeUndefined();
    expect(specs.warnings.length).toBeGreaterThan(0);
  });

  it('rejects a web binding missing timeoutMs', () => {
    const root = makeProject();
    writeSpec(
      root,
      'web.yaml',
      `a#web-no-timeout:
  fixture: web-app
  kind: web
  start: "pnpm start"
  readiness:
    url: "http://localhost:3000"
  spec: e2e/login.spec.ts
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#web-no-timeout')).toBeUndefined();
    expect(specs.warnings.length).toBeGreaterThan(0);
  });

  it('rejects a web binding missing spec', () => {
    const root = makeProject();
    writeSpec(
      root,
      'web.yaml',
      `a#web-no-spec:
  fixture: web-app
  kind: web
  start: "pnpm start"
  readiness:
    url: "http://localhost:3000"
    timeoutMs: 5000
`
    );
    const specs = loadEvalSpecs(root);
    expect(resolveBinding(specs, 'a#web-no-spec')).toBeUndefined();
    expect(specs.warnings.length).toBeGreaterThan(0);
  });

  it('accepts a web binding with a one-time setup command', () => {
    const root = makeProject();
    writeSpec(
      root,
      'web.yaml',
      `a#web-setup:
  fixture: web-app
  kind: web
  start: "pnpm start"
  setup: "pnpm install"
  readiness:
    url: "http://localhost:3000"
    timeoutMs: 5000
  spec: e2e/login.spec.ts
`
    );
    const specs = loadEvalSpecs(root);
    const b = resolveBinding(specs, 'a#web-setup');
    expect(b?.binding.kind).toBe('web');
    if (b?.binding.kind === 'web') {
      expect(b.binding.setup).toBe('pnpm install');
    }
    expect(specs.warnings).toHaveLength(0);
  });
});
