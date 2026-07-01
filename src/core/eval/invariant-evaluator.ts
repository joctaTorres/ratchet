/**
 * Per-invariant evaluator for the anti-gaming invariant set.
 *
 * Given a single loaded `Invariant` (from `invariants.ts`) plus the run state,
 * computes exactly one outcome — `pass`, `fail`, or `unevaluable` — for each of
 * the three kinds, recording the invariant's measure and the evidence behind the
 * status. Wiring the evaluator into the `invariants` gate contributor over the
 * loaded manifest is the downstream change; this slice decides one invariant at
 * a time.
 *
 *   - `deterministic` — run the `check.run` predicate (cwd = project root) and
 *     decide pass/fail with the engine's `evaluatePassCondition` (the same
 *     `exit-zero` / `contains:` / `regex:` / substring vocabulary the
 *     deterministic *binding* uses); a predicate that throws is `unevaluable`.
 *   - `monotonic` — resolve the named `measure` to a current value over the run
 *     and compare it non-decreasing against the same measure derived from the
 *     baseline run; `current ≥ baseline` passes, `current < baseline` fails. A
 *     missing baseline run/measure, or an unresolvable measure name, is
 *     `unevaluable`.
 *   - `snapshot` — read the checked-in `golden`, run `produce.run`, and diff its
 *     trimmed stdout against the trimmed golden; equal passes, differing fails.
 *     An absent golden, or a `produce` command that throws, is `unevaluable`.
 *   - `mutation` — run the mutation harness (seeds up to `budget` mutants via
 *     the configured agent, gates each on the invariant's own `test` command as
 *     the oracle) and reduce its per-mutant kill/survive results: any survived
 *     mutant is a hard `fail` regardless of how many others were killed; fewer
 *     than `threshold` evaluated mutants (with none surviving) is `unevaluable`
 *     — not enough evidence to trust a "no survivors" claim. A harness call that
 *     throws, or an unusable working tree, is also `unevaluable`.
 *
 * The governing rule for every kind is **fail-closed**: any invariant that
 * cannot be evaluated is recorded `unevaluable`, which `isInvariantViolation`
 * treats as a violation exactly like `fail`. A kind that silently resolves to
 * `pass` when it could not actually be checked is the vacuous-pass gaming hole
 * the invariant set exists to close, so `unevaluable` is a first-class status
 * that is never folded into `pass`.
 *
 * Every command-running and file-reading dependency is injected (`bash`,
 * `readFile`), mirroring `judge.ts`, so the decision logic is provable without a
 * real spawn or a real filesystem.
 */

import path from 'node:path';
import { readFile as fsReadFile } from 'node:fs/promises';
import type {
  Invariant,
  InvariantKind,
  DeterministicInvariant,
  MonotonicInvariant,
  SnapshotInvariant,
  MutationInvariant,
} from './invariants.js';
import type { EvalRun } from './run.js';
import { evaluatePassCondition, realBashRunner, type BashRunner, type Spawner } from '../batch/engine/index.js';
import { runMutationHarness, type MutationHarnessOutcome } from './mutation-harness.js';

/** Three-valued status. `unevaluable` is *not pass*: it is a fail-closed violation. */
export type InvariantStatus = 'pass' | 'fail' | 'unevaluable';

export interface InvariantOutcome {
  id: string;
  kind: InvariantKind;
  status: InvariantStatus;
  /** Human-readable measure recorded for the invariant (e.g. `scenario-count: 12 (baseline 10)`). */
  measure: string;
  /** Evidence behind the status: the pass condition met, the predicate output, a
   *  match/mismatch, or why the invariant could not be evaluated. */
  evidence: string;
}

/** Reads a file's UTF-8 contents; rejects when the file is absent (⇒ unevaluable). */
export type FileReader = (filePath: string) => Promise<string>;

/** Default reader: real fs. An absent file rejects, which the snapshot path treats
 *  as an absent golden. */
export const realFileReader: FileReader = (filePath) => fsReadFile(filePath, 'utf-8');

/**
 * In-memory inputs an invariant is evaluated against. `bash` and `readFile` are
 * injectable seams (default to the real runners) so tests never spawn or touch
 * the filesystem.
 */
export interface InvariantEvalContext {
  /** Project root: the cwd for `check.run` / `produce.run` and the base for `golden`. */
  projectRoot: string;
  /** The run being gated. */
  run: EvalRun;
  /** The baseline run a monotonic measure is compared against, or `null` if none. */
  baseline: EvalRun | null;
  bash?: BashRunner;
  readFile?: FileReader;
  spawner?: Spawner;
  agentName?: string;
}

/**
 * A measure resolver derives one number from a run. Returns `undefined` when the
 * measure cannot be derived from that run (⇒ unevaluable, never a crash).
 */
export type MeasureResolver = (run: EvalRun) => number | undefined;

/**
 * The extensible measure registry. Ships exactly one ecosystem-neutral built-in,
 * `scenario-count` (`run.cases.length`), computed from run state with no command
 * — so the evaluator bakes in no toolchain. New measures register here without
 * touching the evaluator.
 */
export const MEASURE_RESOLVERS: Record<string, MeasureResolver> = {
  'scenario-count': (run) => run.cases.length,
};

/** Both `fail` and `unevaluable` are violations: anything that is not `pass`. */
export function isInvariantViolation(outcome: InvariantOutcome): boolean {
  return outcome.status !== 'pass';
}

function pass(inv: Invariant, measure: string, evidence: string): InvariantOutcome {
  return { id: inv.id, kind: inv.kind, status: 'pass', measure, evidence };
}

function fail(inv: Invariant, measure: string, evidence: string): InvariantOutcome {
  return { id: inv.id, kind: inv.kind, status: 'fail', measure, evidence };
}

function unevaluable(inv: Invariant, measure: string, evidence: string): InvariantOutcome {
  return { id: inv.id, kind: inv.kind, status: 'unevaluable', measure, evidence };
}

async function evaluateDeterministic(
  inv: DeterministicInvariant,
  ctx: InvariantEvalContext
): Promise<InvariantOutcome> {
  const bash = ctx.bash ?? realBashRunner;
  const measure = `check: ${inv.check.run}`;
  let result;
  try {
    result = await bash(inv.check.run, ctx.projectRoot);
  } catch (err) {
    // Fail closed: a predicate that cannot run is unevaluable, never a pass.
    return unevaluable(
      inv,
      measure,
      `predicate could not be evaluated: ${(err as Error).message}`
    );
  }
  const evaluation = evaluatePassCondition(inv.check.pass, result);
  if (evaluation.passed) {
    return pass(inv, measure, `pass condition met (${inv.check.pass})`);
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  return fail(
    inv,
    measure,
    `predicate failed (${evaluation.reason})${detail ? `: ${detail.slice(0, 500)}` : ''}`
  );
}

function evaluateMonotonic(inv: MonotonicInvariant, ctx: InvariantEvalContext): InvariantOutcome {
  const resolver = MEASURE_RESOLVERS[inv.measure];
  if (!resolver) {
    // Fail closed: an unknown measure name cannot be checked, so it is a violation.
    return unevaluable(inv, inv.measure, `unknown measure '${inv.measure}'; cannot resolve over the run`);
  }
  const current = resolver(ctx.run);
  if (current === undefined) {
    return unevaluable(inv, inv.measure, `measure '${inv.measure}' could not be resolved over the run`);
  }
  if (!ctx.baseline) {
    return unevaluable(
      inv,
      `${inv.measure}: ${current} (baseline missing)`,
      `baseline measure for '${inv.measure}' was missing (no baseline run)`
    );
  }
  const baselineValue = resolver(ctx.baseline);
  if (baselineValue === undefined) {
    return unevaluable(
      inv,
      `${inv.measure}: ${current} (baseline missing)`,
      `baseline measure for '${inv.measure}' was missing (not derivable from the baseline run)`
    );
  }
  const measure = `${inv.measure}: ${current} (baseline ${baselineValue})`;
  if (current >= baselineValue) {
    return pass(inv, measure, `current ${current} ≥ baseline ${baselineValue}`);
  }
  return fail(inv, measure, `current ${current} < baseline ${baselineValue}`);
}

async function evaluateSnapshot(
  inv: SnapshotInvariant,
  ctx: InvariantEvalContext
): Promise<InvariantOutcome> {
  const readFile = ctx.readFile ?? realFileReader;
  const measure = `snapshot: ${inv.golden}`;
  const goldenPath = path.resolve(ctx.projectRoot, inv.golden);
  let golden: string;
  try {
    golden = await readFile(goldenPath);
  } catch {
    // Fail closed: no golden to diff against ⇒ cannot be checked ⇒ violation.
    return unevaluable(inv, measure, `golden was absent (${inv.golden})`);
  }
  const bash = ctx.bash ?? realBashRunner;
  let result;
  try {
    result = await bash(inv.produce.run, ctx.projectRoot);
  } catch (err) {
    return unevaluable(inv, measure, `produce command could not run: ${(err as Error).message}`);
  }
  const produced = result.stdout.trim();
  const expected = golden.trim();
  if (produced === expected) {
    return pass(inv, measure, 'produced output matched the golden');
  }
  return fail(inv, measure, `produced output differs from the golden (${inv.golden})`);
}

/**
 * `mutation` runs the mutation harness (seed via the configured agent, the
 * user's own `test` command as the oracle) and reduces its per-mutant
 * kill/survive results to an outcome: any `survived` mutant is a hard `fail`
 * regardless of how many others were killed (checked before the threshold,
 * since a survived mutant is real evidence of a test-suite gap no matter how
 * few mutants the budget allowed); short of that, fewer evaluated mutants
 * than `threshold` is `unevaluable` (too little evidence to trust "no
 * survivors"); a harness call that throws, or an `unusable-working-tree`
 * result, is also `unevaluable` — fail-closed, never a silent pass.
 */
async function evaluateMutation(
  inv: MutationInvariant,
  ctx: InvariantEvalContext
): Promise<InvariantOutcome> {
  const measureBase = `mutation: ${inv.test} (budget ${inv.budget}, threshold ${inv.threshold})`;
  let harnessOutcome: MutationHarnessOutcome;
  try {
    harnessOutcome = await runMutationHarness(inv, ctx.projectRoot, {
      bash: ctx.bash,
      spawner: ctx.spawner,
      agentName: ctx.agentName,
    });
  } catch (err) {
    // Fail closed: an oracle/harness that cannot run at all is unevaluable,
    // never a silent pass — mirrors evaluateDeterministic's predicate-throws path.
    return unevaluable(inv, measureBase, `mutation harness could not run: ${(err as Error).message}`);
  }

  if (harnessOutcome.kind === 'unusable-working-tree') {
    return unevaluable(
      inv,
      measureBase,
      `working tree was not usable for mutation seeding: ${harnessOutcome.reason}`
    );
  }

  const { mutants } = harnessOutcome;
  const survived = mutants.filter((m) => m.outcome === 'survived');
  const measure = `${measureBase} — ${mutants.length} evaluated, ${survived.length} survived`;

  if (survived.length > 0) {
    const first = survived[0]!;
    return fail(
      inv,
      measure,
      `${survived.length} of ${mutants.length} evaluated mutant(s) survived (e.g. attempt #${first.index}): ${first.diff.slice(0, 500)}`
    );
  }
  if (mutants.length < inv.threshold) {
    return unevaluable(
      inv,
      measure,
      `only ${mutants.length} of ${inv.threshold} required mutants reached a kill/survive verdict (budget ${inv.budget}); too few to trust the invariant`
    );
  }
  return pass(inv, measure, `all ${mutants.length} evaluated mutant(s) were killed`);
}

/**
 * Compute the single outcome for one loaded invariant against the run state.
 * Dispatches on the invariant kind; every kind fails closed to `unevaluable`
 * rather than `pass` when it cannot be checked.
 */
export async function evaluateInvariant(
  invariant: Invariant,
  context: InvariantEvalContext
): Promise<InvariantOutcome> {
  switch (invariant.kind) {
    case 'deterministic':
      return evaluateDeterministic(invariant, context);
    case 'monotonic':
      return evaluateMonotonic(invariant, context);
    case 'snapshot':
      return evaluateSnapshot(invariant, context);
    case 'mutation':
      return evaluateMutation(invariant, context);
  }
}
