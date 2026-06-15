import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveBatchSettings,
  resolvePermissionsPolicy,
  redactSettings,
  setProjectBatchPermissions,
  hasPermissionConfig,
  REDACTED_PLACEHOLDER,
  type BatchSettings,
} from '../../../src/core/batch/config.js';
import { saveUserBatchPermissions } from '../../../src/core/global-config.js';
import type { BatchManifest } from '../../../src/core/batch/manifest.js';

let projectRoot: string;
let userConfigHome: string;
let priorXdg: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-res-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
  userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-res-xdg-'));
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

describe('permission scope layering (user ← project ← manifest)', () => {
  it('no config at any scope yields the built-in default posture', async () => {
    await writeProject('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.permissions?.posture).toBe('repo-sandboxed-permissive');
    expect(sources.permissions).toBe('default');
  });

  it('per-change manifest posture wins over project and user (scalar nearest-wins)', async () => {
    saveUserBatchPermissions({ posture: 'curated-allowlist' });
    await writeProject('schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n');
    const { settings, sources } = resolveBatchSettings(
      projectRoot,
      manifest({ posture: 'full-autonomy' })
    );
    expect(settings.permissions?.posture).toBe('full-autonomy');
    expect(sources.permissions).toBe('manifest');
  });

  it('project overrides user when no manifest posture is present', async () => {
    saveUserBatchPermissions({ posture: 'full-autonomy' });
    await writeProject('schema: ratchet\nbatch:\n  permissions:\n    posture: repo-sandboxed-permissive\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.permissions?.posture).toBe('repo-sandboxed-permissive');
    expect(sources.permissions).toBe('project');
  });

  it('user config applies when neither project nor manifest override it', async () => {
    saveUserBatchPermissions({ posture: 'curated-allowlist' });
    await writeProject('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.permissions?.posture).toBe('curated-allowlist');
    expect(sources.permissions).toBe('user');
  });

  it('deny lists UNION across scopes; allow lists are REPLACED by the nearest scope', () => {
    const { policy } = resolvePermissionsPolicy([
      { scope: 'user', policy: { deny: ['A'] } },
      { scope: 'project', policy: { deny: ['B'], allow: ['X', 'Y'] } },
      { scope: 'manifest', policy: { allow: ['Z'] } },
    ]);
    expect(policy.deny.sort()).toEqual(['A', 'B']);
    expect(policy.allow).toEqual(['Z']); // replaced by nearest scope, not unioned
  });

  it('raw per-agent entries are nearest-wins, independently per agent', () => {
    const { policy } = resolvePermissionsPolicy([
      { scope: 'user', policy: { raw: { claude: ['--user'], codex: ['--codex-user'] } } },
      { scope: 'project', policy: { raw: { claude: ['--project'] } } },
    ]);
    expect(policy.raw.claude).toEqual(['--project']); // nearest wins
    expect(policy.raw.codex).toEqual(['--codex-user']); // untouched by project
  });
});

describe('redactSettings — secret-bearing raw override values', () => {
  it('masks a token-like value following a secret-signalling flag', () => {
    const settings = {
      gate: 'voluntary',
      strategy: 'vertical-slice',
      proofOfWork: 'hard-gate',
      locus: 'local',
      permissions: {
        posture: 'full-autonomy',
        allow: [],
        deny: [],
        raw: { claude: ['--api-key', 'sk-live-abcdef0123456789abcdef', '--verbose'] },
      },
    } as unknown as BatchSettings;
    const out = redactSettings(settings);
    const raw = out.permissions?.raw.claude ?? [];
    expect(raw).toContain('--api-key');
    expect(raw).toContain(REDACTED_PLACEHOLDER);
    expect(raw).not.toContain('sk-live-abcdef0123456789abcdef');
    expect(raw).toContain('--verbose'); // non-secret tokens preserved
  });

  it('masks an inline --flag=secret pairing by flag name', () => {
    const settings = {
      gate: 'voluntary',
      strategy: 'vertical-slice',
      proofOfWork: 'hard-gate',
      locus: 'local',
      permissions: {
        posture: 'full-autonomy',
        allow: [],
        deny: [],
        raw: { codex: ['--auth-token=supersecretvalue1234567890', '--keep'] },
      },
    } as unknown as BatchSettings;
    const raw = redactSettings(settings).permissions?.raw.codex ?? [];
    expect(raw).toContain(`--auth-token=${REDACTED_PLACEHOLDER}`);
    expect(raw).toContain('--keep');
  });

  it('masks an inline --flag=secret pairing by VALUE shape (non-secret flag name)', () => {
    // Regression guard: a non-secret-named flag (`--config`) carrying an opaque
    // token must still have its value half redacted, not leaked verbatim.
    const settings = {
      gate: 'voluntary',
      strategy: 'vertical-slice',
      proofOfWork: 'hard-gate',
      locus: 'local',
      permissions: {
        posture: 'full-autonomy',
        allow: [],
        deny: [],
        raw: { cursor: ['--config=sk-live-abcdef0123456789abcdef', '--print'] },
      },
    } as unknown as BatchSettings;
    const raw = redactSettings(settings).permissions?.raw.cursor ?? [];
    expect(raw).toContain(`--config=${REDACTED_PLACEHOLDER}`);
    expect(raw).not.toContain('--config=sk-live-abcdef0123456789abcdef');
    expect(raw.join(' ')).not.toContain('sk-live-abcdef0123456789abcdef');
    expect(raw).toContain('--print'); // short non-secret flag preserved
  });
});

describe('project persistence + idempotency key', () => {
  it('setProjectBatchPermissions merges into existing config and round-trips', async () => {
    await writeProject('schema: ratchet\nbatch:\n  gate: every-phase\n');
    setProjectBatchPermissions(projectRoot, { posture: 'curated-allowlist', allow: ['Edit'] });
    const { settings } = resolveBatchSettings(projectRoot);
    expect(settings.gate).toBe('every-phase'); // preserved
    expect(settings.permissions?.posture).toBe('curated-allowlist');
    expect(settings.permissions?.allow).toEqual(['Edit']);
  });

  it('hasPermissionConfig is false with no config, true once project or user defines it', async () => {
    await writeProject('schema: ratchet\n');
    expect(hasPermissionConfig(projectRoot)).toBe(false);
    setProjectBatchPermissions(projectRoot, { posture: 'full-autonomy' });
    expect(hasPermissionConfig(projectRoot)).toBe(true);
  });

  it('hasPermissionConfig is true when only the user scope defines a policy', async () => {
    await writeProject('schema: ratchet\n');
    saveUserBatchPermissions({ posture: 'curated-allowlist' });
    expect(hasPermissionConfig(projectRoot)).toBe(true);
  });
});
