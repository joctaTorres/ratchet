/**
 * Judge an eval case through the batch engine seams.
 *
 *   - `deterministic` kind -> `realBashRunner` runs the binding's command in the
 *     fixture working copy; `evaluatePassCondition` decides pass/fail.
 *   - `llm-judge` kind -> `resolveAdapter` + `realSpawner` spawn a fresh coding
 *     agent in the fixture working copy with instructions built from the
 *     scenario steps + the binding's success criteria, returning {pass, reason}.
 *
 * The llm-judge path is guarded so judge noise can never manufacture a regression:
 *   - FAIL CLOSED on uncertainty: a verdict without concrete evidence is not a
 *     pass; the missing evidence is named in the reason.
 *   - N-of-M votes (`agentVotes`, default 1, majority wins). When the votes do
 *     not agree the case is `unjudged` (disagreement noted) — never `fail`.
 *
 * Every judgment runs in the fixture working copy as cwd; no judgment reads or
 * mutates the host repository. All seams are injectable so tests never shell out
 * or spawn a real agent.
 */

import type { EvalCase } from './set.js';
import type { Binding, LlmJudgeBinding, DeterministicBinding } from './spec.js';
import {
  evaluatePassCondition,
  realBashRunner,
  realSpawner,
  resolveAdapter,
  type BashRunner,
  type Spawner,
  type JudgeVerdict,
  type AgentRequestContext,
} from '../batch/engine/index.js';

export type Verdict = 'pass' | 'fail' | 'unjudged';
export type JudgeMode = 'auto' | 'deterministic' | 'llm-judge';

export interface CaseVerdict {
  verdict: Verdict;
  /** Evidence (for fail) or reason (for unjudged / pass). */
  reason: string;
}

export interface JudgeDeps {
  bash?: BashRunner;
  spawner?: Spawner;
  /** Agent name for the judge subprocess (default resolves the engine default). */
  agentName?: string;
}

/** A spawned-agent vote: the parsed verdict plus whether evidence was present. */
interface AgentVote {
  pass: boolean;
  reason: string;
  /** True when the agent gave concrete evidence; false ⇒ fail closed. */
  hasEvidence: boolean;
}

function renderSteps(c: EvalCase): string {
  return c.steps.map((s) => `  ${s.keyword} ${s.text}`).join('\n');
}

/** Build the judge instructions a spawned agent reads from stdin. */
export function buildJudgeInstructions(c: EvalCase, success: string): string {
  return [
    'You are an eval JUDGE. Decide whether the codebase in your working directory',
    'satisfies the scenario below. You must base your verdict on CONCRETE EVIDENCE',
    'you observe in the working directory — run commands, read files. Do NOT guess.',
    '',
    `Feature: ${c.feature}`,
    `Scenario: ${c.scenario}`,
    renderSteps(c),
    '',
    'Success criteria:',
    success,
    '',
    'Report your verdict on the LAST line as strict JSON:',
    '  {"pass": true|false, "reason": "<concrete evidence, or what evidence is missing>"}',
    'If you cannot find concrete evidence either way, set pass=false and name the',
    'missing evidence in reason. Fail closed: uncertainty is never a pass.',
  ].join('\n');
}

/** Parse the agent's stdout into a vote, failing closed on anything unclear. */
export function parseAgentVote(stdout: string): AgentVote {
  const verdict = extractVerdictJson(stdout);
  if (!verdict) {
    return {
      pass: false,
      reason: 'No verdict JSON found in judge output; failing closed (no concrete evidence).',
      hasEvidence: false,
    };
  }
  const reason = verdict.reason.trim();
  const hasEvidence = reason.length > 0;
  // Fail closed: a "pass" with no stated evidence is treated as no-evidence.
  if (verdict.pass && !hasEvidence) {
    return {
      pass: false,
      reason: 'Judge reported pass without naming concrete evidence; failing closed.',
      hasEvidence: false,
    };
  }
  return { pass: verdict.pass, reason, hasEvidence };
}

/**
 * Find the last balanced `{...}` block that parses as a verdict. Scanning for
 * balanced braces (rather than a single brace-free regex) means a `reason`
 * containing `{`, `}`, or newlines still parses. Fails closed: any block that
 * does not parse, or lacks a boolean `pass`, is ignored.
 */
function extractVerdictJson(stdout: string): JudgeVerdict | null {
  for (const block of balancedBraceBlocks(stdout).reverse()) {
    const verdict = parseVerdictBlock(block);
    if (verdict) return verdict;
  }
  return null;
}

/**
 * Every top-level `{...}` substring with balanced braces, in order. Braces and
 * escapes inside JSON string literals are skipped, so a `reason` value
 * containing `{`/`}` does not prematurely open or close a block.
 */
function balancedBraceBlocks(text: string): string[] {
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
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) blocks.push(text.slice(start, i + 1));
    }
  }
  return blocks;
}

function parseVerdictBlock(block: string): JudgeVerdict | null {
  try {
    const parsed = JSON.parse(block) as JudgeVerdict;
    if (typeof parsed.pass !== 'boolean') return null;
    return { pass: parsed.pass, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
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
function buildVoteRequest(c: EvalCase, cwd: string, success: string, agentName?: string) {
  const instructions = buildJudgeInstructions(c, success);
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
  cwd: string,
  spawner: Spawner,
  agentName?: string
): Promise<AgentVote> {
  const request = buildVoteRequest(c, cwd, binding.success, agentName);
  const result = await spawner(request);
  return parseAgentVote(result.stdout);
}

/** Resolve N votes into a single verdict: majority wins; a tie/disagreement is
 * `unjudged` (never a silent fail). */
export function resolveVotes(votes: AgentVote[]): CaseVerdict {
  const passes = votes.filter((v) => v.pass).length;
  const fails = votes.length - passes;
  if (passes > fails) {
    const evidence = votes.find((v) => v.pass)?.reason ?? 'judge pass';
    return { verdict: 'pass', reason: evidence };
  }
  if (fails > passes) {
    // Unanimous-enough fail. Surface a failing vote's reason as evidence.
    if (passes === 0) {
      return { verdict: 'fail', reason: votes[0]?.reason ?? 'judge fail' };
    }
    // Mixed but fail-leaning: a disagreement, not a clean fail.
    return disagreement(votes);
  }
  return disagreement(votes);
}

function disagreement(votes: AgentVote[]): CaseVerdict {
  const summary = votes.map((v, i) => `vote ${i + 1}: ${v.pass ? 'pass' : 'fail'}`).join(', ');
  return {
    verdict: 'unjudged',
    reason: `Judge votes disagreed (${summary}); recorded unjudged rather than risk a false regression.`,
  };
}

async function judgeAgent(
  c: EvalCase,
  binding: LlmJudgeBinding,
  cwd: string,
  deps: JudgeDeps
): Promise<CaseVerdict> {
  const spawner = deps.spawner ?? realSpawner;
  const n = binding.agentVotes ?? 1;
  const votes: AgentVote[] = [];
  for (let i = 0; i < n; i++) {
    votes.push(await castVote(c, binding, cwd, spawner, deps.agentName));
  }
  return resolveVotes(votes);
}

async function judgeCheck(
  binding: DeterministicBinding,
  cwd: string,
  deps: JudgeDeps
): Promise<CaseVerdict> {
  const bash = deps.bash ?? realBashRunner;
  const result = await bash(binding.check.run, cwd);
  const evaluation = evaluatePassCondition(binding.check.pass, result);
  if (evaluation.passed) {
    return { verdict: 'pass', reason: `check passed (${binding.check.pass})` };
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  return {
    verdict: 'fail',
    reason: `check failed (${evaluation.reason})${detail ? `: ${detail.slice(0, 500)}` : ''}`,
  };
}

/**
 * Judge a single bound case against its materialized fixture working copy.
 * `mode` honours `--judge`: `deterministic` skips llm-judge cases (→ unjudged),
 * `llm-judge` forces the spawned-judge path where success criteria exist, `auto`
 * follows the bound kind.
 */
export async function judgeCase(
  c: EvalCase,
  binding: Binding,
  cwd: string,
  mode: JudgeMode,
  deps: JudgeDeps = {}
): Promise<CaseVerdict> {
  if (binding.kind === 'deterministic') {
    if (mode === 'llm-judge') {
      return { verdict: 'unjudged', reason: 'Judge mode "llm-judge" but case is bound as a deterministic check.' };
    }
    return judgeCheck(binding, cwd, deps);
  }
  // llm-judge binding
  if (mode === 'deterministic') {
    return { verdict: 'unjudged', reason: 'Judge mode "deterministic" skips llm-judge-only cases.' };
  }
  return judgeAgent(c, binding, cwd, deps);
}
