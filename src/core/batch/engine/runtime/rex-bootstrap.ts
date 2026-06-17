/**
 * ReX runtime bootstrap.
 *
 * The ReX sidecar (sidecar.py) needs a Python with `swe-rex` importable. We must
 * NOT touch the user's global Python; instead we build an isolated, ratchet-owned
 * venv under the OS cache dir, install a PINNED `swe-rex`, cache it, and return a
 * resolved `{ command, args, env }` the Node side uses to launch the sidecar.
 *
 * Properties:
 *  - Isolated: venv lives under `$XDG_CACHE_HOME`/`~/.cache` → `ratchet/rex/venv`.
 *  - Reproducible: a single pinned swe-rex version (SWE_REX_VERSION).
 *  - Fast builder when available: prefer `uv`, fall back to `python -m venv` + pip.
 *  - Lazy + idempotent: built on first use; a success MARKER (recording the pinned
 *    version) is written LAST, so a partial venv is never mistaken for ready. A
 *    rebuild clears the dir first. A cache hit returns the launch command quickly.
 *  - Actionable errors: a dedicated `RexBootstrapError` names what failed and the
 *    remedy — never a hang, never a raw traceback.
 *
 * All side-effecting work goes through injectable seams (`BootstrapDeps`) so the
 * logic is unit-testable without a real network or venv.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DEFAULT_DOCKER_IMAGE } from '../../config.js';

/**
 * The single pinned swe-rex version. Verified resolvable + importable in the
 * spike (swerex.__version__ == 1.4.0). Bump deliberately; the marker records it
 * so a change here forces a rebuild.
 */
export const SWE_REX_VERSION = '1.4.0';

/** Minimum acceptable Python (swe-rex requires modern asyncio/typing). */
export const MIN_PYTHON = { major: 3, minor: 10 } as const;

/**
 * Default container image for `locus: docker` when none is configured.
 * Single TS source of truth: re-exported from config.ts so the Node side never
 * drifts. The Python sidecar keeps its OWN constant (`DEFAULT_DOCKER_IMAGE` in
 * sidecar.py) as a pure unset-fallback because it cannot import TS — that copy
 * is only reached when `REX_IMAGE` is unset, which Node always threads; the
 * cross-language sync is noted there.
 */
export { DEFAULT_DOCKER_IMAGE };

/**
 * The `docker` extra label recorded in the readiness marker. The docker locus
 * needs `aiohttp` (which base swe-rex omits and no swe-rex extra declares — see
 * EXTRA_PACKAGES), so a local-only venv must be REBUILT the first time docker is
 * requested. The marker records which extras are installed so the readiness
 * check can detect a local-only venv and force a docker-capable rebuild.
 */
export const DOCKER_EXTRA = 'docker';

/** Candidate interpreter commands probed, in order, when no override is given. */
const PYTHON_CANDIDATES = ['python3', 'python', 'python3.12', 'python3.11', 'python3.10'];

/** A resolved command to launch the sidecar. */
export interface ResolvedLaunch {
  /** The venv's Python interpreter (absolute path). */
  command: string;
  /** Arguments — the resolved sidecar.py path. */
  args: string[];
  /** Environment for the sidecar (REX_* passthrough + venv on PATH). */
  env: NodeJS.ProcessEnv;
}

/** Actionable bootstrap failure: a clear message + remedy, never a raw trace. */
export class RexBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RexBootstrapError';
  }
}

/** Result of running an external command through the injected runner. */
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Injectable side-effect seams. Tests provide fakes so no real process/fs runs.
 */
export interface BootstrapDeps {
  /** Run a command; never throws on non-zero — returns the status. */
  run(command: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }): RunResult;
  /** Is a tool resolvable on PATH (e.g. `uv`)? */
  hasOnPath(tool: string): boolean;
  exists(p: string): boolean;
  readText(p: string): string;
  writeText(p: string, content: string): void;
  mkdirp(p: string): void;
  rmrf(p: string): void;
}

export interface BootstrapOptions {
  /** Override the cache home (defaults to XDG_CACHE_HOME / ~/.cache). */
  cacheHome?: string;
  /** Force a specific Python interpreter, skipping the candidate probe. */
  pythonOverride?: string;
  /** REX_LOCUS to pass through to the sidecar (default inherits/local). */
  locus?: string;
  /** REX_WORKDIR to pass through to the sidecar. */
  workdir?: string;
  /**
   * REX_IMAGE to pass through (docker locus only). The container image the ReX
   * `DockerDeployment` runs; ignored for `local`.
   */
  image?: string;
  /** REX_MOUNT_HOST to pass through (docker locus only): host path to bind-mount. */
  mountHost?: string;
  /** REX_MOUNT_CONTAINER to pass through (docker locus only): in-container mount point. */
  mountContainer?: string;
  /** Injected seams; defaults to the real fs/child_process. */
  deps?: BootstrapDeps;
}

// -----------------------------------------------------------------------------
// Default (real) deps
// -----------------------------------------------------------------------------

function realRun(
  command: string,
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv }
): RunResult {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf-8',
      env: opts?.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      status: typeof err?.status === 'number' ? err.status : null,
      stdout: err?.stdout?.toString?.() ?? '',
      stderr: err?.stderr?.toString?.() ?? err?.message ?? '',
    };
  }
}

export const defaultDeps: BootstrapDeps = {
  run: realRun,
  hasOnPath(tool: string): boolean {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return realRun(probe, [tool]).status === 0;
  },
  exists: (p) => existsSync(p),
  readText: (p) => readFileSync(p, 'utf-8'),
  writeText: (p, content) => writeFileSync(p, content),
  mkdirp: (p) => {
    mkdirSync(p, { recursive: true });
  },
  rmrf: (p) => {
    rmSync(p, { recursive: true, force: true });
  },
};

// -----------------------------------------------------------------------------
// Path resolution
// -----------------------------------------------------------------------------

/**
 * Resolve sidecar.py relative to the COMPILED module location. This file lives at
 * `dist/core/batch/engine/runtime/rex-bootstrap.js` after build (build.js copies
 * sidecar.py beside it), and at `src/.../runtime/rex-bootstrap.ts` for tests —
 * sidecar.py is a sibling in both, so `import.meta.url` + sibling name works for
 * both `dist` (packaged) and `src` (tests).
 */
export function resolveSidecarPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'sidecar.py');
}

/** The ratchet-owned ReX cache root (NOT global Python). */
export function resolveCacheHome(override?: string): string {
  const base =
    override ??
    process.env.XDG_CACHE_HOME ??
    path.join(os.homedir(), '.cache');
  return path.join(base, 'ratchet', 'rex');
}

// -----------------------------------------------------------------------------
// Python discovery
// -----------------------------------------------------------------------------

/** Parse a `Python 3.11.4` version banner; returns null if unparseable. */
function parsePythonVersion(output: string): { major: number; minor: number } | null {
  const m = output.match(/Python\s+(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

function meetsMinimum(v: { major: number; minor: number }): boolean {
  if (v.major > MIN_PYTHON.major) return true;
  return v.major === MIN_PYTHON.major && v.minor >= MIN_PYTHON.minor;
}

/**
 * Find a usable Python (>= MIN_PYTHON). Probes candidates (or the override) and
 * returns the first that reports a high-enough version. Throws an actionable
 * `RexBootstrapError` when none qualifies.
 */
export function findPython(deps: BootstrapDeps, override?: string): string {
  const candidates = override ? [override] : PYTHON_CANDIDATES;
  let sawSomething = false;
  for (const candidate of candidates) {
    const res = deps.run(candidate, ['--version']);
    if (res.status !== 0) continue;
    sawSomething = true;
    const version = parsePythonVersion(res.stdout || res.stderr);
    if (version && meetsMinimum(version)) {
      return candidate;
    }
  }

  const required = `${MIN_PYTHON.major}.${MIN_PYTHON.minor}`;
  const reason = sawSomething
    ? `found Python, but none was >= ${required}`
    : `no Python interpreter was found on PATH`;
  throw new RexBootstrapError(
    `ReX runtime bootstrap: ${reason}. ratchet needs Python ${required} or newer ` +
      `to run the SWE-ReX sidecar. Install it (e.g. \`brew install python@3.12\` ` +
      `or from https://www.python.org/downloads/) and ensure \`python3\` is on PATH, ` +
      `or point ratchet at a specific interpreter via the pythonOverride option.`
  );
}

// -----------------------------------------------------------------------------
// venv layout + marker
// -----------------------------------------------------------------------------

interface VenvLayout {
  cacheHome: string;
  venvDir: string;
  /** The venv's Python interpreter. */
  venvPython: string;
  /** The venv's bin dir (added to PATH). */
  binDir: string;
  /** Success marker, written LAST. */
  markerPath: string;
}

function venvLayout(cacheHome: string): VenvLayout {
  const venvDir = path.join(cacheHome, 'venv');
  const binDir =
    process.platform === 'win32'
      ? path.join(venvDir, 'Scripts')
      : path.join(venvDir, 'bin');
  const venvPython =
    process.platform === 'win32'
      ? path.join(binDir, 'python.exe')
      : path.join(binDir, 'python');
  return {
    cacheHome,
    venvDir,
    venvPython,
    binDir,
    markerPath: path.join(venvDir, '.ratchet-rex-ready.json'),
  };
}

/**
 * A venv is ready iff its marker exists, records the current pinned version, AND
 * carries every required extra. A local-only marker (no `docker` extra) is
 * treated as NOT ready when the docker locus is requested, forcing a
 * docker-capable rebuild on first docker use; `local` requires no extras so a
 * docker-capable venv (a superset) is always reusable for local.
 */
function isReady(
  deps: BootstrapDeps,
  layout: VenvLayout,
  requiredExtras: readonly string[] = []
): boolean {
  if (!deps.exists(layout.venvDir)) return false;
  if (!deps.exists(layout.venvPython)) return false;
  if (!deps.exists(layout.markerPath)) return false;
  try {
    const marker = JSON.parse(deps.readText(layout.markerPath));
    if (marker?.sweRexVersion !== SWE_REX_VERSION) return false;
    const have: string[] = Array.isArray(marker?.extras) ? marker.extras : [];
    return requiredExtras.every((extra) => have.includes(extra));
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// venv build
// -----------------------------------------------------------------------------

const SWE_REX_SPEC = `swe-rex==${SWE_REX_VERSION}`;

/**
 * Extra pip packages a requested capability needs that swe-rex fails to declare.
 *
 * swe-rex 1.4.0 ships NO `docker` extra (its only extras are dev/modal/fargate/
 * daytona), yet `swerex.deployment.docker` imports `aiohttp` (the docker
 * deployment talks to the in-container server over HTTP via RemoteRuntime).
 * `aiohttp` is an UNDECLARED transitive dependency, so `swe-rex[docker]` resolves
 * to an unknown extra and a silent no-op. We therefore install `aiohttp`
 * explicitly alongside the pinned base for the docker locus.
 */
const EXTRA_PACKAGES: Record<string, readonly string[]> = {
  [DOCKER_EXTRA]: ['aiohttp'],
};

/**
 * The pip install specs: the pinned swe-rex base plus any packages required by
 * the requested extras (which swe-rex under-declares — see {@link EXTRA_PACKAGES}).
 */
function installSpecs(extras: readonly string[]): string[] {
  const specs = [SWE_REX_SPEC];
  for (const extra of [...extras].sort()) {
    specs.push(...(EXTRA_PACKAGES[extra] ?? []));
  }
  return specs;
}

/**
 * Build the venv from scratch and install the pinned swe-rex (with any required
 * extras). Clears any prior (possibly partial) dir first, writes the success
 * marker LAST. Prefers `uv`, falls back to `python -m venv` + that venv's pip.
 * Throws `RexBootstrapError` naming the failing stage (venv creation vs install)
 * with a remedy.
 */
function buildVenv(
  deps: BootstrapDeps,
  python: string,
  layout: VenvLayout,
  extras: readonly string[] = []
): void {
  const specs = installSpecs(extras);
  // Clear any half-built state so nothing stale is mistaken for usable.
  deps.rmrf(layout.venvDir);
  deps.mkdirp(layout.cacheHome);

  const useUv = deps.hasOnPath('uv');

  if (useUv) {
    const created = deps.run('uv', ['venv', layout.venvDir, '-p', python]);
    if (created.status !== 0) {
      deps.rmrf(layout.venvDir);
      throw new RexBootstrapError(
        venvFailMessage('creating the venv (uv venv)', created.stderr)
      );
    }
    const installed = deps.run('uv', [
      'pip',
      'install',
      '--python',
      layout.venvPython,
      ...specs,
    ]);
    if (installed.status !== 0) {
      deps.rmrf(layout.venvDir);
      throw new RexBootstrapError(
        installFailMessage(installed.stderr)
      );
    }
  } else {
    const created = deps.run(python, ['-m', 'venv', layout.venvDir]);
    if (created.status !== 0) {
      deps.rmrf(layout.venvDir);
      throw new RexBootstrapError(
        venvFailMessage('creating the venv (python -m venv)', created.stderr)
      );
    }
    const installed = deps.run(layout.venvPython, [
      '-m',
      'pip',
      'install',
      ...specs,
    ]);
    if (installed.status !== 0) {
      deps.rmrf(layout.venvDir);
      throw new RexBootstrapError(installFailMessage(installed.stderr));
    }
  }

  // Verify swe-rex actually imports from the venv interpreter before declaring
  // success — a non-importable install must not be cached as ready. For the
  // docker extra, also verify the docker deployment module imports (it pulls
  // `aiohttp`, which the base install omits) so a missing extra is caught here,
  // not at run time.
  const importCheck = extras.includes(DOCKER_EXTRA)
    ? 'import swerex; import swerex.deployment.docker'
    : 'import swerex';
  const check = deps.run(layout.venvPython, ['-c', importCheck]);
  if (check.status !== 0) {
    deps.rmrf(layout.venvDir);
    throw new RexBootstrapError(
      `ReX runtime bootstrap: installed ${specs.join(' ')} but it does not import ` +
        `from the venv interpreter. Detail: ${truncate(check.stderr)}`
    );
  }

  // Marker written LAST: only now is the venv considered ready. `extras` records
  // which swe-rex extras are installed so a local-only venv is rebuilt when the
  // docker locus is first requested.
  deps.writeText(
    layout.markerPath,
    JSON.stringify(
      {
        sweRexVersion: SWE_REX_VERSION,
        extras: [...extras].sort(),
        python,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function venvFailMessage(stage: string, detail: string): string {
  return (
    `ReX runtime bootstrap: failed while ${stage}. ` +
    `Check that the selected Python can create virtual environments. ` +
    `Detail: ${truncate(detail)}`
  );
}

function installFailMessage(detail: string): string {
  return (
    `ReX runtime bootstrap: failed installing ${SWE_REX_SPEC} into the venv. ` +
    `This usually means no network access or a blocked package index. ` +
    `Check your network/proxy, or install \`uv\` for a faster, more reliable ` +
    `install (https://docs.astral.sh/uv/). Detail: ${truncate(detail)}`
  );
}

function truncate(s: string, max = 800): string {
  const t = (s ?? '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// -----------------------------------------------------------------------------
// Docker daemon pre-flight (fail closed, no hang)
// -----------------------------------------------------------------------------

/**
 * Probe the Docker daemon BEFORE spawning the sidecar. `docker info` (a cheap
 * round-trip to the daemon) is the primary fail-fast check: when Docker is not
 * installed or the daemon is not running, it exits non-zero (or the binary is
 * missing), and we throw an actionable `RexBootstrapError` naming `locus=docker`.
 * The runtime catches `RexBootstrapError` and resolves a non-zero result with the
 * message in stderr, so the engine maps it to blocked/failed and stays resumable
 * — and we never wait on swe-rex's 180s `startup_timeout`.
 */
export function preflightDockerDaemon(deps: BootstrapDeps): void {
  const res = deps.run('docker', ['info']);
  if (res.status === 0) return;
  throw new RexBootstrapError(
    `Docker not available for locus=docker. ratchet needs a running Docker ` +
      `daemon to run the batch step in a container. Install Docker ` +
      `(https://docs.docker.com/get-docker/) and ensure the daemon is running ` +
      `(\`docker info\` should succeed), or set locus back to \`local\`. ` +
      `Detail: ${truncate(res.stderr || res.stdout || 'docker info failed')}`
  );
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Lazily ensure the ReX venv exists (reusing a valid cache) and return the
 * resolved command to launch the sidecar. Idempotent: a ready venv is reused
 * without a rebuild; a missing/stale venv is rebuilt after clearing the dir.
 *
 * Docker locus: a `docker info` pre-flight runs FIRST (fail closed, no hang),
 * and the venv must carry the `docker` extra (an explicit `aiohttp` install,
 * which swe-rex under-declares), which forces a rebuild of a local-only venv on
 * first docker use. The image +
 * mount env (`REX_IMAGE`/`REX_MOUNT_HOST`/`REX_MOUNT_CONTAINER`) is threaded to
 * the sidecar. `local` is unaffected: no docker probe, no extras, no image/mount.
 */
export function bootstrapRexRuntime(options: BootstrapOptions = {}): ResolvedLaunch {
  const deps = options.deps ?? defaultDeps;
  const cacheHome = resolveCacheHome(options.cacheHome);
  const layout = venvLayout(cacheHome);
  const isDocker = options.locus === 'docker';

  // Fail fast on a missing/stopped daemon before any venv work, so the docker
  // path never hangs and the error is in the same actionable channel as the
  // Python-prereq error.
  if (isDocker) {
    preflightDockerDaemon(deps);
  }

  const requiredExtras = isDocker ? [DOCKER_EXTRA] : [];

  if (!isReady(deps, layout, requiredExtras)) {
    const python = findPython(deps, options.pythonOverride);
    buildVenv(deps, python, layout, requiredExtras);
  }

  const sidecar = resolveSidecarPath();

  // Prepend the venv bin to PATH so the sidecar's interpreter + tooling resolve.
  const inheritedPath = process.env.PATH ?? '';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${layout.binDir}${path.delimiter}${inheritedPath}`,
    VIRTUAL_ENV: layout.venvDir,
  };
  if (options.locus !== undefined) env.REX_LOCUS = options.locus;
  if (options.workdir !== undefined) env.REX_WORKDIR = options.workdir;
  // Image + mount env is only meaningful for docker; local stays untouched.
  if (isDocker) {
    env.REX_IMAGE = options.image && options.image.trim() ? options.image : DEFAULT_DOCKER_IMAGE;
    if (options.mountHost !== undefined) env.REX_MOUNT_HOST = options.mountHost;
    if (options.mountContainer !== undefined) env.REX_MOUNT_CONTAINER = options.mountContainer;
  }

  return {
    command: layout.venvPython,
    args: [sidecar],
    env,
  };
}
