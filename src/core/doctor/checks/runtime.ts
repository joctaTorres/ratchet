/**
 * SWE-ReX runtime preflight.
 *
 * The ReX sidecar needs a Python toolchain to build its isolated venv. `uv` is
 * PREFERRED (faster, more reliable builds); absent uv, a Python >= MIN_PYTHON
 * with `venv` and `pip` available satisfies the requirement. This reuses the
 * proven probes in `rex-bootstrap.ts` (`findPython`, `MIN_PYTHON`) so doctor and
 * the real bootstrap never disagree about what counts as a usable interpreter.
 *
 * `findPython` throws `RexBootstrapError` when nothing qualifies; doctor must
 * report a failing CHECK rather than throw, so it is wrapped in a non-throwing
 * probe here.
 */

import {
  findPython,
  MIN_PYTHON,
  RexBootstrapError,
  type BootstrapDeps,
} from '../../batch/engine/runtime/rex-bootstrap.js';
import type { DoctorCheck } from '../types.js';

const MIN = `${MIN_PYTHON.major}.${MIN_PYTHON.minor}`;

/** Stable id + human label for this check (single source — used by every branch). */
const ID = 'runtime';
const LABEL = 'SWE-ReX runtime (uv / Python)';

const INSTALL_REMEDY =
  `Install uv (https://docs.astral.sh/uv/) — preferred — or Python ${MIN}+ ` +
  `(https://www.python.org/downloads/) with the venv and pip modules, and ensure ` +
  `it is on your PATH.`;

/** Non-throwing wrapper around `findPython`: returns the command or null. */
function probePython(deps: BootstrapDeps): string | null {
  try {
    return findPython(deps);
  } catch (err) {
    if (err instanceof RexBootstrapError) return null;
    throw err;
  }
}

/** Read the reported version banner of a python interpreter (best-effort). */
function pythonVersion(deps: BootstrapDeps, python: string): string | undefined {
  const res = deps.run(python, ['--version']);
  const out = (res.stdout || res.stderr).trim();
  const match = out.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : undefined;
}

/** Whether a module imports from the given interpreter (e.g. venv, pip). */
function hasModule(deps: BootstrapDeps, python: string, module: string): boolean {
  return deps.run(python, ['-c', `import ${module}`]).status === 0;
}

/** Run the runtime preflight, returning one `DoctorCheck`. Pure (deps injected). */
export function checkRuntime(deps: BootstrapDeps): DoctorCheck {
  // uv is preferred: when present, the bootstrap uses it and needs no separate
  // Python probe (uv provisions its own interpreter), so this passes outright.
  if (deps.hasOnPath('uv')) {
    return {
      id: ID,
      label: LABEL,
      status: 'pass',
      severity: 'required',
      detail: 'uv is installed and will be used as the preferred runtime provider.',
    };
  }

  const python = probePython(deps);
  if (!python) {
    return {
      id: ID,
      label: LABEL,
      status: 'fail',
      severity: 'required',
      detail:
        `No usable runtime found: uv is not installed and no Python ${MIN}+ ` +
        `interpreter is on PATH. ratchet needs one to bootstrap the SWE-ReX sidecar.`,
      remedy: INSTALL_REMEDY,
    };
  }

  const version = pythonVersion(deps, python);
  const missing: string[] = [];
  if (!hasModule(deps, python, 'venv')) missing.push('venv');
  if (!hasModule(deps, python, 'pip')) missing.push('pip');

  if (missing.length > 0) {
    return {
      id: ID,
      label: LABEL,
      status: 'fail',
      severity: 'required',
      detail:
        `Found Python ${version ?? python} but it is missing required module(s): ` +
        `${missing.join(', ')}. The SWE-ReX venv cannot be built without them.`,
      remedy: INSTALL_REMEDY,
    };
  }

  return {
    id: ID,
    label: LABEL,
    status: 'pass',
    severity: 'required',
    detail: `Detected Python ${version ?? 'unknown'} (${python}) with venv and pip.`,
  };
}
