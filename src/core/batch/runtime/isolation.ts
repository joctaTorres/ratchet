/**
 * Locus isolation descriptor — the HONEST per-locus isolation story rendered by
 * `batch config` / `batch view` and surfaced to `ratchet doctor`.
 *
 * This is pure data over resolved {@link BatchSettings}: no filesystem, no spawn,
 * no I/O. It states what the resolved locus actually isolates so an operator can
 * never mistake an advisory posture (the `local` locus) for a real sandbox. The
 * docker description is parameterized by the resolved #85 contract knobs
 * (`dockerUser`, `dockerMemory`, `dockerPidsLimit`, `network`) so the docker
 * line states the ACTUAL contract, not a generic "container" claim.
 *
 * DECISION (locked): a posture is NOT containment. The argv denylist
 * (`REPO_SANDBOX_DENY_PATTERNS`) is best-effort damage reduction that only the
 * docker locus backs with real containment; the `local` locus is advisory with no
 * filesystem/network isolation. `remote` is the server operator's boundary, not
 * one ratchet enforces. This module is the single rendering source for that
 * story; `batch config`, `batch view`, and the doctor nudge all reuse it so the
 * wording can never drift between surfaces (#86 posture-honesty half).
 */

import {
  DEFAULT_DOCKER_MEMORY,
  DEFAULT_DOCKER_NETWORK,
  DEFAULT_DOCKER_PIDS_LIMIT,
} from '../config.js';
import type { BatchSettings, Locus } from '../config.js';

/**
 * The resolved docker contract knobs as the docker descriptor renders them:
 * each value is resolved to its effective string (applying the runtime defaults
 * when unset), so the descriptor states the ACTUAL contract the container runs
 * under, not a generic "container" claim. `cpus` is opt-in (absent → `undefined`
 * → omitted from the description), mirroring the runtime's no-default behavior.
 */
export interface ResolvedDockerContract {
  /** `--user` value, e.g. `"1000:1000"` or `"host uid:gid"` when unset. */
  user: string;
  /** `--memory` value, e.g. `"2g"`. Always resolved (runtime applies a default). */
  memory: string;
  /** `--pids-limit` value as a string, e.g. `"512"`. */
  pids: string;
  /** `--network` value, e.g. `"bridge"` or `"none"`. */
  network: string;
  /** `--cpus` value, e.g. `"1.5"`, or `undefined` when unset (no flag emitted). */
  cpus?: string;
}

/**
 * The resolved isolation descriptor: the locus and a short honest description of
 * what it actually isolates. Consumed verbatim by `batch config` / `batch view`
 * (rendered as an `Isolation:` line) and carried machine-readably by the
 * `--json` payload; the doctor nudge keys off `locus` + the posture to decide
 * its severity without re-deriving the description.
 */
export interface LocusIsolation {
  /** The resolved locus the descriptor was computed for. */
  locus: Locus;
  /**
   * A short, honest description of what the locus isolates. Stable phrasing the
   * features pin: `local` is advisory with no filesystem/network isolation and
   * an env allowlist; `docker` is container isolation with the resolved uid /
   * memory / pids / network contract and a writable-by-design repo mount;
   * `remote` is the server operator's boundary, not ratchet's.
   */
  description: string;
}

/**
 * Resolve the effective docker contract knobs from {@link BatchSettings},
 * applying the runtime defaults (memory / pids / network) and the documented
 * "host uid:gid" fallback for an unset `dockerUser`. Pure: no filesystem, no
 * `process.uid` read — the runtime resolves the real host uid:gid at spawn; the
 * descriptor states the documented fallback so the rendered text is honest about
 * the unset case ("runs as the host user, not root") without touching the OS.
 */
export function resolveDockerContract(settings: BatchSettings): ResolvedDockerContract {
  const user =
    settings.dockerUser && settings.dockerUser.trim().length > 0
      ? settings.dockerUser
      : 'host uid:gid';
  const memory =
    settings.dockerMemory && settings.dockerMemory.trim().length > 0
      ? settings.dockerMemory
      : DEFAULT_DOCKER_MEMORY;
  const pids = String(settings.dockerPidsLimit ?? DEFAULT_DOCKER_PIDS_LIMIT);
  const network =
    settings.network && settings.network.trim().length > 0
      ? settings.network
      : DEFAULT_DOCKER_NETWORK;
  const cpus =
    settings.dockerCpus !== undefined ? String(settings.dockerCpus) : undefined;
  return { user, memory, pids, network, cpus };
}

/**
 * Describe the real isolation of the resolved locus in a short, honest line.
 *
 * - `local`: advisory — no filesystem or network isolation; the agent
 *   environment is scoped to the env allowlist (phase-mate #86 env-scoping). The
 *   argv denylist is best-effort damage reduction, NOT containment.
 * - `docker`: container isolation with the resolved #85 contract (uid, memory,
 *   pids, network policy); the repository mount stays writable by design.
 * - `remote`: isolation is the remote server operator's boundary, not one
 *   ratchet enforces.
 *
 * Pure over the already-resolved {@link BatchSettings}: no I/O, no spawn. The
 * docker description is parameterized by {@link resolveDockerContract} so the
 * rendered line states the actual contract the container runs under.
 */
export function describeLocusIsolation(settings: BatchSettings): LocusIsolation {
  switch (settings.locus) {
    case 'docker': {
      const c = resolveDockerContract(settings);
      const cpusClause = c.cpus !== undefined ? `, cpus ${c.cpus}` : '';
      return {
        locus: 'docker',
        description:
          `Container isolation — uid ${c.user}, memory ${c.memory}, pids ${c.pids}, ` +
          `network ${c.network}${cpusClause}. Repository mount stays writable by design.`,
      };
    }
    case 'remote':
      return {
        locus: 'remote',
        description:
          "Isolation is the remote server's boundary, not one ratchet enforces.",
      };
    case 'local':
    default:
      return {
        locus: 'local',
        description:
          'Advisory — no filesystem or network isolation; agent environment is scoped to the env allowlist.',
      };
  }
}
