import { describe, it, expect } from 'vitest';
import {
  runDoctorChecks,
  type DoctorReport,
} from '../../../src/core/doctor/index.js';
import {
  serializeReport,
  exitCodeFor,
} from '../../../src/core/doctor/render.js';
import { AGENT_BINARIES } from '../../../src/core/batch/engine/agent.js';
import type {
  BootstrapDeps,
  RunResult,
} from '../../../src/core/batch/engine/runtime/rex-bootstrap.js';

/**
 * In-memory fake of the side-effecting seams, mirroring the rex-bootstrap test
 * fake: `run` is driven by a programmable handler, PATH membership by a Set, and
 * fs methods are no-ops (doctor never touches the filesystem). No real process
 * or fs is touched.
 */
class FakeDeps implements BootstrapDeps {
  calls: { command: string; args: string[] }[] = [];
  toolsOnPath = new Set<string>();

  constructor(
    private handler: (command: string, args: string[]) => RunResult
  ) {}

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

/** Binaries for the real agent map (so tests track the source of truth). */
const AGENT_BINS = Object.values(AGENT_BINARIES);
const CLAUDE_BIN = AGENT_BINARIES.claude;
const CURSOR_BIN = AGENT_BINARIES.cursor;

function check(report: DoctorReport, id: string) {
  const c = report.checks.find((c) => c.id === id);
  if (!c) throw new Error(`no check '${id}'`);
  return c;
}

describe('runDoctorChecks', () => {
  it('all-pass: agent + uv runtime + docker present → ok, exit 0', () => {
    const deps = new FakeDeps((command, args) => {
      if (AGENT_BINS.includes(command) && args.includes('--version')) {
        return ok(`${command} 1.2.3`);
      }
      if (command === 'docker' && args[0] === 'info') return ok();
      return ok();
    });
    deps.toolsOnPath.add(CLAUDE_BIN);
    deps.toolsOnPath.add('uv');

    const report = runDoctorChecks(deps);

    expect(check(report, 'agent').status).toBe('pass');
    expect(check(report, 'runtime').status).toBe('pass');
    expect(check(report, 'docker').status).toBe('pass');
    expect(report.ok).toBe(true);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('no-agent-fail: no agent binary on PATH → required fail, non-zero, lists supported', () => {
    const deps = new FakeDeps(() => ok());
    deps.toolsOnPath.add('uv'); // runtime fine, only agent missing

    const report = runDoctorChecks(deps);
    const agent = check(report, 'agent');

    expect(agent.status).toBe('fail');
    expect(agent.severity).toBe('required');
    expect(agent.remedy).toBeDefined();
    // Lists every supported agent id.
    for (const id of Object.keys(AGENT_BINARIES)) {
      expect(agent.detail).toContain(id);
    }
    expect(report.ok).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('checks every agent, not just the default: a non-default agent satisfies it', () => {
    const deps = new FakeDeps((command, args) => {
      if (command === CURSOR_BIN && args.includes('--version')) return ok('cursor 0.9.0');
      return ok();
    });
    deps.toolsOnPath.add(CURSOR_BIN); // only cursor, NOT the default claude
    deps.toolsOnPath.add('uv');

    const report = runDoctorChecks(deps);
    const agent = check(report, 'agent');

    expect(agent.status).toBe('pass');
    expect(agent.detail).toContain('cursor');
  });

  it('reports the resolved version of an installed agent', () => {
    const deps = new FakeDeps((command, args) => {
      if (command === CLAUDE_BIN && args.includes('--version')) return ok('claude version 3.4.5');
      return ok();
    });
    deps.toolsOnPath.add(CLAUDE_BIN);
    deps.toolsOnPath.add('uv');

    const agent = check(runDoctorChecks(deps), 'agent');
    expect(agent.status).toBe('pass');
    expect(agent.detail).toContain('3.4.5');
  });

  it('version-probe-failure: present binary whose probe errors is still detected (unknown version)', () => {
    const deps = new FakeDeps((command, args) => {
      if (command === CLAUDE_BIN && args.includes('--version')) return fail('crashed');
      return ok();
    });
    deps.toolsOnPath.add(CLAUDE_BIN);
    deps.toolsOnPath.add('uv');

    const agent = check(runDoctorChecks(deps), 'agent');
    expect(agent.status).toBe('pass');
    expect(agent.detail.toLowerCase()).toContain('unknown');
  });

  it('uv-preferred: uv present is reported as the preferred provider', () => {
    const deps = new FakeDeps(() => ok());
    deps.toolsOnPath.add(CLAUDE_BIN);
    deps.toolsOnPath.add('uv');

    const runtime = check(runDoctorChecks(deps), 'runtime');
    expect(runtime.status).toBe('pass');
    expect(runtime.detail.toLowerCase()).toContain('uv');
    expect(runtime.detail.toLowerCase()).toContain('preferred');
  });

  it('python-runtime: Python 3.10+ with venv and pip satisfies the requirement when uv absent', () => {
    const deps = new FakeDeps((command, args) => {
      if (args.includes('--version')) return ok('Python 3.12.1');
      if (args[0] === '-c') return ok(); // venv/pip import succeeds
      return ok();
    });
    deps.toolsOnPath.add(CLAUDE_BIN);
    // no uv on PATH

    const runtime = check(runDoctorChecks(deps), 'runtime');
    expect(runtime.status).toBe('pass');
    expect(runtime.detail).toContain('3.12');
  });

  it('old-python-fail: only Python < 3.10 → required fail, states minimum, non-zero', () => {
    const deps = new FakeDeps((command, args) => {
      if (args.includes('--version')) {
        // Only python3 resolves, and it is too old.
        return command === 'python3' ? ok('Python 3.8.10') : fail();
      }
      return ok();
    });
    deps.toolsOnPath.add(CLAUDE_BIN);

    const report = runDoctorChecks(deps);
    const runtime = check(report, 'runtime');
    expect(runtime.status).toBe('fail');
    expect(runtime.severity).toBe('required');
    expect(runtime.detail).toContain('3.10');
    expect(report.ok).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('no-runtime-fail: neither uv nor any Python → required fail with remedy, non-zero', () => {
    const deps = new FakeDeps(() => fail()); // every probe fails (no interpreter)
    deps.toolsOnPath.add(CLAUDE_BIN);

    const report = runDoctorChecks(deps);
    const runtime = check(report, 'runtime');
    expect(runtime.status).toBe('fail');
    expect(runtime.remedy).toBeDefined();
    expect(report.ok).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('docker-optional-info: missing docker is informational and never fails doctor', () => {
    const deps = new FakeDeps((command, args) => {
      if (command === 'docker' && args[0] === 'info') return fail('cannot connect');
      if (args.includes('--version')) return ok(`${command} 1.0.0`);
      return ok();
    });
    deps.toolsOnPath.add(CLAUDE_BIN);
    deps.toolsOnPath.add('uv');

    const report = runDoctorChecks(deps);
    const docker = check(report, 'docker');
    expect(docker.status).toBe('info');
    expect(docker.severity).toBe('optional');
    expect(docker.detail.toLowerCase()).toContain('docker execution locus');
    // Optional notice never affects the overall verdict.
    expect(report.ok).toBe(true);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('--json shape: a single object listing every check with status + severity', () => {
    const deps = new FakeDeps(() => ok());
    deps.toolsOnPath.add(CLAUDE_BIN);
    deps.toolsOnPath.add('uv');

    const json = serializeReport(runDoctorChecks(deps));
    const parsed = JSON.parse(json);

    expect(typeof parsed).toBe('object');
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed).toHaveProperty('ok');
    for (const c of parsed.checks) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('status');
      expect(c).toHaveProperty('severity');
    }
    const ids = parsed.checks.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(['agent', 'docker', 'runtime']);
  });
});

describe('AGENT_BINARIES (single source of truth)', () => {
  it('covers every batch-capable agent and maps cursor to cursor-agent', () => {
    expect(AGENT_BINARIES).toMatchObject({
      claude: 'claude',
      codex: 'codex',
      gemini: 'gemini',
      cursor: 'cursor-agent',
    });
  });
});
