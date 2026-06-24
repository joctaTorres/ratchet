/**
 * Agent preflight check.
 *
 * Verifies at least one SUPPORTED coding-agent CLI is installed on PATH. This is
 * tool-agnostic by construction: it iterates `AGENT_BINARIES` (derived from the
 * batch adapters in `agent.ts`) so EVERY batch-capable agent is checked, never
 * just the default. The requirement passes when any one binary resolves; it
 * fails (required severity) only when none is installed — the actual ENOENT a
 * batch run would otherwise hit deep in the engine, surfaced early with a remedy.
 *
 * Each detected agent's version is probed best-effort: a binary that is present
 * but errors on its version probe is still reported as detected (unknown
 * version), since presence — not a parseable banner — is what the engine needs.
 */

import { AGENT_BINARIES } from '../../batch/engine/agent.js';
import type { BootstrapDeps } from '../../batch/engine/runtime/rex-bootstrap.js';
import type { DoctorCheck } from '../types.js';

/** A single detected agent CLI and its reported version (if probeable). */
export interface DetectedAgent {
  /** Agent id (e.g. `claude`). */
  id: string;
  /** The binary resolved on PATH (e.g. `cursor-agent`). */
  binary: string;
  /** Parsed version string, or undefined when the probe failed/unparseable. */
  version?: string;
}

/** Extract the first version-looking token (e.g. `1.2.3`) from probe output. */
function parseVersion(output: string): string | undefined {
  const match = output.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/);
  return match ? match[0] : undefined;
}

/**
 * Best-effort version probe for an installed agent binary. Tries `--version`;
 * never throws and never fails the check — a present binary whose probe errors
 * is reported with an unknown version.
 */
function probeVersion(deps: BootstrapDeps, binary: string): string | undefined {
  const res = deps.run(binary, ['--version']);
  if (res.status !== 0) return undefined;
  return parseVersion(res.stdout || res.stderr);
}

/** Run the agent preflight, returning one `DoctorCheck`. Pure (deps injected). */
export function checkAgents(deps: BootstrapDeps): DoctorCheck {
  const supported = Object.entries(AGENT_BINARIES);
  const detected: DetectedAgent[] = [];

  for (const [id, binary] of supported) {
    if (!deps.hasOnPath(binary)) continue;
    detected.push({ id, binary, version: probeVersion(deps, binary) });
  }

  const supportedList = supported
    .map(([id, binary]) => (id === binary ? id : `${id} (${binary})`))
    .join(', ');

  if (detected.length === 0) {
    return {
      id: 'agent',
      label: 'Coding-agent CLI',
      status: 'fail',
      severity: 'required',
      detail: `No supported coding-agent CLI found on PATH. At least one is required to run batch changes. Supported: ${supportedList}.`,
      remedy: `Install one of the supported coding-agent CLIs (${supportedList}) and ensure it is on your PATH.`,
    };
  }

  const detail = detected
    .map((agent) =>
      agent.version
        ? `${agent.id} ${agent.version}`
        : `${agent.id} (version unknown)`
    )
    .join(', ');

  return {
    id: 'agent',
    label: 'Coding-agent CLI',
    status: 'pass',
    severity: 'required',
    detail: `Detected: ${detail}.`,
  };
}
