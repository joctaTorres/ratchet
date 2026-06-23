/**
 * Secret-scan gate — the pure "no leaked secret" evaluator plus its thin runner,
 * mirroring the phase-1 release-decision / release-gate split and the sibling
 * dependency-audit / coverage / e2e gate slices.
 *
 * The risky, must-be-correct part is a single question: "does the working tree
 * contain any non-allowlisted leaked secret, fail-closed on the unknown?". That
 * is isolated as the pure `evaluateSecretScan` so every branch is unit-testable
 * without running a real scan. `runSecretScanGate` is the impure glue: it reads
 * the scan-report path + allowlist from the environment, parses the findings,
 * calls the evaluator, prints the verdict, and turns it into a process exit code
 * the CI secret-scan step acts on — adding NO decision logic of its own.
 *
 * Integration contract: `evaluateSecretScan` returns `signal: 'green' | 'red'` —
 * exactly the `GateSignal` shape the release-decision spine keys its gates by.
 * This slice only PRODUCES that signal and enforces "no leaked secret" in CI; the
 * `wire-security-into-release-gate` change feeds it into `decideRelease`
 * unchanged. Pinning the shape here makes that wiring a small addition.
 *
 * Fail-closed: a missing, unreadable, or malformed report yields `null` from the
 * reader, which the evaluator treats as `red` — a scan that never ran (or crashed
 * before writing its report) must never read as green.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateSignal } from './release-decision.js';

/**
 * A single secret-scan finding, normalized from the scanner's machine-readable
 * output (e.g. gitleaks' `--report-format json`). `rule` and `file` are required
 * — they identify the offending finding in reasons; `line` and `secretType` are
 * optional descriptive extras when the scanner provides them.
 */
export interface SecretFinding {
  /** The scanner rule that matched (e.g. `aws-access-key`, gitleaks' `RuleID`). */
  rule: string;
  /** The file the secret was found in (gitleaks' `File`). */
  file: string;
  /** The line the secret starts on, when known (gitleaks' `StartLine`). */
  line?: number;
  /** A human description of the secret kind, when known (gitleaks' `Description`). */
  secretType?: string;
}

/** Environment variable pointing at the scanner's machine-readable JSON report. */
export const REPORT_ENV = 'SECRET_SCAN_REPORT';

/** Conventional path of the secret-scan JSON report the CI step writes. */
export const DEFAULT_REPORT_PATH = 'security/secret-scan-report.json';

/**
 * Environment variable holding a comma-separated allowlist of known-safe finding
 * identifiers. An empty/absent value means an EMPTY allowlist — any finding is
 * red unless explicitly allowlisted. Kept as data so the bar is adjustable
 * without touching code.
 */
export const ALLOWLIST_ENV = 'SECRET_SCAN_ALLOWLIST';

export interface SecretScanInput {
  /**
   * The parsed findings, or `null` when the report could not be read. `null` is
   * treated as fail-closed `red`. An empty array is a clean, parseable scan.
   */
  findings: SecretFinding[] | null;
  /**
   * Identifiers of known-safe findings to exempt. A finding is allowlisted when
   * its fingerprint (`file:rule`) or its `file` is in this set — a bare `rule` is
   * NOT matched (too broad: it would exempt that rule everywhere).
   * Defaults to empty — fail-closed on the unknown.
   */
  allowlist?: ReadonlySet<string>;
}

export interface SecretScanResult {
  /** Exactly the release-decision `GateSignal` shape, so the spine consumes it. */
  signal: GateSignal;
  /** The findings echoed back, or `null` when the report was unreadable. */
  findings: SecretFinding[] | null;
  /** How many findings were exempted by the allowlist. */
  allowlisted: number;
  /** One reason per non-allowlisted finding (or the unreadable report); empty when `green`. */
  reasons: string[];
}

/** Stable identifier for a finding: `file:rule`, used for allowlist matching. */
export function fingerprint(finding: SecretFinding): string {
  return `${finding.file}:${finding.rule}`;
}

/**
 * True when `finding` is exempted by `allowlist` — matched by its fingerprint
 * (`file:rule`) or its bare `file`, so an allowlist can target a specific planted
 * fixture or a whole known-safe file. A bare `rule` is deliberately NOT matched:
 * exempting every finding of a rule across the whole tree is too broad for a
 * security gate, so the allowlist stays scoped to a file (or a file+rule pair).
 */
function isAllowlisted(finding: SecretFinding, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(fingerprint(finding)) || allowlist.has(finding.file);
}

/** Human-readable reason naming an offending finding (file + rule, line when known). */
function reasonFor(finding: SecretFinding): string {
  const where = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
  return `leaked secret in "${where}" (rule: ${finding.rule})`;
}

/**
 * Decide a secret-scan gate signal. `green` iff `findings` is non-null AND zero
 * non-allowlisted findings remain; otherwise `red` with a precise reason — either
 * naming each offending finding (file + rule), or that the secret-scan report
 * could not be read (fail-closed). Pure: no I/O, fully branch-testable.
 */
export function evaluateSecretScan(input: SecretScanInput): SecretScanResult {
  const { findings } = input;
  const allowlist = input.allowlist ?? new Set<string>();

  if (findings === null) {
    return {
      signal: 'red',
      findings: null,
      allowlisted: 0,
      reasons: ['secret-scan report could not be read (missing or malformed)'],
    };
  }

  let allowlisted = 0;
  const reasons: string[] = [];
  for (const finding of findings) {
    if (isAllowlisted(finding, allowlist)) {
      allowlisted += 1;
      continue;
    }
    reasons.push(reasonFor(finding));
  }

  const signal: GateSignal = reasons.length === 0 ? 'green' : 'red';
  return { signal, findings, allowlisted, reasons };
}

/**
 * Resolve the allowlist from `env`: the comma-separated `SECRET_SCAN_ALLOWLIST`
 * entries (trimmed, empties dropped), or an empty set when unset. Empty means any
 * finding is red unless explicitly allowlisted.
 */
export function resolveAllowlist(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env[ALLOWLIST_ENV];
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

/** Coerce one raw report entry into a {@link SecretFinding}, or `null` if malformed. */
function normalizeFinding(raw: unknown): SecretFinding | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;

  // Accept both gitleaks' capitalized keys (RuleID/File/StartLine/Description)
  // and a lowercase emitter shape (rule/file/line/secretType).
  const rule = entry.RuleID ?? entry.rule;
  const file = entry.File ?? entry.file;
  if (typeof rule !== 'string' || typeof file !== 'string') return null;

  const finding: SecretFinding = { rule, file };

  const line = entry.StartLine ?? entry.line;
  if (typeof line === 'number' && Number.isFinite(line)) finding.line = line;

  const secretType = entry.Description ?? entry.secretType;
  if (typeof secretType === 'string') finding.secretType = secretType;

  return finding;
}

/**
 * Read the findings array from the secret-scan JSON at `reportPath`. Accepts the
 * scanner's top-level array (gitleaks' `--report-format json`) or an object with
 * a `findings` array. Returns `null` — which the evaluator treats as fail-closed
 * `red` — when the file is missing, unreadable, malformed, or any entry lacks the
 * required `rule`/`file`. Never throws. An empty array is a clean scan (`[]`).
 */
export function readSecretFindings(reportPath: string): SecretFinding[] | null {
  let raw: string;
  try {
    raw = readFileSync(reportPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  let entries: unknown[];
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { findings?: unknown }).findings)
  ) {
    entries = (parsed as { findings: unknown[] }).findings;
  } else {
    return null;
  }

  const findings: SecretFinding[] = [];
  for (const entry of entries) {
    const finding = normalizeFinding(entry);
    // A present-but-malformed entry fails closed: a half-parsed report must never
    // read as "fewer secrets than there are".
    if (finding === null) return null;
    findings.push(finding);
  }

  return findings;
}

/** Outcome of running the secret-scan gate: the evaluation plus an exit code. */
export interface SecretScanRunResult {
  result: SecretScanResult;
  /** `0` on `green`, `1` on `red` — what the CI secret-scan step acts on. */
  exitCode: number;
  /** Lines to print, describing the outcome and any reasons. */
  lines: string[];
}

/**
 * Resolve the report path + allowlist from `env`, read the findings, consult the
 * pure evaluator, and turn its verdict into an exit code plus printable lines.
 * Pure given its `env` argument (only the file read touches the outside world),
 * so it can be exercised directly in tests with a fixture report — no Actions
 * runner needed. Adds NO decision logic.
 */
export function runSecretScanGate(env: NodeJS.ProcessEnv): SecretScanRunResult {
  const reportPath = env[REPORT_ENV] || DEFAULT_REPORT_PATH;
  const allowlist = resolveAllowlist(env);
  const findings = readSecretFindings(reportPath);

  const result = evaluateSecretScan({ findings, allowlist });

  const lines: string[] = [];
  if (result.signal === 'green') {
    const exempted = result.allowlisted > 0 ? ` (${result.allowlisted} allowlisted)` : '';
    lines.push(`green: secret-scan gate passed — no leaked secrets${exempted}.`);
  } else {
    lines.push('red: secret-scan gate failed — the release gate will treat this as not-green.');
    for (const reason of result.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return { result, exitCode: result.signal === 'green' ? 0 : 1, lines };
}

/** True when this module is the process entrypoint (`node secret-scan-gate.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow's secret-scan step, evaluate and exit.
// Importing the module (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  const run = runSecretScanGate(process.env);
  for (const line of run.lines) {
    console.log(line);
  }
  process.exit(run.exitCode);
}
