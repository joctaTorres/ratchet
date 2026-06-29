/**
 * Phase proof-of-work execution and gating.
 *
 * Once every change in a phase is done, the engine runs the phase's
 * proof-of-work to decide whether the phase ships:
 *
 *   - `integration` / `blackbox` run a bash command and pass when the pass
 *     condition holds against the command output/exit status.
 *   - `llm-judge` spawns an agent that exercises the software directly (bash or
 *     an MCP tool) and returns a pass/fail verdict against the success criteria.
 *
 * Policy gates the phase: under `hard-gate` (default) a failure blocks the phase
 * and the next phase and is surfaced as a blocker; under `warn` the failure is
 * recorded and the phase is allowed to complete.
 *
 * STUBBED BOUNDARY: the bash runner is injectable (`BashRunner`) so tests do not
 * shell out; the default runner really executes the command via child_process.
 */

import { spawn } from 'node:child_process';
import type { ProofOfWork } from '../manifest.js';
import type { ProofOfWorkPolicy } from '../config.js';

export interface BashResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type BashRunner = (command: string, cwd: string) => Promise<BashResult>;

export const realBashRunner: BashRunner = (command, cwd) =>
  new Promise<BashResult>((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });

/** A judge returns a verdict; spawned for `llm-judge` proof-of-work. */
export interface JudgeRequest {
  success: string;
  run: string;
  pass: string;
  cwd: string;
}
export interface JudgeVerdict {
  pass: boolean;
  reason: string;
}
export type LlmJudge = (request: JudgeRequest) => Promise<JudgeVerdict>;

export type ProofOfWorkPassReason = 'pass-condition-met' | 'judge-pass';
export type ProofOfWorkFailReason =
  | 'nonzero-exit'
  | 'pass-condition-unmet'
  | 'judge-fail'
  | 'error';

export interface ProofOfWorkResult {
  kind: ProofOfWork['kind'];
  passed: boolean;
  /** True when the policy lets the phase complete despite a failure (warn). */
  gatePassed: boolean;
  policy: ProofOfWorkPolicy;
  reason: ProofOfWorkPassReason | ProofOfWorkFailReason;
  detail: string;
}

/**
 * Evaluate whether a bash command's result meets the pass condition.
 *
 * Pass conditions are intentionally simple and declarative (the manifest author
 * writes them):
 *   - "" / "exit 0" / "exit-zero" / "exit code 0" -> passes when the command
 *     exits 0. A *leading* exit-zero directive is recognized even when followed
 *     by punctuation/prose, e.g. "exit code 0 — new tests pass" or
 *     "exit-zero: suite green"; such a condition gates on the exit status and is
 *     NOT substring-matched against stdout.
 *   - `contains:<text>`           -> passes when stdout contains <text>
 *   - `regex:<pattern>`           -> passes when stdout matches the pattern
 * Anything else (a bare string that is not an exit-code directive) is treated as
 * substring-in-stdout, with exit 0 still required.
 */
type PassEvaluation = { passed: boolean; reason: ProofOfWorkPassReason | ProofOfWorkFailReason };

/**
 * Matches a pass condition that *begins* with an exit-zero directive: `exit`,
 * an optional `code` and `-`/space separators, then `0` or `zero`, terminated by
 * end-of-string or a non-alphanumeric boundary (whitespace or punctuation such
 * as `—`, `:`, `,`). Recognizes `exit 0`, `exit-zero`, `exit code 0`, and prose
 * forms like `Exit 0, then ...` or `EXIT CODE 0 — everything passes`.
 */
const EXIT_ZERO_DIRECTIVE = /^exit(?:[- ]?code)?[- ]?(?:0|zero)(?![a-z0-9_])/i;

/** Pass when exit 0; otherwise fail as nonzero-exit. */
function exitZeroHandler(exitedZero: boolean): PassEvaluation {
  return exitedZero
    ? { passed: true, reason: 'pass-condition-met' }
    : { passed: false, reason: 'nonzero-exit' };
}

/**
 * Pass when exit 0 AND `match` holds against stdout. A failed match while exit 0
 * is `pass-condition-unmet`; a nonzero exit is `nonzero-exit`.
 */
function outputHandler(exitedZero: boolean, match: boolean): PassEvaluation {
  return exitedZero && match
    ? { passed: true, reason: 'pass-condition-met' }
    : { passed: false, reason: exitedZero ? 'pass-condition-unmet' : 'nonzero-exit' };
}

function regexMatch(pattern: string, stdout: string): boolean {
  try {
    return new RegExp(pattern).test(stdout);
  } catch {
    return false;
  }
}

export function evaluatePassCondition(pass: string, result: BashResult): PassEvaluation {
  const exitedZero = result.exitCode === 0;
  const condition = pass.trim();

  if (condition === '' || EXIT_ZERO_DIRECTIVE.test(condition)) {
    return exitZeroHandler(exitedZero);
  }
  if (condition.startsWith('contains:')) {
    const needle = condition.slice('contains:'.length);
    return outputHandler(exitedZero, result.stdout.includes(needle));
  }
  if (condition.startsWith('regex:')) {
    const pattern = condition.slice('regex:'.length);
    return outputHandler(exitedZero, regexMatch(pattern, result.stdout));
  }
  // Default: substring match in stdout, exit 0 required.
  return outputHandler(exitedZero, result.stdout.includes(condition));
}

function applyPolicy(
  passed: boolean,
  policy: ProofOfWorkPolicy
): { gatePassed: boolean } {
  // hard-gate: phase blocked unless passed. warn: phase always allowed.
  return { gatePassed: passed || policy === 'warn' };
}

export interface RunProofOfWorkDeps {
  bash?: BashRunner;
  judge?: LlmJudge;
}

/**
 * Run a phase's proof-of-work and apply the gating policy. The caller is
 * responsible for only invoking this once the phase's changes are all done
 * (proof-of-work never runs while a phase has in-progress changes).
 *
 * `success` is the phase's success criteria from the resolved step context. The
 * `llm-judge` kind judges the running software against THAT criteria, not the
 * bash pass-condition (`proofOfWork.pass`) which only applies to the
 * integration/blackbox kinds.
 *
 * LIVE CALLER: `batch apply` (`runProofAtBoundary` in `src/commands/batch/apply.ts`)
 * runs this at the phase boundary — when a phase's changes are all done and the
 * next reachable phase still has work — and journals the verdict as a durable
 * `ProofOfWorkRecord` (see `journal.ts`). It executes at most once per boundary.
 *
 * GATED ON: the recorded verdict now drives the phase gate. `computeBatchStatus`
 * derives the next phase's gate from the prior phase's recorded `gatePassed`: a
 * failing `hard-gate` proof (`gatePassed: false`) keeps the next phase `blocked`
 * with a report citing the failing proof, while a passing proof (or `warn`, which
 * records `gatePassed: true`) opens it. Both selection seams read that single
 * derived gate, so a recorded failure blocks progression by construction.
 */
export async function runProofOfWork(
  proofOfWork: ProofOfWork,
  policy: ProofOfWorkPolicy,
  cwd: string,
  success: string,
  deps: RunProofOfWorkDeps = {}
): Promise<ProofOfWorkResult> {
  const bash = deps.bash ?? realBashRunner;

  if (proofOfWork.kind === 'llm-judge') {
    if (!deps.judge) {
      // No judge wired: fail closed under hard-gate so a phase never silently
      // passes an unrun judge.
      const passed = false;
      return {
        kind: proofOfWork.kind,
        passed,
        ...applyPolicy(passed, policy),
        policy,
        reason: 'error',
        detail: 'No llm-judge adapter configured for this run.',
      };
    }
    let verdict: JudgeVerdict;
    try {
      verdict = await deps.judge({
        success,
        run: proofOfWork.run,
        pass: proofOfWork.pass,
        cwd,
      });
    } catch (err) {
      const passed = false;
      return {
        kind: proofOfWork.kind,
        passed,
        ...applyPolicy(passed, policy),
        policy,
        reason: 'error',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    return {
      kind: proofOfWork.kind,
      passed: verdict.pass,
      ...applyPolicy(verdict.pass, policy),
      policy,
      reason: verdict.pass ? 'judge-pass' : 'judge-fail',
      detail: verdict.reason,
    };
  }

  // integration / blackbox: run the command via bash and evaluate pass.
  let result: BashResult;
  try {
    result = await bash(proofOfWork.run, cwd);
  } catch (err) {
    const passed = false;
    return {
      kind: proofOfWork.kind,
      passed,
      ...applyPolicy(passed, policy),
      policy,
      reason: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const evaluation = evaluatePassCondition(proofOfWork.pass, result);
  return {
    kind: proofOfWork.kind,
    passed: evaluation.passed,
    ...applyPolicy(evaluation.passed, policy),
    policy,
    reason: evaluation.reason,
    detail: evaluation.passed
      ? `Proof-of-work passed (${proofOfWork.pass}).`
      : `Proof-of-work failed: ${describeFail(evaluation.reason, result)}`,
  };
}

function describeFail(reason: string, result: BashResult): string {
  if (reason === 'nonzero-exit') return `command exited ${result.exitCode}`;
  if (reason === 'pass-condition-unmet') return 'pass condition not satisfied by output';
  return reason;
}
