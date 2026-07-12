/**
 * Manifest permission-escalation clamping (phase proof-of-work for
 * restrict-manifest-permission-escalation).
 *
 * Implements:
 *   - features/manifest-permission-scope/narrow-only-resolution.feature
 *   - features/manifest-permission-scope/escalation-opt-in.feature
 *   - features/manifest-permission-scope/apply-posture-banner.feature
 *
 * Two layers of coverage:
 *   1. Pure unit tests over the in-memory `resolvePermissionsPolicy` /
 *      `resolveBatchSettings` seam (no filesystem) — the narrow-only contract:
 *      a repo-committed manifest layer may only NARROW (lower) posture, never
 *      raise it above the operator-owned (default/user/project) scopes; its
 *      `deny` additions still union; the opt-in flag re-enables a raise.
 *   2. Integration tests over `batchApplyCommand` with the tmpdir fixture
 *      pattern — the posture banner opens every human run, `--json` suppresses
 *      it, and a suppressed manifest raise prints a warning naming the flag and
 *      the operator-owned config scopes.
 *
 * Phase proof-of-work: `pnpm test test/batch-engine/manifest-permission-escalation.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  resolvePermissionsPolicy,
  resolveBatchSettings,
  POSTURE_PRIVILEGE_RANK,
  type SuppressedEscalation,
} from '../../src/core/batch/config.js';
import { saveUserBatchPermissions } from '../../src/core/global-config.js';
import type { BatchManifest } from '../../src/core/batch/manifest.js';
import type { StepResult } from '../../src/core/batch/engine/index.js';

// ---------------------------------------------------------------------------
// Pure unit tests: narrow-only-resolution.feature + escalation-opt-in.feature
// (in-memory layers, no filesystem)
// ---------------------------------------------------------------------------

describe('resolvePermissionsPolicy: manifest narrow-only posture', () => {
  it('curated-allowlist < repo-sandboxed-permissive < full-autonomy privilege ranking', () => {
    expect(POSTURE_PRIVILEGE_RANK['curated-allowlist']).toBeLessThan(
      POSTURE_PRIVILEGE_RANK['repo-sandboxed-permissive']
    );
    expect(POSTURE_PRIVILEGE_RANK['repo-sandboxed-permissive']).toBeLessThan(
      POSTURE_PRIVILEGE_RANK['full-autonomy']
    );
  });

  it('manifest raise is CLAMPED by default; operator posture and source are kept', () => {
    const { policy, postureSource, suppressedEscalation } = resolvePermissionsPolicy([
      { scope: 'project', policy: { posture: 'repo-sandboxed-permissive' } },
      { scope: 'manifest', policy: { posture: 'full-autonomy' } },
    ]);
    expect(policy.posture).toBe('repo-sandboxed-permissive');
    expect(postureSource).toBe('project');
    expect(suppressedEscalation).toEqual({
      scope: 'manifest',
      requested: 'full-autonomy',
    } satisfies SuppressedEscalation);
  });

  it('manifest NARROW (lower posture) applies unchanged and attributes source to manifest', () => {
    const { policy, postureSource, suppressedEscalation } = resolvePermissionsPolicy([
      { scope: 'project', policy: { posture: 'full-autonomy' } },
      { scope: 'manifest', policy: { posture: 'curated-allowlist' } },
    ]);
    expect(policy.posture).toBe('curated-allowlist');
    expect(postureSource).toBe('manifest');
    expect(suppressedEscalation).toBeUndefined();
  });

  it('manifest raise is ALLOWED when allowManifestEscalation is true', () => {
    const { policy, postureSource, suppressedEscalation } = resolvePermissionsPolicy(
      [
        { scope: 'project', policy: { posture: 'repo-sandboxed-permissive' } },
        { scope: 'manifest', policy: { posture: 'full-autonomy' } },
      ],
      { allowManifestEscalation: true }
    );
    expect(policy.posture).toBe('full-autonomy');
    expect(postureSource).toBe('manifest');
    expect(suppressedEscalation).toBeUndefined();
  });

  it('manifest deny additions still UNION even when its posture raise is refused', () => {
    const { policy, suppressedEscalation } = resolvePermissionsPolicy([
      { scope: 'project', policy: { posture: 'repo-sandboxed-permissive', deny: ['A'] } },
      { scope: 'manifest', policy: { posture: 'full-autonomy', deny: ['B'] } },
    ]);
    expect(policy.deny.sort()).toEqual(['A', 'B']);
    expect(suppressedEscalation).toBeDefined();
  });

  it('manifest posture EQUAL to the operator posture is not a raise (no suppression)', () => {
    const { policy, postureSource, suppressedEscalation } = resolvePermissionsPolicy([
      { scope: 'project', policy: { posture: 'repo-sandboxed-permissive' } },
      { scope: 'manifest', policy: { posture: 'repo-sandboxed-permissive' } },
    ]);
    expect(policy.posture).toBe('repo-sandboxed-permissive');
    expect(postureSource).toBe('manifest');
    expect(suppressedEscalation).toBeUndefined();
  });

  it('operator-owned user/project scopes keep their raise ability (NOT clamped)', () => {
    const { policy, postureSource, suppressedEscalation } = resolvePermissionsPolicy([
      { scope: 'user', policy: { posture: 'curated-allowlist' } },
      { scope: 'project', policy: { posture: 'full-autonomy' } },
    ]);
    expect(policy.posture).toBe('full-autonomy');
    expect(postureSource).toBe('project');
    expect(suppressedEscalation).toBeUndefined();
  });

  it('the opt-in flag changes nothing when the manifest does not raise the posture', () => {
    const { policy, postureSource } = resolvePermissionsPolicy(
      [
        { scope: 'project', policy: { posture: 'repo-sandboxed-permissive' } },
        { scope: 'manifest', policy: { posture: 'repo-sandboxed-permissive' } },
      ],
      { allowManifestEscalation: true }
    );
    expect(policy.posture).toBe('repo-sandboxed-permissive');
    expect(postureSource).toBe('manifest');
  });
});

// ---------------------------------------------------------------------------
// resolveBatchSettings threading (filesystem-backed; the committed batch.yaml
// silent-escalation assertion the issue is about)
// ---------------------------------------------------------------------------

describe('resolveBatchSettings: manifest escalation threading', () => {
  let projectRoot: string;
  let userConfigHome: string;
  let priorXdg: string | undefined;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-esc-'));
    await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
    userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-esc-xdg-'));
    priorXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userConfigHome;
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(userConfigHome, { recursive: true, force: true });
    if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = priorXdg;
  });

  async function writeProject(yaml: string): Promise<void> {
    await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), yaml, 'utf-8');
  }

  function manifest(permissions: unknown): BatchManifest {
    return {
      name: 'b',
      phases: [],
      settings: { permissions },
    } as unknown as BatchManifest;
  }

  it('committed batch.yaml full-autonomy cannot silently escalate over project repo-sandboxed-permissive', async () => {
    await writeProject(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n'
    );
    const { settings, sources, suppressedEscalation } = resolveBatchSettings(
      projectRoot,
      manifest({ posture: 'full-autonomy' })
    );
    expect(settings.permissions?.posture).toBe('repo-sandboxed-permissive');
    expect(sources.permissions).toBe('project');
    expect(suppressedEscalation).toEqual({ scope: 'manifest', requested: 'full-autonomy' });
  });

  it('the opt-in lets the committed manifest raise posture to full-autonomy', async () => {
    await writeProject(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n'
    );
    const { settings, sources, suppressedEscalation } = resolveBatchSettings(
      projectRoot,
      manifest({ posture: 'full-autonomy' }),
      { allowManifestEscalation: true }
    );
    expect(settings.permissions?.posture).toBe('full-autonomy');
    expect(sources.permissions).toBe('manifest');
    expect(suppressedEscalation).toBeUndefined();
  });

  it('a manifest that NARROWS posture applies and attributes source to manifest', async () => {
    saveUserBatchPermissions({ posture: 'full-autonomy' });
    await writeProject('schema: ratchet\n');
    const { settings, sources, suppressedEscalation } = resolveBatchSettings(
      projectRoot,
      manifest({ posture: 'curated-allowlist' })
    );
    expect(settings.permissions?.posture).toBe('curated-allowlist');
    expect(sources.permissions).toBe('manifest');
    expect(suppressedEscalation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration over batchApplyCommand: posture banner + suppressed-escalation
// warning (apply-posture-banner.feature, escalation-opt-in.feature)
// ---------------------------------------------------------------------------

const {
  runStepMock,
  computeNextTransitionMock,
  readJournalTolerantMock,
  resolvePlanningHomeMock,
} = vi.hoisted(() => ({
  runStepMock: vi.fn(),
  computeNextTransitionMock: vi.fn(),
  readJournalTolerantMock: vi.fn(),
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../src/core/batch/engine/index.js', () => ({
  RatchetBatchEngine: class {
    runStep = runStepMock;
    runDecompositionStep = vi.fn();
    runPrStep = vi.fn();
  },
  computeNextTransition: computeNextTransitionMock,
  decompositionJournalKey: (phase: string) => phase,
  prJournalKey: (batch: string) => `pr:${batch}`,
  hasJournaledPr: (journal: { kind: string; transition?: string }[] = []) =>
    journal.some((e) => e.kind === 'completion' && e.transition === 'pr'),
  readJournalTolerant: readJournalTolerantMock,
  runProofOfWork: vi.fn(),
  agentOverrideNotice: (envVar: string) => `⚠ agent overridden by ${envVar}`,
  BATCH_AGENT_CMD_ENV: 'RATCHET_BATCH_AGENT_CMD',
  // The single selection engine: return a concrete change target so `batchApplyCommand`
  // proceeds to `engine.runStep` (the mocked `runStepMock`).
  pickNextStep: () => ({
    kind: 'change',
    phase: {
      name: 'p1',
      goal: 'ship',
      success: 'works',
      proofOfWork: { kind: 'integration', run: 'echo ok', pass: 'exit 0' },
    },
    change: 'c1',
    changeDone: 'c1 done',
  }),
}));

vi.mock('../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchApplyCommand } from '../../src/commands/batch/apply.js';
import { makeBatchFixture, type BatchFixture } from '../commands/batch/batch-fixture.js';

const PHASE = { name: 'p1', goal: 'ship', success: 'works' };

describe('batchApplyCommand: posture banner + manifest escalation warning', () => {
  let fixture: BatchFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeBatchFixture('ratchet-perm-esc-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    computeNextTransitionMock.mockReturnValue('propose');
    readJournalTolerantMock.mockReturnValue([]);
    runStepMock.mockResolvedValue({
      state: 'advanced',
      change: 'c1',
      transition: 'propose',
      message: 'step complete',
    } satisfies StepResult);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('prints the effective posture and its source scope at the start of every human run', async () => {
    await fixture.writeProjectConfig(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n'
    );
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    await fixture.writeChangeWithTasks('c1', { done: 0, total: 1 });

    await batchApplyCommand('b', {});

    expect(output()).toContain('permissions: repo-sandboxed-permissive (project scope)');
  });

  it('attributes a manifest-narrowed posture to the manifest scope', async () => {
    await fixture.writeProjectConfig(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: full-autonomy\n'
    );
    await fixture.writeBatch('b', {
      settings: { permissions: { posture: 'repo-sandboxed-permissive' } },
      phases: [{ ...PHASE, changes: [{ name: 'c1' }] }],
    });
    await fixture.writeChangeWithTasks('c1', { done: 0, total: 1 });

    await batchApplyCommand('b', {});

    expect(output()).toContain('permissions: repo-sandboxed-permissive (manifest scope)');
  });

  it('suppresses the human posture banner under --json', async () => {
    await fixture.writeProjectConfig(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n'
    );
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    await fixture.writeChangeWithTasks('c1', { done: 0, total: 1 });

    await batchApplyCommand('b', { json: true });

    const parsed = JSON.parse(output()) as StepResult;
    expect(parsed.state).toBe('advanced');
    expect(output()).not.toContain('permissions:');
  });

  it('warns when a manifest raise is refused and names the flag and operator-owned scopes', async () => {
    await fixture.writeProjectConfig(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n'
    );
    await fixture.writeBatch('b', {
      settings: { permissions: { posture: 'full-autonomy' } },
      phases: [{ ...PHASE, changes: [{ name: 'c1' }] }],
    });
    await fixture.writeChangeWithTasks('c1', { done: 0, total: 1 });

    await batchApplyCommand('b', {});

    const out = output();
    expect(out).toContain("manifest requested posture 'full-autonomy'");
    expect(out).toContain('--allow-manifest-escalation');
    expect(out).toContain('user/project config');
    // The run proceeds under the clamped (project) posture.
    expect(out).toContain('permissions: repo-sandboxed-permissive (project scope)');
  });

  it('honors --allow-manifest-escalation: no warning and manifest posture applies', async () => {
    await fixture.writeProjectConfig(
      'schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n'
    );
    await fixture.writeBatch('b', {
      settings: { permissions: { posture: 'full-autonomy' } },
      phases: [{ ...PHASE, changes: [{ name: 'c1' }] }],
    });
    await fixture.writeChangeWithTasks('c1', { done: 0, total: 1 });

    await batchApplyCommand('b', { allowManifestEscalation: true });

    const out = output();
    expect(out).toContain('permissions: full-autonomy (manifest scope)');
    expect(out).not.toContain("manifest requested posture 'full-autonomy'");
  });
});
