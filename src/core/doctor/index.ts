/**
 * Doctor: validate ratchet's external (non-npm) runtime dependencies.
 *
 * `runDoctorChecks` is a PURE aggregator over the individual check functions. All
 * side effects flow through the injected `BootstrapDeps` seam (the same shape the
 * ReX bootstrap uses), so the whole engine is unit-testable with in-memory fakes
 * — no real process or fs is required. The default deps are the real ones.
 *
 * The returned `DoctorReport` carries every check plus a derived `ok` flag (true
 * iff every REQUIRED check passes). Rendering and exit-code derivation live
 * elsewhere (`render.ts`) so this module stays pure data-in/data-out.
 */

import {
  defaultDeps,
  type BootstrapDeps,
} from '../batch/engine/runtime/rex-bootstrap.js';
import { checkAgents } from './checks/agents.js';
import { checkRuntime } from './checks/runtime.js';
import { checkDocker } from './checks/docker.js';
import { isReportOk, type DoctorReport } from './types.js';

export type { DoctorCheck, DoctorReport, DoctorStatus, DoctorSeverity } from './types.js';
export { isReportOk } from './types.js';

/**
 * Run every doctor check against the injected deps and aggregate the result.
 * Checks run in a fixed, human-meaningful order: required agent + runtime first,
 * then the optional Docker notice.
 */
export function runDoctorChecks(deps: BootstrapDeps = defaultDeps): DoctorReport {
  const checks = [checkAgents(deps), checkRuntime(deps), checkDocker(deps)];
  return { checks, ok: isReportOk(checks) };
}
