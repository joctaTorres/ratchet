/**
 * Judge an eval case through the batch engine seams.
 *
 *   - `deterministic` kind -> `realBashRunner` runs the binding's command in the
 *     fixture working copy; `evaluatePassCondition` decides pass/fail.
 *   - `llm-judge` kind -> `resolveAdapter` + `realSpawner` spawn a fresh coding
 *     agent in the fixture working copy with instructions built from a
 *     per-Then-clause rubric, returning a structured per-clause verdict.
 *
 * The llm-judge path decomposes the scenario's Gherkin Then-clauses into a
 * binary rubric (one item per Then/And/But-under-Then step, or an explicit
 * `rubric:` override) and is guarded so judge noise can never manufacture a
 * regression:
 *   - FAIL CLOSED on uncertainty: a clause without concrete "yes" evidence
 *     (a "no", a "can't-tell", or no verdict at all) does not pass; a vote
 *     passes only when every clause passes.
 *   - A jury (`votes`, default 1; `quorum`, default `majority`) resolved by
 *     `resolveJury` from a per-binding override layered over the project's
 *     `eval.jury` default. When cast votes do not reach the configured quorum
 *     the case is `unjudged` (sub-quorum noted) — never a guessed `fail`.
 *
 * Every judgment runs in the fixture working copy as cwd; no judgment reads or
 * mutates the host repository. All seams are injectable so tests never shell out
 * or spawn a real agent.
 */

import type { EvalCase } from './set.js';
import type { Binding, LlmJudgeBinding, DeterministicBinding } from './spec.js';
import { resolveJury, type Jury, type Quorum } from './jury.js';
import {
  evaluatePassCondition,
  realBashRunner,
  realSpawner,
  resolveAdapter,
  type BashRunner,
  type Spawner,
  type AgentRequestContext,
} from '../batch/engine/index.js';

export type Verdict = 'pass' | 'fail' | 'unjudged' | 'skipped';

/** The independent, evidence-cited result of one rubric clause. */
export interface ClauseResult {
  clause: string;
  pass: boolean;
  evidence: string;
}

/** The narrow result `resolveVotes` (and `subQuorum`) decide from already-cast votes. */
export interface VoteResolution {
  verdict: Verdict;
  /** Structured per-clause result of the deciding vote (or `votes[0]` when no vote decided the case). */
  evidence: ClauseResult[];
}

export interface CaseVerdict extends VoteResolution {
  /** The resolved rubric used to judge the case (derived from Then-clauses, or the declared `rubric:` override). */
  rubric: string[];
  /** Every juror's individual vote, in cast order. */
  votes: JurorVote[];
}

export interface JudgeDeps {
  bash?: BashRunner;
  spawner?: Spawner;
  /** Agent name for the judge subprocess (default resolves the engine default). */
  agentName?: string;
  /** Project-level jury default, layered under a per-binding `jury:` override. */
  jury?: Jury;
}

/** A juror's vote: the structured per-clause result plus the all-yes-derived overall pass. */
export interface JurorVote {
  pass: boolean;
  clauses: ClauseResult[];
}

function renderSteps(c: EvalCase): string {
  return c.steps.map((s) => `  ${s.keyword} ${s.text}`).join('\n');
}

/**
 * Derive the binary rubric for a case: one item per `Then` step, plus one item
 * for every `And`/`But` step that follows it (until the next `Given`/`When`/
 * `Then` step closes the clause). `And`/`But` steps rooted under `Given`/`When`
 * are excluded. `binding.rubric`, when present, is used verbatim and steps are
 * not consulted at all.
 */
export function deriveRubric(c: EvalCase, binding: LlmJudgeBinding): string[] {
  if (binding.rubric && binding.rubric.length > 0) return binding.rubric;
  const rubric: string[] = [];
  let inThenClause = false;
  for (const step of c.steps) {
    if (step.keyword === 'Then') {
      rubric.push(step.text);
      inThenClause = true;
    } else if ((step.keyword === 'And' || step.keyword === 'But') && inThenClause) {
      rubric.push(step.text);
    } else {
      inThenClause = false;
    }
  }
  return rubric;
}

/** Build the judge instructions a spawned agent reads from stdin. */
export function buildJudgeInstructions(c: EvalCase, binding: LlmJudgeBinding): string {
  const rubric = deriveRubric(c, binding);
  const rubricList = rubric.map((item, i) => `  ${i + 1}. ${item}`).join('\n');
  return [
    'You are an eval JUDGE. Decide whether the codebase in your working directory',
    'satisfies EVERY clause of the rubric below. You must base each clause\'s',
    'verdict on CONCRETE EVIDENCE you observe in the working directory — run',
    'commands, read files. Do NOT guess.',
    '',
    `Feature: ${c.feature}`,
    `Scenario: ${c.scenario}`,
    renderSteps(c),
    '',
    'Success criteria:',
    binding.success,
    '',
    'Rubric — judge each clause independently and in order:',
    rubricList,
    '',
    'For EACH clause above: first reason step by step about what you observe in',
    'the working directory relevant to that clause, THEN state that clause\'s',
    'verdict. Reach your own, independent judgment from the evidence you find —',
    'do not assume the scenario or success criteria description is accurate, and',
    'do not let a clause\'s framing talk you into a "yes". Answer "can\'t-tell" for',
    'a clause when your evidence is inconclusive; uncertainty is never a "yes".',
    '',
    'Report your verdict on the LAST line as strict JSON: a single array with one',
    'entry per rubric clause above, in the same order:',
    '  [{"clause": "<rubric item text>", "verdict": "yes"|"no"|"can\'t-tell", "evidence": "<concrete evidence, or what evidence is missing>"}]',
    'A clause with no stated evidence is never a "yes". Fail closed: uncertainty',
    'is never a pass.',
  ].join('\n');
}

/** One entry of the agent's reported verdict array, before validation. */
interface RawClauseEntry {
  clause?: unknown;
  verdict?: unknown;
  evidence?: unknown;
}

/** Judge a single rubric clause against its (possibly missing) reported entry. */
function judgeClause(clauseText: string, entry: RawClauseEntry | undefined): ClauseResult {
  if (!entry) {
    return {
      clause: clauseText,
      pass: false,
      evidence: 'No verdict for this clause in judge output; failing closed (no concrete evidence).',
    };
  }
  const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
  if (entry.verdict === 'yes') {
    if (evidence.length === 0) {
      return {
        clause: clauseText,
        pass: false,
        evidence: 'Judge reported "yes" without naming concrete evidence; failing closed.',
      };
    }
    return { clause: clauseText, pass: true, evidence };
  }
  if (entry.verdict === 'no') {
    return {
      clause: clauseText,
      pass: false,
      evidence: evidence || 'Judge reported "no" for this clause; no evidence given.',
    };
  }
  // "can't-tell", or any other/unparseable verdict value: fail closed.
  return {
    clause: clauseText,
    pass: false,
    evidence:
      evidence || 'Judge could not find conclusive evidence for this clause ("can\'t-tell"); failing closed.',
  };
}

/**
 * Parse the agent's stdout into a vote against the case's rubric, failing
 * closed on anything unclear. `rubric` is the ordered clause list the agent
 * was asked to judge: entries are matched to clauses by POSITION (the prompt
 * asks for one entry per clause, in rubric order) rather than by echoed
 * clause text, since an agent may paraphrase the clause it is judging. A
 * missing or unparseable entry at a clause's position fails that clause
 * closed; the vote passes only when every clause passes.
 */
export function parseAgentVote(stdout: string, rubric: string[]): JurorVote {
  const raw = extractVerdictJson(stdout);
  const clauses: ClauseResult[] = rubric.map((clauseText, i) => judgeClause(clauseText, raw?.[i]));
  const pass = clauses.length > 0 && clauses.every((cl) => cl.pass);
  return { pass, clauses };
}

/**
 * Find the last balanced top-level `[...]` array that parses as a JSON array.
 * Scanning for balanced brackets (rather than a bracket-free regex) means an
 * `evidence` string containing `[`, `]`, or newlines still parses. Fails
 * closed: any block that does not parse, or is not an array, is ignored.
 */
function extractVerdictJson(stdout: string): RawClauseEntry[] | null {
  for (const block of balancedBlocks(stdout, '[', ']').reverse()) {
    const parsed = parseVerdictArrayBlock(block);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Every top-level substring delimited by `open`/`close` with balanced
 * nesting, in source order. Delimiters and escapes inside JSON string
 * literals are skipped, so a string value containing `open`/`close` does not
 * prematurely open or close a block.
 */
function balancedBlocks(text: string, open: string, close: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === close && depth > 0) {
      depth--;
      if (depth === 0) blocks.push(text.slice(start, i + 1));
    }
  }
  return blocks;
}

function parseVerdictArrayBlock(block: string): RawClauseEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(block);
    return Array.isArray(parsed) ? (parsed as RawClauseEntry[]) : null;
  } catch {
    return null;
  }
}

/** A minimal, fully-typed adapter context; adapters ignore it when building argv. */
function judgeContext(c: EvalCase): AgentRequestContext {
  return { batch: 'eval', change: c.id };
}

/**
 * Build the spawn request for one judge vote. When `RATCHET_EVAL_AGENT_CMD` is
 * set, that command stands in for the coding-agent binary (used by e2e tests to
 * exercise the agent path deterministically without a real agent). Otherwise the
 * configured adapter is resolved as usual.
 */
function buildVoteRequest(c: EvalCase, binding: LlmJudgeBinding, cwd: string, agentName?: string) {
  const instructions = buildJudgeInstructions(c, binding);
  const override = process.env.RATCHET_EVAL_AGENT_CMD;
  if (override && override.trim().length > 0) {
    return { command: 'bash', args: ['-c', override], instructions, cwd, env: process.env };
  }
  const adapter = resolveAdapter(agentName);
  return adapter.buildRequest(judgeContext(c), instructions, cwd, process.env);
}

async function castVote(
  c: EvalCase,
  binding: LlmJudgeBinding,
  rubric: string[],
  cwd: string,
  spawner: Spawner,
  agentName?: string
): Promise<JurorVote> {
  const request = buildVoteRequest(c, binding, cwd, agentName);
  const result = await spawner(request);
  return parseAgentVote(result.stdout, rubric);
}

/**
 * Resolve N cast votes into a single case verdict under a configured quorum.
 * Both quorum kinds are symmetric — the same rule decides a pass and a fail —
 * and either never reaches quorum, in which case the case is `unjudged` (never
 * a guess):
 *
 *   - `majority`: `pass` when passing votes are a strict majority, `fail` when
 *     failing votes are a strict majority, otherwise (a tie) sub-quorum.
 *   - `unanimous`: `pass` only when every vote passes, `fail` only when every
 *     vote fails, otherwise (any split) sub-quorum.
 */
export function resolveVotes(votes: JurorVote[], quorum: Quorum = 'majority'): VoteResolution {
  const passes = votes.filter((v) => v.pass).length;
  const fails = votes.length - passes;
  if (quorum === 'unanimous') {
    if (fails === 0 && votes.length > 0) return { verdict: 'pass', evidence: votes[0]?.clauses ?? [] };
    if (passes === 0 && votes.length > 0) return { verdict: 'fail', evidence: votes[0]?.clauses ?? [] };
    return subQuorum(votes, quorum);
  }
  if (passes > fails) {
    const deciding = votes.find((v) => v.pass);
    return { verdict: 'pass', evidence: deciding?.clauses ?? [] };
  }
  if (fails > passes) {
    const deciding = votes.find((v) => !v.pass);
    return { verdict: 'fail', evidence: deciding?.clauses ?? [] };
  }
  return subQuorum(votes, quorum);
}

/** Build the `unjudged` verdict for a vote tally that did not reach its configured quorum. */
function subQuorum(votes: JurorVote[], quorum: Quorum): VoteResolution {
  const summary = votes.map((v, i) => `vote ${i + 1}: ${v.pass ? 'pass' : 'fail'}`).join(', ');
  return {
    verdict: 'unjudged',
    evidence: [
      {
        clause: '(jury sub-quorum)',
        pass: false,
        evidence: `Votes did not reach ${quorum} quorum (${summary}); recorded unjudged rather than risk a false regression.`,
      },
    ],
  };
}

async function judgeAgent(
  c: EvalCase,
  binding: LlmJudgeBinding,
  cwd: string,
  deps: JudgeDeps
): Promise<CaseVerdict> {
  const spawner = deps.spawner ?? realSpawner;
  const rubric = deriveRubric(c, binding);
  const { votes: n, quorum } = resolveJury({ config: deps.jury, binding: binding.jury });
  const votes: JurorVote[] = [];
  for (let i = 0; i < n; i++) {
    votes.push(await castVote(c, binding, rubric, cwd, spawner, deps.agentName));
  }
  return { ...resolveVotes(votes, quorum), rubric, votes };
}

async function judgeCheck(
  binding: DeterministicBinding,
  cwd: string,
  deps: JudgeDeps
): Promise<CaseVerdict> {
  const bash = deps.bash ?? realBashRunner;
  const result = await bash(binding.check.run, cwd);
  const evaluation = evaluatePassCondition(binding.check.pass, result);
  const rubric = [binding.check.pass];
  if (evaluation.passed) {
    const clauses: ClauseResult[] = [
      { clause: binding.check.pass, pass: true, evidence: `check passed (${binding.check.pass})` },
    ];
    return { verdict: 'pass', evidence: clauses, rubric, votes: [{ pass: true, clauses }] };
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  const clauses: ClauseResult[] = [
    {
      clause: binding.check.pass,
      pass: false,
      evidence: `check failed (${evaluation.reason})${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    },
  ];
  return { verdict: 'fail', evidence: clauses, rubric, votes: [{ pass: false, clauses }] };
}

/**
 * Judge a single bound case against its materialized fixture working copy,
 * dispatching on the bound kind. Which contributors run is decided upstream by
 * the gate (see `execute.ts`); a case only reaches here once its contributor is
 * enabled, so judging always follows the binding kind.
 */
export async function judgeCase(
  c: EvalCase,
  binding: Binding,
  cwd: string,
  deps: JudgeDeps = {}
): Promise<CaseVerdict> {
  if (binding.kind === 'deterministic') {
    return judgeCheck(binding, cwd, deps);
  }
  if (binding.kind === 'llm-judge') {
    return judgeAgent(c, binding, cwd, deps);
  }
  // The `web` binding lifecycle harness (boot/readiness/Playwright run) is wired
  // in a later change of the `playwright-web-tier` phase; this change only makes
  // the binding representable.
  throw new Error(`Web binding execution is not yet implemented for case '${c.id}'.`);
}
