/**
 * Doctor types: the structured result of validating ratchet's external
 * (non-npm) runtime dependencies.
 *
 * A `DoctorCheck` is a single, self-describing verdict (id + label + status +
 * severity + human detail + optional remedy). A `DoctorReport` is the full set
 * plus a derived `ok` flag (true iff every REQUIRED check passes). The shape is
 * pure data so it serializes verbatim under `--json` and renders for humans
 * unchanged — no rendering logic leaks into the check engine.
 */

/** Verdict for a single check. `info` is advisory and never affects exit code. */
export type DoctorStatus = 'pass' | 'fail' | 'info';

/**
 * Whether a check gates the run. `required` failures fail doctor (non-zero
 * exit); `optional` checks are informational and never fail doctor.
 */
export type DoctorSeverity = 'required' | 'optional';

export interface DoctorCheck {
  /** Stable machine id (e.g. `agent`, `runtime`, `docker`). */
  id: string;
  /** Short human label for the check. */
  label: string;
  status: DoctorStatus;
  severity: DoctorSeverity;
  /** Human-readable detail describing the verdict. */
  detail: string;
  /** Actionable remedy shown when the check is not passing. */
  remedy?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** True iff every `required` check passed. Drives the process exit code. */
  ok: boolean;
}

/** Compute the report-level `ok` flag from a set of checks. */
export function isReportOk(checks: readonly DoctorCheck[]): boolean {
  return checks.every(
    (check) => check.severity !== 'required' || check.status === 'pass'
  );
}
