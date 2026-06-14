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

/**
 * The single pinned swe-rex version. Verified resolvable + importable in the
 * spike (swerex.__version__ == 1.4.0). Bump deliberately; the marker records it
 * so a change here forces a rebuild.
 */
export const SWE_REX_VERSION = '1.4.0';

/** Minimum acceptable Python (swe-rex requires modern asyncio/typing). */
export const MIN_PYTHON = { major: 3, minor: 10 } as const;

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

/** A venv is ready iff its marker exists AND records the current pinned version. */
function isReady(deps: BootstrapDeps, layout: VenvLayout): boolean {
  if (!deps.exists(layout.venvDir)) return false;
  if (!deps.exists(layout.venvPython)) return false;
  if (!deps.exists(layout.markerPath)) return false;
  try {
    const marker = JSON.parse(deps.readText(layout.markerPath));
    return marker?.sweRexVersion === SWE_REX_VERSION;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// venv build
// -----------------------------------------------------------------------------

const SWE_REX_SPEC = `swe-rex==${SWE_REX_VERSION}`;

/**
 * Build the venv from scratch and install the pinned swe-rex. Clears any prior
 * (possibly partial) dir first, writes the success marker LAST. Prefers `uv`,
 * falls back to `python -m venv` + that venv's pip. Throws `RexBootstrapError`
 * naming the failing stage (venv creation vs install) with a remedy.
 */
function buildVenv(
  deps: BootstrapDeps,
  python: string,
  layout: VenvLayout
): void {
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
      SWE_REX_SPEC,
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
      SWE_REX_SPEC,
    ]);
    if (installed.status !== 0) {
      deps.rmrf(layout.venvDir);
      throw new RexBootstrapError(installFailMessage(installed.stderr));
    }
  }

  // Verify swe-rex actually imports from the venv interpreter before declaring
  // success — a non-importable install must not be cached as ready.
  const check = deps.run(layout.venvPython, ['-c', 'import swerex']);
  if (check.status !== 0) {
    deps.rmrf(layout.venvDir);
    throw new RexBootstrapError(
      `ReX runtime bootstrap: installed ${SWE_REX_SPEC} but it does not import ` +
        `from the venv interpreter. Detail: ${truncate(check.stderr)}`
    );
  }

  // Marker written LAST: only now is the venv considered ready.
  deps.writeText(
    layout.markerPath,
    JSON.stringify(
      { sweRexVersion: SWE_REX_VERSION, python, builtAt: new Date().toISOString() },
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
// Entry point
// -----------------------------------------------------------------------------

/**
 * Lazily ensure the ReX venv exists (reusing a valid cache) and return the
 * resolved command to launch the sidecar. Idempotent: a ready venv is reused
 * without a rebuild; a missing/stale venv is rebuilt after clearing the dir.
 */
export function bootstrapRexRuntime(options: BootstrapOptions = {}): ResolvedLaunch {
  const deps = options.deps ?? defaultDeps;
  const cacheHome = resolveCacheHome(options.cacheHome);
  const layout = venvLayout(cacheHome);

  if (!isReady(deps, layout)) {
    const python = findPython(deps, options.pythonOverride);
    buildVenv(deps, python, layout);
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

  return {
    command: layout.venvPython,
    args: [sidecar],
    env,
  };
}
