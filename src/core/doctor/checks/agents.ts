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
 *
 * Spec-aware consultation: doctor also consults the project-scope `batch.agent`
 * setting (the same `resolveBatchSettings` source `checkPrRemote` uses) and,
 * for every configured `agent[:model]` value, parses it through `parseAgentSpec`
 * and probes the **agent part's** binary. A configured agent whose binary is
 * missing fails the check — the actual ENOENT a batch run would hit at spawn —
 * even when another supported binary is detected. The whole spec string is never
 * treated as a binary name (so `opencode:zai/glm-5.2` probes `opencode`, not the
 * literal spec), the model part is never read into any report text (doctor
 * validates no model id and emits no model-related check), and an agent part not
 * in `AGENT_BINARIES` is skipped — unknown-agent rejection stays at spawn time
 * (`UnknownAgentError` in `resolveAdapter`). The registry-wide sweep, detected
 * version detail, and no-binary failure are unchanged.
 */

import { AGENT_BINARIES } from '../../batch/engine/agent.js';
import { resolveBatchSettings } from '../../batch/config.js';
import { parseAgentSpec } from '../../batch/agent-setting.js';
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

/**
 * The configured `agent` values doctor consults, reduced to the distinct agent
 * parts doctor must probe. Each configured string value — the scalar, or each
 * stage entry of a per-stage map — is parsed through `parseAgentSpec`; the
 * agent parts are deduped (a per-stage map that names the same agent twice
 * probes its binary once) and the model part is dropped here and never read
 * again. Agent parts not present in `AGENT_BINARIES` are filtered out: doctor
 * does not duplicate spawn-time `UnknownAgentError` with a vaguer binary probe.
 */
function configuredAgentParts(
  agent: string | Record<string, string> | undefined
): string[] {
  if (agent === undefined) return [];
  const values: string[] =
    typeof agent === 'string' ? [agent] : Object.values(agent);
  const parts = new Set<string>();
  for (const value of values) {
    const { agent: agentPart } = parseAgentSpec(value);
    if (agentPart in AGENT_BINARIES) parts.add(agentPart);
  }
  return [...parts];
}

/** Run the agent preflight, returning one `DoctorCheck`. Pure (deps injected). */
export function checkAgents(
  deps: BootstrapDeps,
  projectRoot?: string
): DoctorCheck {
  const supported = Object.entries(AGENT_BINARIES);
  const detected: DetectedAgent[] = [];

  for (const [id, binary] of supported) {
    if (!deps.hasOnPath(binary)) continue;
    detected.push({ id, binary, version: probeVersion(deps, binary) });
  }

  const supportedList = supported
    .map(([id, binary]) => (id === binary ? id : `${id} (${binary})`))
    .join(', ');

  // Spec-aware consultation: a configured agent whose binary is not on PATH is a
  // guaranteed spawn-time ENOENT, so it fails the check — harder than the
  // registry-wide "no binary at all" case below — naming the configured agent
  // id and its binary with an install remedy. The model part is never read.
  const configuredAgent = projectRoot
    ? resolveBatchSettings(projectRoot).settings.agent
    : undefined;
  const missingConfigured = configuredAgentParts(configuredAgent).filter(
    (id) => !deps.hasOnPath(AGENT_BINARIES[id])
  );
  if (missingConfigured.length > 0) {
    const missingList = missingConfigured
      .map((id) => {
        const binary = AGENT_BINARIES[id];
        return id === binary ? id : `${id} (${binary})`;
      })
      .join(', ');
    return {
      id: 'agent',
      label: 'Coding-agent CLI',
      status: 'fail',
      severity: 'required',
      detail: `Configured agent ${missingList} is not installed: its CLI binary was not found on PATH.`,
      remedy: `Install the configured agent CLI (${missingList}) and ensure it is on your PATH.`,
    };
  }

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
