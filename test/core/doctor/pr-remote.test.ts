/**
 * features/doctor-pr-remote-warning/warning.feature
 *
 * The `pr-remote` doctor check: an advisory warning emitted ONLY when PR grouping
 * is active and the repo has no configured git remote. Proven at the unit layer by
 * injecting a fake `BootstrapDeps` whose `run` returns a scripted `git remote`
 * result, and pointing `projectRoot` at a tmpdir whose `.ratchet/config.yaml` sets
 * `prGrouping`. No real process or git repo is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  runDoctorChecks,
  type DoctorReport,
} from '../../../src/core/doctor/index.js';
import { exitCodeFor } from '../../../src/core/doctor/render.js';
import { AGENT_BINARIES } from '../../../src/core/batch/engine/agent.js';
import type {
  BootstrapDeps,
  RunResult,
} from '../../../src/core/batch/engine/runtime/rex-bootstrap.js';

/**
 * In-memory fake mirroring the rex-bootstrap/doctor test fake: `run` is driven by
 * a programmable handler and PATH membership by a Set.
 */
class FakeDeps implements BootstrapDeps {
  calls: { command: string; args: string[] }[] = [];
  toolsOnPath = new Set<string>();

  constructor(private handler: (command: string, args: string[]) => RunResult) {}

  run(command: string, args: string[]): RunResult {
    this.calls.push({ command, args });
    return this.handler(command, args);
  }
  hasOnPath(tool: string): boolean {
    return this.toolsOnPath.has(tool);
  }
  exists(): boolean {
    return false;
  }
  readText(): string {
    throw new Error('not used');
  }
  writeText(): void {}
  mkdirp(): void {}
  rmrf(): void {}
}

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
const fail = (stderr = 'boom'): RunResult => ({ status: 1, stdout: '', stderr });

const CLAUDE_BIN = AGENT_BINARIES.claude;
const AGENT_BINS = Object.values(AGENT_BINARIES);

/**
 * Build deps whose required checks all pass (so `ok`/exit are driven only by
 * required checks, never by an unrelated missing agent/runtime), with a scripted
 * `git remote` result for the PR-remote probe.
 */
function makeDeps(gitRemote: RunResult): FakeDeps {
  const deps = new FakeDeps((command, args) => {
    if (command === 'git' && args.includes('remote')) return gitRemote;
    if (AGENT_BINS.includes(command) && args.includes('--version')) {
      return ok(`${command} 1.0.0`);
    }
    return ok();
  });
  deps.toolsOnPath.add(CLAUDE_BIN);
  deps.toolsOnPath.add('uv');
  return deps;
}

function prCheck(report: DoctorReport) {
  return report.checks.find((c) => c.id === 'pr-remote');
}

let projectRoot: string;
let userConfigHome: string;
let priorXdgConfigHome: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-pr-remote-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
  // Isolate the user/global scope so resolution never reads the real machine's
  // ~/.config/ratchet.
  userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-pr-remote-xdg-'));
  priorXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = userConfigHome;
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(userConfigHome, { recursive: true, force: true });
  if (priorXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = priorXdgConfigHome;
});

async function writeConfig(content: string): Promise<void> {
  await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), content, 'utf-8');
}

const WHOLE_BATCH = 'schema: ratchet\nbatch:\n  prGrouping: whole-batch\n';
const OFF = 'schema: ratchet\nbatch:\n  prGrouping: off\n';
// The stacked modes are non-`off`, so the shared grouping-active predicate the
// check now consults reports them active — the warning must cover them too.
const STACKED_MODES = ['per-phase', 'per-change'] as const;

describe('checkPrRemote via runDoctorChecks (warning.feature)', () => {
  it('active PR grouping + no configured git remote → one info/optional pr-remote check', async () => {
    await writeConfig(WHOLE_BATCH);
    // `git remote` exits 0 with empty output → no remote configured.
    const report = runDoctorChecks(makeDeps(ok('')), projectRoot);

    const pr = prCheck(report);
    expect(pr).toBeDefined();
    expect(pr!.status).toBe('info');
    expect(pr!.severity).toBe('optional');
    // Detail explains prGrouping is active but no git remote to push to.
    expect(pr!.detail).toContain('PR grouping is active');
    expect(pr!.detail.toLowerCase()).toContain('no configured git remote');
    // Remedy names a git remote and NO forge-specific CLI.
    expect(pr!.remedy).toBeDefined();
    expect(pr!.remedy!.toLowerCase()).toContain('git remote');
    for (const forge of ['gh', 'glab', 'github', 'gitlab']) {
      expect(pr!.remedy!.toLowerCase()).not.toContain(forge);
    }
  });

  it('the PR-remote warning never fails doctor (ok stays true, exit 0)', async () => {
    await writeConfig(WHOLE_BATCH);
    const report = runDoctorChecks(makeDeps(ok('')), projectRoot);

    expect(prCheck(report)).toBeDefined();
    expect(report.ok).toBe(true);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('a non-zero `git remote` probe is also treated as "no remote" and warns', async () => {
    await writeConfig(WHOLE_BATCH);
    // e.g. not a git repo / git absent → non-zero exit is the safe warn direction.
    const report = runDoctorChecks(makeDeps(fail('not a git repository')), projectRoot);
    expect(prCheck(report)).toBeDefined();
  });

  it('stays silent when PR grouping is off (the default) — no pr-remote check', async () => {
    await writeConfig(OFF);
    const report = runDoctorChecks(makeDeps(ok('')), projectRoot);
    expect(prCheck(report)).toBeUndefined();
  });

  it('stays silent when a git remote is configured — no pr-remote check', async () => {
    await writeConfig(WHOLE_BATCH);
    // `git remote` lists a remote name → configured, so no warning.
    const report = runDoctorChecks(makeDeps(ok('origin\n')), projectRoot);
    expect(prCheck(report)).toBeUndefined();
  });

  it('does not probe git at all when PR grouping is off', async () => {
    await writeConfig(OFF);
    const deps = makeDeps(ok(''));
    runDoctorChecks(deps, projectRoot);
    const probedGit = deps.calls.some((c) => c.command === 'git');
    expect(probedGit).toBe(false);
  });

  // The predicate refactor means every non-`off` mode is active, so the
  // missing-remote warning fires for the stacked modes and stays silent when a
  // remote exists — with no doctor-specific edit per mode.
  for (const mode of STACKED_MODES) {
    it(`warns for prGrouping: ${mode} with no configured git remote`, async () => {
      await writeConfig(`schema: ratchet\nbatch:\n  prGrouping: ${mode}\n`);
      const report = runDoctorChecks(makeDeps(ok('')), projectRoot);
      const pr = prCheck(report);
      expect(pr).toBeDefined();
      expect(pr!.status).toBe('info');
      expect(pr!.detail).toContain('PR grouping is active');
    });

    it(`stays silent for prGrouping: ${mode} when a git remote is configured`, async () => {
      await writeConfig(`schema: ratchet\nbatch:\n  prGrouping: ${mode}\n`);
      const report = runDoctorChecks(makeDeps(ok('origin\n')), projectRoot);
      expect(prCheck(report)).toBeUndefined();
    });
  }
});
