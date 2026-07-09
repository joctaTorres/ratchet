/**
 * Batch-isolation check (optional/informational).
 *
 * Nudges an operator running permissive / full-autonomy batches on the `local`
 * locus toward the `docker` locus that actually contains the run. The `local`
 * locus is ADVISORY — no filesystem or network isolation (see
 * `runtime/isolation.ts`) — so a posture like `full-autonomy` or the
 * `repo-sandboxed-permissive` default running there has no real containment
 * behind it. This check surfaces that gap up front, but only when it is
 * relevant: it returns `null` (→ omitted from the report entirely, never a
 * passing or skipped row) whenever the resolved locus already provides real
 * containment (`docker`) or is the server operator's boundary (`remote`),
 * mirroring how `pr-remote` is conditionally appended.
 *
 * `optional` severity so it NEVER fails doctor (`isReportOk` ignores optional
 * checks) — the nudge is advisory, see `doctor-local-locus-nudge.feature`.
 */

import { resolveBatchSettings } from '../../batch/config.js';
import type { DoctorCheck } from '../types.js';

const ID = 'batch-isolation';
const LABEL = 'Batch locus isolation';

/**
 * Run the batch-isolation check, returning one `DoctorCheck` only when the
 * resolved locus is `local` AND the posture is permissive-or-above; `null`
 * otherwise (silent on `docker`/`remote`, which already provide or own the
 * containment boundary). Resolves project-level batch settings (no manifest) so
 * the nudge reflects the operator's standing configuration.
 */
export function checkBatchIsolation(projectRoot: string): DoctorCheck | null {
  const { settings } = resolveBatchSettings(projectRoot);
  // Real containment (docker) or the server's boundary (remote) → silent.
  if (settings.locus !== 'local') return null;

  const posture = settings.permissions?.posture;
  if (posture === 'full-autonomy') {
    return {
      id: ID,
      label: LABEL,
      status: 'info',
      severity: 'optional',
      detail:
        'Batch posture is `full-autonomy` on the `local` locus, which is advisory — ' +
        'no filesystem or network isolation backs the posture. A full-autonomy agent ' +
        'can do anything the launching user can.',
      remedy:
        'For real containment, run with `locus: docker` (see `ratchet batch config` for ' +
        'the resolved uid/memory/pids/network contract). The docker locus contains the ' +
        'agent in a container with a writable repo mount and bounded resources.',
    };
  }

  // The permissive default (and any permissive-tier posture) on local is
  // advisory: informational, not a failure, with a lighter nudge.
  if (posture === 'repo-sandboxed-permissive') {
    return {
      id: ID,
      label: LABEL,
      status: 'info',
      severity: 'optional',
      detail:
        'Batch posture is `repo-sandboxed-permissive` on the `local` locus. The `local` ' +
        'locus is advisory — no filesystem or network isolation; the argv denylist is ' +
        'best-effort damage reduction, not containment.',
      remedy:
        'For real containment, consider `locus: docker` (the docker locus contains the ' +
        'agent in a container with bounded resources; see `ratchet batch config`).',
    };
  }

  // `curated-allowlist` on local is narrow enough to stay silent — the allow
  // list bounds what the agent may do. (Any future posture tier resolves here.)
  return null;
}
