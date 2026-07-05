/**
 * features/doctor-spec-awareness/spec-form-binary-probe.feature
 * features/doctor-spec-awareness/no-model-validation.feature
 *
 * Doctor's `agent` check is spec-aware: every configured `batch.agent` value is
 * parsed through `parseAgentSpec` and the **agent part's** binary is probed, so
 * `opencode:zai/glm-5.2` probes `opencode` (never the whole spec string). A
 * configured agent whose binary is missing fails the check — even when another
 * supported binary is detected — naming the configured agent and its binary with
 * an install remedy. The model part is never validated and no model-related
 * check is emitted. The registry-wide sweep, detected-version detail, and
 * no-binary failure are unchanged when no agent is configured. Proven at the
 * unit layer by injecting a fake `BootstrapDeps` whose PATH membership is a Set,
 * and pointing `projectRoot` at a tmpdir fixture repo whose `.ratchet/config.yaml`
 * sets `batch.agent`. No real process or fs beyond the fixture is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { runDoctorChecks, type DoctorReport } from '../../../src/core/doctor/index.js';
import { exitCodeFor } from '../../../src/core/doctor/render.js';
import { AGENT_BINARIES } from '../../../src/core/batch/engine/agent.js';
import type {
  BootstrapDeps,
  RunResult,
} from '../../../src/core/batch/engine/runtime/rex-bootstrap.js';

class FakeDeps implements BootstrapDeps {
  calls: { command: string; args: string[] }[] = [];
  hasOnPathCalls: string[] = [];
  toolsOnPath = new Set<string>();

  constructor(private handler: (command: string, args: string[]) => RunResult) {}

  run(command: string, args: string[]): RunResult {
    this.calls.push({ command, args });
    return this.handler(command, args);
  }
  hasOnPath(tool: string): boolean {
    this.hasOnPathCalls.push(tool);
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

const CLAUDE_BIN = AGENT_BINARIES.claude;
const OPENCODE_BIN = AGENT_BINARIES.opencode;
const AGENT_BINS = Object.values(AGENT_BINARIES);

function check(report: DoctorReport, id: string) {
  const c = report.checks.find((c) => c.id === id);
  if (!c) throw new Error(`no check '${id}'`);
  return c;
}

/** A PATH whose only agent binary is the named set; version probe always ok. */
const depsWith = (...bins: string[]) => {
  const deps = new FakeDeps((command, args) => {
    if (AGENT_BINS.includes(command) && args.includes('--version')) {
      return ok(`${command} 1.0.0`);
    }
    return ok();
  });
  for (const b of bins) deps.toolsOnPath.add(b);
  return deps;
};

describe('doctor agent check — spec-aware consultation', () => {
  let projectRoot: string;
  let userConfigHome: string;
  let priorXdg: string | undefined;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-spec-'));
    await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
    userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-spec-xdg-'));
    priorXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userConfigHome;
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(userConfigHome, { recursive: true, force: true });
    if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = priorXdg;
  });

  const writeConfig = async (agentLine: string) => {
    await fs.writeFile(
      path.join(projectRoot, '.ratchet', 'config.yaml'),
      `schema: ratchet\nbatch:\n  ${agentLine}\n`,
      'utf-8'
    );
  };

  it('spec-form configured agent probes the agent-part binary (passes when present)', async () => {
    await writeConfig('agent: opencode:zai/glm-5.2');
    const deps = depsWith(OPENCODE_BIN);

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('pass');
    expect(agent.detail).toContain('opencode');
    // The literal spec string is never probed as a binary name.
    expect(deps.calls.some((c) => c.command === 'opencode:zai/glm-5.2')).toBe(false);
  });

  it('the whole spec string is never treated as a binary name', async () => {
    await writeConfig('agent: opencode:zai/glm-5.2');
    // A binary literally named by the whole spec string is on PATH, but the
    // agent-part binary `opencode` is NOT — proving the spec is parsed.
    const deps = new FakeDeps(() => ok());
    deps.toolsOnPath.add('opencode:zai/glm-5.2');

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('fail');
    expect(agent.detail).toContain('opencode');
    expect(agent.detail).not.toContain('opencode:zai/glm-5.2');
  });

  it('a configured agent whose binary is missing fails even when another agent is detected', async () => {
    await writeConfig('agent: opencode:zai/glm-5.2');
    const deps = depsWith(CLAUDE_BIN); // claude detected, but opencode missing

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('fail');
    expect(agent.severity).toBe('required');
    expect(agent.detail).toContain('opencode');
    expect(agent.remedy).toContain('opencode');
    expect(exitCodeFor(runDoctorChecks(deps, projectRoot))).toBe(1);
  });

  it('every value of a per-stage agent map is parsed and probed', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.ratchet', 'config.yaml'),
      'schema: ratchet\nbatch:\n  agent:\n    propose: claude:fable\n    apply: opencode:zai/glm-5.2\n',
      'utf-8'
    );
    const deps = depsWith(CLAUDE_BIN, OPENCODE_BIN);

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('pass');
    expect(agent.detail).toContain('claude');
    expect(agent.detail).toContain('opencode');
  });

  it('an unknown agent part is left to spawn-time rejection (no doctor failure, no check text)', async () => {
    await writeConfig('agent: notreal:some-model');
    const deps = depsWith(CLAUDE_BIN); // another supported agent detected

    const report = runDoctorChecks(deps, projectRoot);
    const agent = check(report, 'agent');

    expect(agent.status).toBe('pass');
    expect(agent.detail).not.toContain('notreal');
    expect(report.checks.some((c) => JSON.stringify(c).includes('notreal'))).toBe(false);
  });

  it('emits no model-related check; a bogus model id with binary present passes and the model string is absent', async () => {
    await writeConfig('agent: opencode:this/model-does-not-exist');
    const deps = depsWith(OPENCODE_BIN);

    const report = runDoctorChecks(deps, projectRoot);
    const agent = check(report, 'agent');

    expect(agent.status).toBe('pass');
    // No check text anywhere mentions the model string.
    expect(report.checks.some((c) => JSON.stringify(c).includes('this/model-does-not-exist'))).toBe(false);
    // No model-related check id exists.
    expect(report.checks.some((c) => /model/i.test(c.id))).toBe(false);
  });

  it('registry-wide probe is unchanged when no agent is configured (lists detected agents, probes every supported binary)', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.ratchet', 'config.yaml'),
      'schema: ratchet\n',
      'utf-8'
    );
    const deps = depsWith(CLAUDE_BIN);

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('pass');
    expect(agent.detail).toContain('claude');
    // Every supported agent binary was probed via the registry-wide sweep.
    for (const bin of AGENT_BINS) {
      expect(deps.hasOnPathCalls).toContain(bin);
    }
  });

  it('registry-wide no-agent failure is unchanged', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.ratchet', 'config.yaml'),
      'schema: ratchet\n',
      'utf-8'
    );
    const deps = new FakeDeps(() => ok()); // nothing on PATH

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('fail');
    expect(agent.severity).toBe('required');
    for (const id of Object.keys(AGENT_BINARIES)) {
      expect(agent.detail).toContain(id);
    }
  });

  it('a bare-name configured agent probes its binary without any model handling', async () => {
    await writeConfig('agent: claude');
    const deps = depsWith(CLAUDE_BIN);

    const report = runDoctorChecks(deps, projectRoot);
    const agent = check(report, 'agent');

    expect(agent.status).toBe('pass');
    expect(report.checks.some((c) => /model/i.test(c.id))).toBe(false);
  });

  it('a per-stage map missing one configured binary fails naming that agent', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.ratchet', 'config.yaml'),
      'schema: ratchet\nbatch:\n  agent:\n    propose: claude:fable\n    apply: opencode:zai/glm-5.2\n',
      'utf-8'
    );
    const deps = depsWith(CLAUDE_BIN); // opencode (apply) missing

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('fail');
    expect(agent.detail).toContain('opencode');
    // The present configured agent is not framed as missing.
    expect(agent.detail).not.toMatch(/claude/);
  });

  it('a configured agent whose id differs from its binary names both in the failure', async () => {
    await writeConfig('agent: cursor:some-model');
    const deps = depsWith(CLAUDE_BIN); // cursor-agent missing

    const agent = check(runDoctorChecks(deps, projectRoot), 'agent');

    expect(agent.status).toBe('fail');
    expect(agent.detail).toContain('cursor');
    expect(agent.detail).toContain('cursor-agent');
  });
});
