import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  bootstrapRexRuntime,
  findPython,
  preflightDockerDaemon,
  resolveSidecarPath,
  resolveCacheHome,
  RexBootstrapError,
  SWE_REX_VERSION,
  DEFAULT_DOCKER_IMAGE,
  DOCKER_EXTRA,
  type BootstrapDeps,
  type RunResult,
} from '../../src/core/batch/engine/runtime/rex-bootstrap.js';

/**
 * A fully in-memory fake of the side-effecting seams. No real process or fs is
 * touched: `run` is driven by a programmable handler, fs lives in a Map.
 */
class FakeDeps implements BootstrapDeps {
  files = new Map<string, string>();
  dirs = new Set<string>();
  calls: { command: string; args: string[] }[] = [];
  toolsOnPath = new Set<string>();

  constructor(
    private handler: (command: string, args: string[], self: FakeDeps) => RunResult
  ) {}

  run(command: string, args: string[]): RunResult {
    this.calls.push({ command, args });
    return this.handler(command, args, this);
  }
  hasOnPath(tool: string): boolean {
    return this.toolsOnPath.has(tool);
  }
  exists(p: string): boolean {
    return this.files.has(p) || this.dirs.has(p);
  }
  readText(p: string): string {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  writeText(p: string, content: string): void {
    this.files.set(p, content);
    this.dirs.add(path.dirname(p));
  }
  mkdirp(p: string): void {
    this.dirs.add(p);
  }
  rmrf(p: string): void {
    this.dirs.delete(p);
    for (const key of [...this.files.keys()]) {
      if (key === p || key.startsWith(p + path.sep)) this.files.delete(key);
    }
    for (const key of [...this.dirs]) {
      if (key === p || key.startsWith(p + path.sep)) this.dirs.delete(key);
    }
  }
}

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
const fail = (stderr = 'boom'): RunResult => ({ status: 1, stdout: '', stderr });

const CACHE = '/tmp/fake-cache';
const VENV_PYTHON = path.join(CACHE, 'ratchet', 'rex', 'venv', 'bin', 'python');

/**
 * A handler that makes a fresh build succeed end to end. A successful venv
 * creation must materialize the interpreter file (the real uv/venv would), so
 * the readiness check can later see it.
 */
function happyHandler(command: string, args: string[], self: FakeDeps): RunResult {
  if (args.includes('--version')) return ok('Python 3.12.1');
  if (command === 'uv' && args[0] === 'venv') {
    self.writeText(VENV_PYTHON, '#!/bin/sh');
    return ok();
  }
  if (args[0] === '-m' && args[1] === 'venv') {
    self.writeText(VENV_PYTHON, '#!/bin/sh');
    return ok();
  }
  if (command === 'uv' && args[0] === 'pip') return ok();
  if (args.includes('import swerex')) return ok();
  return ok();
}

describe('resolveSidecarPath', () => {
  it('resolves sidecar.py as a sibling of the compiled module', () => {
    const p = resolveSidecarPath();
    expect(path.basename(p)).toBe('sidecar.py');
    // Sibling of this module's runtime/ dir (works from src and dist alike).
    expect(path.dirname(p).endsWith(path.join('engine', 'runtime'))).toBe(true);
  });
});

describe('resolveCacheHome', () => {
  it('honors an explicit override under ratchet/rex', () => {
    expect(resolveCacheHome('/x/cache')).toBe(path.join('/x/cache', 'ratchet', 'rex'));
  });
});

describe('findPython', () => {
  it('returns the first candidate meeting the minimum version', () => {
    const deps = new FakeDeps((cmd) =>
      cmd === 'python3' ? ok('Python 3.11.9') : fail()
    );
    expect(findPython(deps)).toBe('python3');
  });

  it('rejects a too-old Python and throws an actionable error', () => {
    const deps = new FakeDeps((cmd, args) =>
      args.includes('--version') ? ok('Python 3.8.10') : fail()
    );
    expect(() => findPython(deps)).toThrow(RexBootstrapError);
    try {
      findPython(deps);
    } catch (e: any) {
      expect(e.message).toContain('3.10');
      expect(e.message.toLowerCase()).toContain('install');
    }
  });

  it('throws when no interpreter is found at all', () => {
    const deps = new FakeDeps(() => fail());
    expect(() => findPython(deps)).toThrow(/no Python interpreter/i);
  });

  it('respects an explicit override', () => {
    const deps = new FakeDeps((cmd) =>
      cmd === '/opt/py/bin/python' ? ok('Python 3.13.0') : fail()
    );
    expect(findPython(deps, '/opt/py/bin/python')).toBe('/opt/py/bin/python');
  });
});

describe('bootstrapRexRuntime — build (uv vs pip)', () => {
  it('uses uv when available and returns a resolved launch command', () => {
    const deps = new FakeDeps(happyHandler);
    deps.toolsOnPath.add('uv');

    const launch = bootstrapRexRuntime({ cacheHome: CACHE, deps });

    const usedUv = deps.calls.some((c) => c.command === 'uv' && c.args[0] === 'venv');
    expect(usedUv).toBe(true);
    expect(launch.args[0]).toBe(resolveSidecarPath());
    expect(launch.command).toContain(path.join('ratchet', 'rex', 'venv'));
    // venv bin is prepended to PATH.
    expect(launch.env.PATH?.startsWith(path.join(CACHE, 'ratchet', 'rex', 'venv'))).toBe(
      true
    );
    // Success marker records the pinned version.
    const markerPath = path.join(CACHE, 'ratchet', 'rex', 'venv', '.ratchet-rex-ready.json');
    expect(JSON.parse(deps.readText(markerPath)).sweRexVersion).toBe(SWE_REX_VERSION);
  });

  it('falls back to python -m venv + pip when uv is absent', () => {
    const deps = new FakeDeps(happyHandler);
    // uv NOT on path
    bootstrapRexRuntime({ cacheHome: CACHE, deps });

    const usedVenvModule = deps.calls.some(
      (c) => c.args[0] === '-m' && c.args[1] === 'venv'
    );
    const usedPip = deps.calls.some(
      (c) => c.args.includes('pip') && c.args.includes('install')
    );
    const usedUv = deps.calls.some((c) => c.command === 'uv');
    expect(usedVenvModule).toBe(true);
    expect(usedPip).toBe(true);
    expect(usedUv).toBe(false);
  });

  it('passes REX_LOCUS/REX_WORKDIR through to the launch env', () => {
    const deps = new FakeDeps(happyHandler);
    const launch = bootstrapRexRuntime({
      cacheHome: CACHE,
      deps,
      locus: 'local',
      workdir: '/tmp/runs',
    });
    expect(launch.env.REX_LOCUS).toBe('local');
    expect(launch.env.REX_WORKDIR).toBe('/tmp/runs');
  });
});

describe('bootstrapRexRuntime — cache / idempotency', () => {
  it('reuses a ready venv without rebuilding', () => {
    const deps = new FakeDeps(happyHandler);
    deps.toolsOnPath.add('uv');
    bootstrapRexRuntime({ cacheHome: CACHE, deps }); // first build
    const callsAfterBuild = deps.calls.length;

    bootstrapRexRuntime({ cacheHome: CACHE, deps }); // second invocation
    const rebuilt = deps.calls
      .slice(callsAfterBuild)
      .some((c) => c.args.includes('venv') || c.args.includes('install'));
    expect(rebuilt).toBe(false);
  });

  it('rebuilds when the marker is missing', () => {
    const deps = new FakeDeps(happyHandler);
    deps.toolsOnPath.add('uv');
    bootstrapRexRuntime({ cacheHome: CACHE, deps });

    const markerPath = path.join(
      CACHE,
      'ratchet',
      'rex',
      'venv',
      '.ratchet-rex-ready.json'
    );
    deps.files.delete(markerPath); // simulate incomplete/cleared cache
    const before = deps.calls.length;
    bootstrapRexRuntime({ cacheHome: CACHE, deps });
    const rebuilt = deps.calls
      .slice(before)
      .some((c) => c.command === 'uv' && c.args[0] === 'venv');
    expect(rebuilt).toBe(true);
  });

  it('rebuilds when the marker records a different pinned version (stale)', () => {
    const deps = new FakeDeps(happyHandler);
    deps.toolsOnPath.add('uv');
    bootstrapRexRuntime({ cacheHome: CACHE, deps });

    const markerPath = path.join(
      CACHE,
      'ratchet',
      'rex',
      'venv',
      '.ratchet-rex-ready.json'
    );
    deps.writeText(markerPath, JSON.stringify({ sweRexVersion: '0.0.1' }));
    const before = deps.calls.length;
    bootstrapRexRuntime({ cacheHome: CACHE, deps });
    const rebuilt = deps.calls
      .slice(before)
      .some((c) => c.command === 'uv' && c.args[0] === 'venv');
    expect(rebuilt).toBe(true);
  });
});

describe('bootstrapRexRuntime — actionable failures', () => {
  it('throws RexBootstrapError when no suitable Python exists', () => {
    const deps = new FakeDeps(() => fail());
    expect(() => bootstrapRexRuntime({ cacheHome: CACHE, deps })).toThrow(
      RexBootstrapError
    );
  });

  it('reports an install failure and leaves no ready marker', () => {
    const deps = new FakeDeps((command, args) => {
      if (args.includes('--version')) return ok('Python 3.12.0');
      if (command === 'uv' && args[0] === 'venv') return ok();
      if (command === 'uv' && args[0] === 'pip') return fail('Network unreachable');
      return ok();
    });
    deps.toolsOnPath.add('uv');

    expect(() => bootstrapRexRuntime({ cacheHome: CACHE, deps })).toThrow(
      /installing swe-rex/i
    );
    // No partial venv mistaken for usable: the dir was cleared.
    const markerPath = path.join(
      CACHE,
      'ratchet',
      'rex',
      'venv',
      '.ratchet-rex-ready.json'
    );
    expect(deps.exists(markerPath)).toBe(false);
  });

  it('reports a venv-create failure distinctly from an install failure', () => {
    const deps = new FakeDeps((command, args) => {
      if (args.includes('--version')) return ok('Python 3.12.0');
      if (command === 'uv' && args[0] === 'venv') return fail('cannot create venv');
      return ok();
    });
    deps.toolsOnPath.add('uv');
    expect(() => bootstrapRexRuntime({ cacheHome: CACHE, deps })).toThrow(
      /creating the venv/i
    );
  });

  it('rejects an install that does not import (not cached as ready)', () => {
    const deps = new FakeDeps((command, args) => {
      if (args.includes('--version')) return ok('Python 3.12.0');
      if (command === 'uv') return ok();
      if (args.includes('import swerex')) return fail('ModuleNotFoundError');
      return ok();
    });
    deps.toolsOnPath.add('uv');
    expect(() => bootstrapRexRuntime({ cacheHome: CACHE, deps })).toThrow(
      /does not import/i
    );
  });
});

describe('preflightDockerDaemon (no-Docker, fail closed)', () => {
  it('returns silently when `docker info` succeeds', () => {
    const deps = new FakeDeps((cmd, args) =>
      cmd === 'docker' && args[0] === 'info' ? ok('Server: ...') : fail()
    );
    expect(() => preflightDockerDaemon(deps)).not.toThrow();
  });

  it('throws an actionable RexBootstrapError naming locus=docker when the daemon is down', () => {
    const deps = new FakeDeps((cmd, args) =>
      cmd === 'docker' && args[0] === 'info'
        ? { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' }
        : fail()
    );
    expect(() => preflightDockerDaemon(deps)).toThrow(RexBootstrapError);
    try {
      preflightDockerDaemon(deps);
    } catch (e: any) {
      expect(e.message).toContain('locus=docker');
      expect(e.message.toLowerCase()).toContain('install docker');
      expect(e.message).toContain('docker info');
    }
  });
});

describe('bootstrapRexRuntime — docker locus', () => {
  /** A handler that makes a docker bootstrap succeed end to end. */
  function dockerHappy(command: string, args: string[], self: FakeDeps): RunResult {
    if (command === 'docker' && args[0] === 'info') return ok('Server: ...');
    if (args.includes('--version')) return ok('Python 3.12.1');
    if (command === 'uv' && args[0] === 'venv') {
      self.writeText(VENV_PYTHON, '#!/bin/sh');
      return ok();
    }
    if (args[0] === '-m' && args[1] === 'venv') {
      self.writeText(VENV_PYTHON, '#!/bin/sh');
      return ok();
    }
    if (command === 'uv' && args[0] === 'pip') return ok();
    if (args.some((a) => a.includes('import swerex'))) return ok();
    return ok();
  }

  it('runs the docker daemon pre-flight FIRST and fails closed before any venv work', () => {
    const deps = new FakeDeps((cmd, args) =>
      cmd === 'docker' && args[0] === 'info'
        ? { status: 1, stdout: '', stderr: 'daemon down' }
        : ok()
    );
    deps.toolsOnPath.add('uv');
    expect(() =>
      bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'docker' })
    ).toThrow(/locus=docker/);
    // No venv was built (no `uv venv` call) — we failed before touching it.
    expect(deps.calls.some((c) => c.command === 'uv' && c.args[0] === 'venv')).toBe(false);
  });

  it('installs aiohttp (the docker dep swe-rex under-declares) and records the docker extra', () => {
    const deps = new FakeDeps(dockerHappy);
    deps.toolsOnPath.add('uv');
    bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'docker' });

    // swe-rex 1.4.0 has NO `docker` extra; `swerex.deployment.docker` needs
    // `aiohttp` (undeclared), so we install it explicitly alongside the base —
    // NOT a `swe-rex[docker]` extra (which would be a silent no-op).
    const installCall = deps.calls.find(
      (c) => c.args.includes('pip') && c.args.includes('install')
    );
    expect(installCall?.args).toContain('aiohttp');
    expect(installCall?.args.some((a) => a.includes('swe-rex==') )).toBe(true);
    expect(installCall?.args.some((a) => a.includes('swe-rex[docker]'))).toBe(false);

    const markerPath = path.join(CACHE, 'ratchet', 'rex', 'venv', '.ratchet-rex-ready.json');
    const marker = JSON.parse(deps.readText(markerPath));
    expect(marker.extras).toContain(DOCKER_EXTRA);
  });

  it('passes REX_IMAGE (configured) and REX_MOUNT_* through to the launch env', () => {
    const deps = new FakeDeps(dockerHappy);
    deps.toolsOnPath.add('uv');
    const launch = bootstrapRexRuntime({
      cacheHome: CACHE,
      deps,
      locus: 'docker',
      workdir: '/workspace',
      image: 'my/image:tag',
      mountHost: '/host/project',
      mountContainer: '/workspace',
    });
    expect(launch.env.REX_LOCUS).toBe('docker');
    expect(launch.env.REX_WORKDIR).toBe('/workspace');
    expect(launch.env.REX_IMAGE).toBe('my/image:tag');
    expect(launch.env.REX_MOUNT_HOST).toBe('/host/project');
    expect(launch.env.REX_MOUNT_CONTAINER).toBe('/workspace');
  });

  it('defaults REX_IMAGE to DEFAULT_DOCKER_IMAGE when no image is configured', () => {
    const deps = new FakeDeps(dockerHappy);
    deps.toolsOnPath.add('uv');
    const launch = bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'docker' });
    expect(launch.env.REX_IMAGE).toBe(DEFAULT_DOCKER_IMAGE);
  });

  it('rebuilds a local-only venv when the docker locus is first requested', () => {
    // First build a LOCAL venv (marker records no extras).
    const deps = new FakeDeps(dockerHappy);
    deps.toolsOnPath.add('uv');
    bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'local' });
    const markerPath = path.join(CACHE, 'ratchet', 'rex', 'venv', '.ratchet-rex-ready.json');
    expect(JSON.parse(deps.readText(markerPath)).extras).toEqual([]);

    const before = deps.calls.length;
    // Now request docker → the local-only venv is NOT ready, so it rebuilds.
    bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'docker' });
    const rebuilt = deps.calls
      .slice(before)
      .some((c) => c.command === 'uv' && c.args[0] === 'venv');
    expect(rebuilt).toBe(true);
    expect(JSON.parse(deps.readText(markerPath)).extras).toContain(DOCKER_EXTRA);
  });

  it('reuses a docker-capable venv for both docker and local (superset)', () => {
    const deps = new FakeDeps(dockerHappy);
    deps.toolsOnPath.add('uv');
    bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'docker' }); // build docker-capable
    const afterBuild = deps.calls.length;

    bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'docker' });
    bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'local' });
    const rebuilt = deps.calls
      .slice(afterBuild)
      .some((c) => c.args.includes('venv') || c.args.includes('install'));
    expect(rebuilt).toBe(false);
  });

  it('does not run the docker pre-flight or set image/mount env for local', () => {
    const deps = new FakeDeps(happyHandler);
    deps.toolsOnPath.add('uv');
    const launch = bootstrapRexRuntime({ cacheHome: CACHE, deps, locus: 'local' });
    expect(deps.calls.some((c) => c.command === 'docker')).toBe(false);
    expect(launch.env.REX_IMAGE).toBeUndefined();
    expect(launch.env.REX_MOUNT_HOST).toBeUndefined();
    expect(launch.env.REX_MOUNT_CONTAINER).toBeUndefined();
  });
});
