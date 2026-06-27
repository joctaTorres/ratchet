import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadLayeredStandards } from '../../src/core/standards.js';
import { resolveCurrentPlanningHomeSync } from '../../src/core/planning-home.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-layer-'));
  tempDirs.push(dir);
  return fs.realpathSync.native(dir);
}

function writeStandard(homeRoot: string, fileName: string, content: string): void {
  const dir = path.join(homeRoot, RATCHET_DIR_NAME, 'standards');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
}

function makeHome(homeRoot: string): void {
  fs.mkdirSync(path.join(homeRoot, RATCHET_DIR_NAME, 'changes'), { recursive: true });
}

function homeAt(start: string) {
  return resolveCurrentPlanningHomeSync({ startPath: start, allowImplicitRepoRoot: false });
}

describe('loadLayeredStandards', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a module sees inherited root standards', () => {
    const root = makeRepo();
    makeHome(root);
    writeStandard(root, 'testing.md', '---\ntag: testing\n---\nroot testing\n');
    const moduleRoot = path.join(root, 'packages', 'api');
    makeHome(moduleRoot);

    const tags = loadLayeredStandards(homeAt(moduleRoot)).map((s) => s.tag);
    expect(tags).toContain('testing');
  });

  it('module standards add on top of root standards', () => {
    const root = makeRepo();
    makeHome(root);
    writeStandard(root, 'testing.md', '---\ntag: testing\n---\nroot testing\n');
    const moduleRoot = path.join(root, 'packages', 'api');
    makeHome(moduleRoot);
    writeStandard(moduleRoot, 'api-versioning.md', '---\ntag: api-versioning\n---\napi versioning\n');

    const tags = loadLayeredStandards(homeAt(moduleRoot)).map((s) => s.tag);
    expect(tags).toContain('testing');
    expect(tags).toContain('api-versioning');
  });

  it('a module standard shadows a root standard on tag collision', () => {
    const root = makeRepo();
    makeHome(root);
    writeStandard(root, 'testing.md', '---\ntag: testing\n---\nroot version\n');
    const moduleRoot = path.join(root, 'packages', 'api');
    makeHome(moduleRoot);
    writeStandard(moduleRoot, 'testing.md', '---\ntag: testing\n---\napi version\n');

    const testing = loadLayeredStandards(homeAt(moduleRoot)).filter((s) => s.tag === 'testing');
    expect(testing).toHaveLength(1);
    expect(testing[0].content).toContain('api version');
    expect(testing[0].content).not.toContain('root version');
  });

  it('a root change sees only root standards', () => {
    const root = makeRepo();
    makeHome(root);
    writeStandard(root, 'testing.md', '---\ntag: testing\n---\nroot testing\n');
    const moduleRoot = path.join(root, 'packages', 'api');
    makeHome(moduleRoot);
    writeStandard(moduleRoot, 'api-versioning.md', '---\ntag: api-versioning\n---\napi versioning\n');

    const tags = loadLayeredStandards(homeAt(root)).map((s) => s.tag);
    expect(tags).toContain('testing');
    expect(tags).not.toContain('api-versioning');
  });
});
