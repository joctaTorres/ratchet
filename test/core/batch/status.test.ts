import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { computeBatchStatus } from '../../../src/core/batch/status.js';
import { parseBatchManifest } from '../../../src/core/batch/manifest.js';
import { toJson } from '../../../src/commands/batch/status.js';

let projectRoot: string;
let changesDir: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-status-'));
  changesDir = path.join(projectRoot, '.ratchet', 'changes');
  await fs.mkdir(changesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function makeChange(name: string, plan: string): Promise<void> {
  const dir = path.join(changesDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'plan.md'), plan, 'utf-8');
}

async function archive(name: string): Promise<void> {
  const dir = path.join(changesDir, 'archive', name);
  await fs.mkdir(dir, { recursive: true });
}

const MANIFEST = `
name: q3-auth
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: '0'
    changes:
      - name: add-user-model
        done: the user model exists and persists
      - name: add-login-api
        after: [add-user-model]
        done: the login endpoint authenticates a user
      - name: add-oauth
        after: [add-user-model]
        done: oauth login works end to end
`;

function findChange(status: Awaited<ReturnType<typeof computeBatchStatus>>, name: string) {
  for (const phase of status.phases) {
    const found = phase.changes.find((c) => c.name === name);
    if (found) return found;
  }
  throw new Error(`change ${name} not found`);
}

describe('computeBatchStatus', () => {
  it('reports a not-yet-created intent as ready, and dependents as blocked, never error', async () => {
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    expect(findChange(status, 'add-user-model').status).toBe('ready');
    expect(findChange(status, 'add-login-api').status).toBe('blocked');
    expect(findChange(status, 'add-login-api').blockedBy).toEqual(['add-user-model']);
    expect(findChange(status, 'add-oauth').status).toBe('blocked');
  });

  it('counts a fully-checked change as done and readies dependents', async () => {
    await makeChange('add-user-model', '## Tasks\n- [x] one\n- [x] two\n');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    expect(findChange(status, 'add-user-model').status).toBe('done');
    expect(findChange(status, 'add-login-api').status).toBe('ready');
    expect(findChange(status, 'add-oauth').status).toBe('ready');
  });

  it('counts an archived change as done', async () => {
    await archive('add-user-model');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    expect(findChange(status, 'add-user-model').status).toBe('done');
  });

  it('reports partial progress as in-progress with task counts', async () => {
    await makeChange(
      'add-user-model',
      '## Tasks\n- [x] one\n- [x] two\n- [ ] three\n- [ ] four\n- [ ] five\n'
    );
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const c = findChange(status, 'add-user-model');
    expect(c.status).toBe('in-progress');
    expect(c.progress).toEqual({ total: 5, completed: 2 });
  });

  it('identifies the next actionable step', async () => {
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    expect(status.next).toEqual({ phase: 'foundation', change: 'add-user-model' });
  });

  it('overlays a parked blocker, forcing blocked and dropping it from next', async () => {
    const runState = {
      parked: {
        'add-user-model': {
          change: 'add-user-model',
          kind: 'blocked' as const,
          reason: 'cookie or header sessions?',
          parkedAt: '2026-06-10T00:00:00.000Z',
        },
      },
    };
    const status = await computeBatchStatus(
      projectRoot,
      parseBatchManifest(MANIFEST),
      runState
    );
    const c = findChange(status, 'add-user-model');
    expect(c.status).toBe('blocked');
    expect(c.parked?.kind).toBe('blocked');
    expect(c.parked?.reason).toBe('cookie or header sessions?');
    // The only ready change is parked, so nothing is advertised as next.
    expect(status.next).toBeUndefined();
  });

  it('overlays an awaiting-approval park as its own status', async () => {
    const runState = {
      parked: {
        'add-user-model': {
          change: 'add-user-model',
          kind: 'awaiting-approval' as const,
          reason: 'draft ready for review',
          parkedAt: '2026-06-10T00:00:00.000Z',
        },
      },
    };
    const status = await computeBatchStatus(
      projectRoot,
      parseBatchManifest(MANIFEST),
      runState
    );
    const c = findChange(status, 'add-user-model');
    expect(c.status).toBe('awaiting-approval');
    expect(c.parked?.kind).toBe('awaiting-approval');
    expect(status.next).toBeUndefined();
  });

  it('ignores a stale park on a change that is already done', async () => {
    await makeChange('add-user-model', '## Tasks\n- [x] one\n- [x] two\n');
    const runState = {
      parked: {
        'add-user-model': {
          change: 'add-user-model',
          kind: 'blocked' as const,
          reason: 'old question',
          parkedAt: '2026-06-10T00:00:00.000Z',
        },
      },
    };
    const status = await computeBatchStatus(
      projectRoot,
      parseBatchManifest(MANIFEST),
      runState
    );
    const c = findChange(status, 'add-user-model');
    expect(c.status).toBe('done');
    expect(c.parked).toBeUndefined();
  });

  it('carries a change intent done criterion into derived status (and JSON)', async () => {
    const withDone = `
name: ci-npx-release
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: release-decision-module
        done: module returns DENY unless all gate signals are green
`;
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(withDone));
    const c = findChange(status, 'release-decision-module');
    expect(c.done).toBe('module returns DENY unless all gate signals are green');
    // It survives the actual `batch status --json` projection (toJson), not just
    // a raw stringify of the derived status.
    const json = JSON.parse(JSON.stringify(toJson(status, 'voluntary'))) as {
      phases: { changes: { name: string; done?: string }[] }[];
    };
    const jsonChange = json.phases[0].changes.find(
      (ch) => ch.name === 'release-decision-module'
    );
    expect(jsonChange?.done).toBe('module returns DENY unless all gate signals are green');
  });

  it('always carries done in JSON and never a per-change success key', async () => {
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const c = findChange(status, 'add-user-model');
    expect(c.done).toBe('the user model exists and persists');
    const json = JSON.parse(JSON.stringify(toJson(status, 'voluntary'))) as {
      phases: { changes: { name: string; done?: string; success?: string }[] }[];
    };
    const jsonChange = json.phases[0].changes.find(
      (ch) => ch.name === 'add-user-model'
    );
    expect(jsonChange?.done).toBe('the user model exists and persists');
    expect(jsonChange && 'success' in jsonChange).toBe(false);
  });

  it('gates a later phase until the prior phase is done', async () => {
    const twoPhase = `
name: q3-auth
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: c1
        done: c1 is implemented and verifies
  - name: hardening
    goal: g2
    success: s2
    proofOfWork: { kind: blackbox, run: y, pass: '0' }
    changes:
      - name: c2
        done: c2 is implemented and verifies
`;
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(twoPhase));
    const hardening = status.phases.find((p) => p.name === 'hardening')!;
    expect(hardening.gated).toBe(true);
    expect(hardening.gatedBy).toBe('foundation');
    expect(hardening.status).toBe('blocked');
  });
});
