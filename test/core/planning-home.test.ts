import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type PlanningHome,
  formatChangeLocation,
  getChangeDir,
  resolveCurrentPlanningHomeSync,
} from '../../src/core/planning-home.js';

describe('planning home paths', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds repo change paths with the planning home path style', () => {
    const repoPlanningHome: PlanningHome = {
      kind: 'repo',
      root: 'D:\\repos\\service',
      changesDir: 'D:\\repos\\service\\.ratchet\\changes',
      batchesDir: 'D:\\repos\\service\\.ratchet\\batches',
      defaultSchema: 'ratchet',
    };

    expect(getChangeDir(repoPlanningHome, 'add-login')).toBe(
      'D:\\repos\\service\\.ratchet\\changes\\add-login'
    );
    expect(formatChangeLocation(repoPlanningHome, 'add-login')).toBe(
      '.ratchet\\changes\\add-login'
    );
  });

  it('resolves repo-local projects with a .ratchet directory as repo planning homes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-planning-home-'));
    tempDirs.push(tempDir);
    const repoRoot = path.join(tempDir, 'service-repo');
    const changesDir = path.join(repoRoot, '.ratchet', 'changes');

    fs.mkdirSync(changesDir, { recursive: true });

    const planningHome = resolveCurrentPlanningHomeSync({
      startPath: changesDir,
      allowImplicitRepoRoot: false,
    });

    expect(planningHome.kind).toBe('repo');
    expect(planningHome.root).toBe(fs.realpathSync.native(repoRoot));
    expect(planningHome.defaultSchema).toBe('ratchet');
  });

  it('throws when no planning home is found and implicit repo root is disallowed', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-planning-home-'));
    tempDirs.push(tempDir);
    const bareDir = path.join(tempDir, 'no-ratchet-here');
    fs.mkdirSync(bareDir, { recursive: true });

    expect(() =>
      resolveCurrentPlanningHomeSync({
        startPath: bareDir,
        allowImplicitRepoRoot: false,
      })
    ).toThrow(/planning home/u);
  });
});
