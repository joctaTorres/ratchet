/**
 * Attributed model-failure surface — integration proof (phase proof-of-work for
 * model-failure-attribution).
 *
 * Implements:
 *  - features/model-failure-attribution/attribution-hint.feature
 *  - features/model-failure-attribution/unchanged-surfaces.feature
 *  - features/signal-kill-hint-gate/signal-kill-hint-gate.feature
 *
 * Drives `runChangeStep` over a tmpdir fixture with an injected runtime exiting
 * non-zero and writing no journal entries (the argv-rejection signature). An
 * explicit-model transition with threaded `agentStageScopes` surfaces a blocked,
 * resumable step whose `detail` names the stage, agent, exact model string, and
 * supplying scope above the stderr tail — with exactly one spawn and no fallback
 * model. A bare-name spec and a session-progressed failure surface byte-for-byte
 * unchanged (no hint, no attribution). A signal-killed spawn (SIGKILL) under an
 * explicit model surfaces WITHOUT the hint on every rendered surface (the gate
 * requires a real non-zero exit code), while an exit-code fast failure keeps it.
 *
 * Phase proof-of-work: `pnpm test test/batch-engine/model-failure-attribution.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type {
  AgentSpawnRequest,
  Spawner,
} from '../../src/core/batch/engine/agent.js';
import { spawnerAsRuntime } from '../helpers/spawner-as-runtime.js';
import type {
  ChangeStepContext,
  DecompositionStepContext,
  PrStepContext,
  Transition,
} from '../../src/core/batch/engine/contract.js';
import type { BatchSettings, ProofOfWork } from '../../src/core/batch/config.js';
import type { SettingSource } from '../../src/core/batch/config.js';
import type { AgentStage } from '../../src/core/batch/agent-setting.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import {
  parkStep,
  getParkedStep,
  readJournal,
} from '../../src/core/batch/journal.js';
import { renderStepResult } from '../../src/commands/change-step-common.js';
import {
  prJournalKey,
  decompositionJournalKey,
} from '../../src/core/batch/engine/instructions.js';

const ENV = 'RATCHET_BATCH_AGENT_CMD';
const BATCH = 'mfa';
const CHANGE = 'c1';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };
const STDERR = 'error: unknown model id "zai/glm-5.2"';

// The full hint text the mapper threads into `blocker`/`message`/`detail` for
// the attributed argv-rejection signature (matches `modelAttributionHint`
// output for stage=apply, agent=opencode, model=zai/glm-5.2, scope=project).
const HINT =
  'The "apply" stage ran the "opencode" agent with model "zai/glm-5.2" ' +
  'supplied by the project config. If this model id is invalid or not ' +
  'available to this agent, correct the `agent` setting at that scope and resume.';

let projectRoot: string;
let savedEnv: string | undefined;
let calls: AgentSpawnRequest[];
let spawnerBehavior: 'fail-fast' | 'fail-fast-progress' | 'signal-kill';

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'model-failure-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  savedEnv = process.env[ENV];
  delete process.env[ENV];
  calls = [];
  spawnerBehavior = 'fail-fast';
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/**
 * The fake Spawner: captures the request the engine built (with the REAL builtin
 * adapters) and returns a non-zero exit with stderr, writing NO journal entries
 * (the argv-rejection signature) by default. In `fail-fast-progress` mode it
 * writes a `progress` journal entry during the session before failing, so the
 * mapper's zero-session-entries gate does not fire. In `signal-kill` mode it
 * returns `{ exitCode: null, signal: 'SIGKILL', stderr }` — a spawn killed by
 * an external signal (e.g. a `timeout` SIGKILL) — still writing no journal
 * entries, so the gate's signal discriminator is what suppresses the hint.
 */
const spawner: Spawner = async (request) => {
  calls.push(request);
  if (spawnerBehavior === 'fail-fast-progress') {
    // Simulate the agent making journal progress before failing: append a
    // `progress` entry to the run-state journal during the session.
    appendJournalForLocus(projectRoot, { batch: BATCH }, {
      change: CHANGE,
      kind: 'progress',
      message: 'started parsing the change',
      transition: 'apply',
    });
  }
  if (spawnerBehavior === 'signal-kill') {
    return { exitCode: null, signal: 'SIGKILL', stdout: '', stderr: STDERR };
  }
  return { exitCode: 2, signal: null, stdout: '', stderr: STDERR };
};

function engine(): RatchetBatchEngine {
  return new RatchetBatchEngine({
    runtime: spawnerAsRuntime(spawner),
    projectRoot: () => projectRoot,
    skillLocusDeps: { exists: () => true, writeText: () => {} },
  });
}

function settings(agent: BatchSettings['agent']): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    agent,
  };
}

function ctx(
  transition: Transition,
  agent: BatchSettings['agent'],
  override?: Partial<ChangeStepContext>
): ChangeStepContext {
  return {
    batch: BATCH,
    change: CHANGE,
    changeDone: 'the change is done',
    transition,
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(agent),
    journal: [],
    ...override,
  };
}

function stageScopes(
  scope: SettingSource,
  stages: AgentStage[] = ['propose', 'apply', 'verify', 'pr', 'decompose']
): Partial<Record<AgentStage, SettingSource>> {
  const out: Partial<Record<AgentStage, SettingSource>> = {};
  for (const s of stages) out[s] = scope;
  return out;
}

// -----------------------------------------------------------------------------
// Scenario: Fast failure under an explicit model carries the attribution hint
// (attribution-hint.feature)
// -----------------------------------------------------------------------------
describe('explicit-model fast failure surfaces the attribution hint', () => {
  it('names stage, agent, exact model string, and project-config scope above the stderr tail', async () => {
    const result = await engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    // Exactly one spawn, no fallback model.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    // Parks as blocked and resumable (failed -> blocked).
    expect(result.state).toBe('blocked');
    // The detail opens with the attribution hint.
    expect(result.detail).toContain('The "apply" stage ran the "opencode" agent');
    expect(result.detail).toContain('with model "zai/glm-5.2"');
    expect(result.detail).toContain('the project config');
    expect(result.detail).toMatch(/if this model id is invalid/i);
    // The stderr tail follows verbatim below the hint.
    expect(result.detail).toContain(STDERR);
    expect(result.detail!.indexOf('if this model id is invalid')).toBeLessThan(
      result.detail!.indexOf(STDERR)
    );
    // blocker/message now carry the hint too (rendered surfaces print these).
    expect(result.blocker).toBe(
      `Agent exited with code 2 without reporting completion. ${HINT}`
    );
    expect(result.message).toBe(`Agent failed during apply. ${HINT}`);
  });

  it('names the batch manifest when the manifest supplied the stage spec', async () => {
    const result = await engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('manifest'),
      })
    );
    expect(calls).toHaveLength(1);
    expect(result.state).toBe('blocked');
    expect(result.detail).toContain('the batch manifest');
    expect(result.detail).toContain('with model "zai/glm-5.2"');
  });

  it('attributes the verify stage when verify fails fast under an explicit model', async () => {
    const result = await engine().runChangeStep(
      ctx('verify', 'claude:fable', {
        agentStageScopes: stageScopes('project'),
      })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect(result.detail).toContain('The "verify" stage ran the "claude" agent');
    expect(result.detail).toContain('with model "fable"');
  });

  it('spawns no retry and substitutes no fallback model', async () => {
    await engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    // Exactly one spawn — no retry, no fallback.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    // The model flag carries the exact failing model, not a fallback.
    const idx = calls[0].args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe('zai/glm-5.2');
  });
});

// -----------------------------------------------------------------------------
// Scenario: A bare-name spec failure surfaces byte-for-byte today's output
// (unchanged-surfaces.feature)
// -----------------------------------------------------------------------------
describe('a bare-name spec failure surfaces byte-for-byte unchanged', () => {
  it('carries no attribution hint and deep-equals the scope-less mapping', async () => {
    // Bare name with threaded scopes — no model part, so no attribution built.
    const attributed = await engine().runChangeStep(
      ctx('apply', 'opencode', { agentStageScopes: stageScopes('project') })
    );
    // The scope-less baseline (today's path).
    calls = [];
    const today = await engine().runChangeStep(ctx('apply', 'opencode'));

    expect(attributed.state).toBe('blocked');
    expect(attributed.detail).not.toMatch(/if this model id is invalid/i);
    expect(attributed.detail).not.toMatch(/the .* config/i);
    // Byte-for-byte equality with today's mapping (no hint, same stderr tail).
    expect(attributed.detail).toBe(today.detail);
    expect(attributed.blocker).toBe(today.blocker);
    expect(attributed.message).toBe(today.message);
    // Exactly one spawn in each.
    expect(calls).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// Scenario: A failure after session journal progress surfaces unchanged
// (unchanged-surfaces.feature)
// -----------------------------------------------------------------------------
describe('a failure after session journal progress surfaces unchanged', () => {
  it('carries no attribution hint when the agent wrote a journal entry before failing', async () => {
    // First run: the agent writes a progress entry during the session, then
    // fails. Attribution is threaded but the zero-session-entries gate does not
    // fire, so the hint must NOT appear.
    spawnerBehavior = 'fail-fast-progress';
    const progressed = await engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );

    // Baseline: the same progressed failure WITHOUT threaded scopes (today).
    calls = [];
    spawnerBehavior = 'fail-fast-progress';
    const today = await engine().runChangeStep(ctx('apply', 'opencode:zai/glm-5.2'));

    expect(progressed.state).toBe('blocked');
    expect(progressed.detail).not.toMatch(/if this model id is invalid/i);
    expect(progressed.detail).toBe(today.detail);
    expect(progressed.blocker).toBe(today.blocker);
    expect(progressed.message).toBe(today.message);
  });
});

// -----------------------------------------------------------------------------
// Scenario: A failure with no stage scope attribution surfaces unchanged
// (unchanged-surfaces.feature) — the standalone headless path threads no scopes.
// -----------------------------------------------------------------------------
describe('a scope-less (standalone) explicit-model failure surfaces unchanged', () => {
  it('carries no hint when no agentStageScopes are threaded', async () => {
    spawnerBehavior = 'fail-fast';
    const result = await engine().runChangeStep(ctx('apply', 'opencode:zai/glm-5.2'));
    expect(result.state).toBe('blocked');
    expect(result.detail).not.toMatch(/if this model id is invalid/i);
    expect(result.detail).not.toMatch(/the .* config/i);
    // The stderr tail is still surfaced verbatim.
    expect(result.detail).toContain(STDERR);
  });
});

// -----------------------------------------------------------------------------
// Rendered surfaces carry the attribution hint (rendered-surfaces.feature).
// Every human-facing surface prints `result.blocker`/`result.message`; the
// mapper now threads the hint into both for the attributed signature, so each
// surface renders it. These assertions exercise the actual renderers/parkers
// rather than only `StepResult.detail`.
// -----------------------------------------------------------------------------
describe('rendered surfaces carry the attribution hint', () => {
  async function attributedResult() {
    spawnerBehavior = 'fail-fast';
    return engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
  }

  it('the standalone change-step renderer blocked line carries the hint', async () => {
    const result = await attributedResult();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(CHANGE, result, false, {
        title: 'Apply',
        advanced: 'step advanced',
      });
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      // The blocked line renders `result.blocker` (which now carries the hint).
      expect(out).toMatch(/blocked —/);
      expect(out).toContain('The "apply" stage ran the "opencode" agent');
      expect(out).toContain('with model "zai/glm-5.2"');
      expect(out).toContain('the project config');
      expect(out).toMatch(/if this model id is invalid/i);
      // `renderResult` in `src/commands/batch/apply.ts` emits the identical
      // `⚠ blocked — ${result.blocker ?? 'needs input'}` expression, so this
      // assertion covers the non-JSON `batch apply` blocked output surface too.
    } finally {
      logSpy.mockRestore();
    }
  });

  it('the parked-step reason (shown on resume as "blocked: <reason>") carries the hint', async () => {
    const result = await attributedResult();
    // `persistStepOutcome` parks `result.blocker` as the parked reason.
    parkStep(projectRoot, BATCH, {
      change: CHANGE,
      kind: 'blocked',
      reason: result.blocker ?? 'blocked',
    });
    const parked = getParkedStep(projectRoot, BATCH, CHANGE);
    expect(parked?.kind).toBe('blocked');
    // The parked reason is what `precheckPark` re-surfaces on the next run as
    // `Step '<change>' did not advance (blocked: <reason>).` — so the hint must
    // live in the reason text.
    expect(parked?.reason).toContain('The "apply" stage ran the "opencode" agent');
    expect(parked?.reason).toContain('with model "zai/glm-5.2"');
    expect(parked?.reason).toMatch(/if this model id is invalid/i);
  });

  it('the journal entry recorded for the failed transition carries the hint in its message', async () => {
    await attributedResult();
    const entries = readJournal(projectRoot, BATCH).filter(
      (e) => e.change === CHANGE && e.transition === 'apply'
    );
    // The engine records one outcome entry (`outcome.message ?? outcome.blocker`).
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last.message).toContain('The "apply" stage ran the "opencode" agent');
    expect(last.message).toContain('with model "zai/glm-5.2"');
    expect(last.message).toMatch(/if this model id is invalid/i);
  });

  it('the JSON surface keeps the hint in detail above the stderr tail', async () => {
    const result = await attributedResult();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(CHANGE, result, true, {
        title: 'Apply',
        advanced: 'step advanced',
      });
      const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(printed);
      // `detail` opens with the hint, stderr tail verbatim below.
      expect(parsed.detail).toContain(HINT);
      expect(parsed.detail).toContain(STDERR);
      expect(parsed.detail.indexOf(HINT)).toBeLessThan(parsed.detail.indexOf(STDERR));
      // `blocker`/`message` also carry the hint in the JSON object.
      expect(parsed.blocker).toContain(HINT);
      expect(parsed.message).toContain(HINT);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// -----------------------------------------------------------------------------
// Unchanged shapes render byte-for-byte identical to today on every surface
// (unchanged-rendering.feature). The renderer prints `result.blocker`/
// `result.message`; since the mapper leaves those byte-for-byte today's values
// for these shapes, the rendered output is byte-for-byte identical. These
// assertions exercise the actual renderer to prove no hint leaks in.
// -----------------------------------------------------------------------------
describe('unchanged shapes render byte-for-byte identical to today', () => {
  function render(result: { state: string; transition: string; blocker?: string; message?: string; detail?: string }): string {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(
        CHANGE,
        result as never,
        false,
        { title: 'Apply', advanced: 'step advanced' }
      );
      return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      logSpy.mockRestore();
    }
  }

  it('a bare-name spec failure renders byte-for-byte today with no hint', async () => {
    spawnerBehavior = 'fail-fast';
    const attributed = await engine().runChangeStep(
      ctx('apply', 'opencode', { agentStageScopes: stageScopes('project') })
    );
    calls = [];
    const today = await engine().runChangeStep(ctx('apply', 'opencode'));
    const aOut = render(attributed);
    const tOut = render(today);
    expect(aOut).toBe(tOut);
    expect(aOut).not.toMatch(/if this model id is invalid/i);
    expect(aOut).not.toMatch(/the .* config/i);
  });

  it('a failure after session journal progress renders byte-for-byte today with no hint', async () => {
    spawnerBehavior = 'fail-fast-progress';
    const progressed = await engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    calls = [];
    spawnerBehavior = 'fail-fast-progress';
    const today = await engine().runChangeStep(ctx('apply', 'opencode:zai/glm-5.2'));
    const pOut = render(progressed);
    const tOut = render(today);
    expect(pOut).toBe(tOut);
    expect(pOut).not.toMatch(/if this model id is invalid/i);
  });

  it('a scope-less standalone explicit-model failure renders byte-for-byte today with no hint', async () => {
    spawnerBehavior = 'fail-fast';
    const result = await engine().runChangeStep(ctx('apply', 'opencode:zai/glm-5.2'));
    // `result` IS today's scope-less path (no agentStageScopes threaded → no
    // attribution). Render it and assert no hint appears in the blocked line.
    const out = render(result);
    expect(out).not.toMatch(/if this model id is invalid/i);
    expect(out).not.toMatch(/the .* config/i);
    // The blocked line carries today's bare exit sentence (no hint).
    expect(out).toMatch(/Agent exited with code 2 without reporting completion\./);
  });
});

// -----------------------------------------------------------------------------
// PR-step attribution (features/pr-decompose-stage-attribution/pr-stage-attribution.feature)
//
// The batch-driven PR spawn routes via the `pr` STAGE of the agent map (exactly
// as a change step routes propose/apply/verify), so its supplying scope is
// `agentStageScopes.pr`. A fast-failing PR spawn under an explicit per-stage
// model surfaces the same stage/agent/model/scope attribution hint a change
// step gets — asserted on `blocker`/`message`/`detail`, the rendered blocked
// line, the parked reason, and the journal entry under the PR key.
// -----------------------------------------------------------------------------
const PR_HINT =
  'The "pr" stage ran the "opencode" agent with model "zai/glm-5.2" ' +
  'supplied by the batch manifest. If this model id is invalid or not ' +
  'available to this agent, correct the `agent` setting at that scope and resume.';

function prCtx(
  agent: BatchSettings['agent'],
  override?: Partial<PrStepContext>
): PrStepContext {
  return {
    batch: BATCH,
    phase: { name: 'terminal', goal: 'open the PR', success: 's', proofOfWork: POW },
    settings: { ...settings(agent), prGrouping: 'whole-batch' },
    baseBranch: 'main',
    workBranch: 'feature/work',
    ...override,
  };
}

describe('pr-step attribution — explicit per-stage model carries the hint', () => {
  beforeEach(() => {
    spawnerBehavior = 'fail-fast';
  });

  it('names the pr stage, agent, exact model, and batch-manifest scope on every surface', async () => {
    const result = await engine().runPrStep(
      prCtx({ pr: 'opencode:zai/glm-5.2' } as BatchSettings['agent'], {
        agentStageScopes: { pr: 'manifest' },
      })
    );
    // Exactly one spawn, no fallback model.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    const idx = calls[0].args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe('zai/glm-5.2');
    // Parks as blocked and resumable.
    expect(result.state).toBe('blocked');
    expect(result.transition).toBe('pr');
    // detail opens with the hint above the stderr tail.
    expect(result.detail).toContain('The "pr" stage ran the "opencode" agent');
    expect(result.detail).toContain('with model "zai/glm-5.2"');
    expect(result.detail).toContain('the batch manifest');
    expect(result.detail).toMatch(/if this model id is invalid/i);
    expect(result.detail).toContain(STDERR);
    expect(result.detail!.indexOf('if this model id is invalid')).toBeLessThan(
      result.detail!.indexOf(STDERR)
    );
    // blocker/message carry the hint too.
    expect(result.blocker).toBe(
      `Agent exited with code 2 without reporting completion. ${PR_HINT}`
    );
    expect(result.message).toBe(`Agent failed during pr. ${PR_HINT}`);
  });

  it('the rendered blocked line for the PR step carries the hint', async () => {
    const result = await engine().runPrStep(
      prCtx({ pr: 'opencode:zai/glm-5.2' } as BatchSettings['agent'], {
        agentStageScopes: { pr: 'manifest' },
      })
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(prJournalKey(BATCH), result, false, {
        title: 'PR',
        advanced: 'step advanced',
      });
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toMatch(/blocked —/);
      expect(out).toContain('The "pr" stage ran the "opencode" agent');
      expect(out).toContain('with model "zai/glm-5.2"');
      expect(out).toContain('the batch manifest');
      expect(out).toMatch(/if this model id is invalid/i);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('the parked PR-step reason carries the hint', async () => {
    const result = await engine().runPrStep(
      prCtx({ pr: 'opencode:zai/glm-5.2' } as BatchSettings['agent'], {
        agentStageScopes: { pr: 'manifest' },
      })
    );
    const key = prJournalKey(BATCH);
    parkStep(projectRoot, BATCH, {
      change: key,
      kind: 'blocked',
      reason: result.blocker ?? 'blocked',
    });
    const parked = getParkedStep(projectRoot, BATCH, key);
    expect(parked?.kind).toBe('blocked');
    expect(parked?.reason).toContain('The "pr" stage ran the "opencode" agent');
    expect(parked?.reason).toContain('with model "zai/glm-5.2"');
    expect(parked?.reason).toMatch(/if this model id is invalid/i);
  });

  it('the journal entry recorded under the PR key carries the hint', async () => {
    await engine().runPrStep(
      prCtx({ pr: 'opencode:zai/glm-5.2' } as BatchSettings['agent'], {
        agentStageScopes: { pr: 'manifest' },
      })
    );
    const key = prJournalKey(BATCH);
    const entries = readJournal(projectRoot, BATCH).filter(
      (e) => e.change === key && e.transition === 'pr'
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last.message).toContain('The "pr" stage ran the "opencode" agent');
    expect(last.message).toContain('with model "zai/glm-5.2"');
    expect(last.message).toMatch(/if this model id is invalid/i);
  });

  it('spawns exactly one PR agent with the exact failing model and no fallback', async () => {
    await engine().runPrStep(
      prCtx({ pr: 'opencode:zai/glm-5.2' } as BatchSettings['agent'], {
        agentStageScopes: { pr: 'manifest' },
      })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    const idx = calls[0].args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe('zai/glm-5.2');
  });
});

// -----------------------------------------------------------------------------
// Decompose-step attribution (decompose-stage-attribution.feature)
//
// The decomposition spawn routes via the `decompose` stage (exactly as a change
// step routes its transition and the PR step routes `pr`), so its supplying
// scope is `agentStageScopes.decompose`. A fast-failing decompose spawn under an
// explicit model surfaces the same hint on every surface and in the journal entry
// under the decomposition key.
// -----------------------------------------------------------------------------
const DECOMPOSE_HINT =
  'The "decompose" stage ran the "opencode" agent with model "zai/glm-5.2" ' +
  'supplied by the project config. If this model id is invalid or not ' +
  'available to this agent, correct the `agent` setting at that scope and resume.';

function decomposeCtx(
  agent: BatchSettings['agent'],
  override?: Partial<DecompositionStepContext>
): DecompositionStepContext {
  return {
    batch: BATCH,
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    priorResults: [],
    settings: settings(agent),
    ...override,
  };
}

describe('decompose-step attribution — explicit scalar model carries the hint', () => {
  beforeEach(() => {
    spawnerBehavior = 'fail-fast';
  });

  it('names the decompose stage, agent, exact model, and project-config scope on every surface', async () => {
    const result = await engine().runDecompositionStep(
      decomposeCtx('opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    // Exactly one spawn, no fallback model.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    const idx = calls[0].args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe('zai/glm-5.2');
    // Parks as blocked and resumable.
    expect(result.state).toBe('blocked');
    expect(result.transition).toBe('decompose');
    // detail opens with the hint above the stderr tail.
    expect(result.detail).toContain('The "decompose" stage ran the "opencode" agent');
    expect(result.detail).toContain('with model "zai/glm-5.2"');
    expect(result.detail).toContain('the project config');
    expect(result.detail).toMatch(/if this model id is invalid/i);
    expect(result.detail).toContain(STDERR);
    expect(result.detail!.indexOf('if this model id is invalid')).toBeLessThan(
      result.detail!.indexOf(STDERR)
    );
    // blocker/message carry the hint too.
    expect(result.blocker).toBe(
      `Agent exited with code 2 without reporting completion. ${DECOMPOSE_HINT}`
    );
    expect(result.message).toBe(`Agent failed during decompose. ${DECOMPOSE_HINT}`);
  });

  it('the rendered blocked line for the decompose step carries the hint', async () => {
    const result = await engine().runDecompositionStep(
      decomposeCtx('opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult('p1', result, false, {
        title: 'Decompose',
        advanced: 'step advanced',
      });
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toMatch(/blocked —/);
      expect(out).toContain('The "decompose" stage ran the "opencode" agent');
      expect(out).toContain('with model "zai/glm-5.2"');
      expect(out).toContain('the project config');
      expect(out).toMatch(/if this model id is invalid/i);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('the parked decompose-step reason carries the hint', async () => {
    const result = await engine().runDecompositionStep(
      decomposeCtx('opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    const key = decompositionJournalKey('p1');
    parkStep(projectRoot, BATCH, {
      change: key,
      kind: 'blocked',
      reason: result.blocker ?? 'blocked',
    });
    const parked = getParkedStep(projectRoot, BATCH, key);
    expect(parked?.kind).toBe('blocked');
    expect(parked?.reason).toContain('The "decompose" stage ran the "opencode" agent');
    expect(parked?.reason).toContain('with model "zai/glm-5.2"');
    expect(parked?.reason).toMatch(/if this model id is invalid/i);
  });

  it('the journal entry recorded under the decomposition key carries the hint', async () => {
    await engine().runDecompositionStep(
      decomposeCtx('opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    const key = decompositionJournalKey('p1');
    const entries = readJournal(projectRoot, BATCH).filter(
      (e) => e.change === key && e.transition === 'decompose'
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last.message).toContain('The "decompose" stage ran the "opencode" agent');
    expect(last.message).toContain('with model "zai/glm-5.2"');
    expect(last.message).toMatch(/if this model id is invalid/i);
  });
});

// -----------------------------------------------------------------------------
// Unchanged shapes for the pr/decompose paths (both features' unchanged
// scenarios). A bare-name pr spec, a stage-map-driven decompose (default agent,
// no model), and scope-less pr/decompose contexts render byte-for-byte today's
// output with no attribution hint.
// -----------------------------------------------------------------------------
describe('pr/decompose unchanged shapes render byte-for-byte today with no hint', () => {
  function render(result: {
    state: string;
    transition: string;
    change?: string;
    blocker?: string;
    message?: string;
    detail?: string;
  }): string {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(result.change ?? CHANGE, result as never, false, {
        title: 'Step',
        advanced: 'step advanced',
      });
      return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      logSpy.mockRestore();
    }
  }

  it('a bare-name pr spec failure renders byte-for-byte today with no hint', async () => {
    spawnerBehavior = 'fail-fast';
    const attributed = await engine().runPrStep(
      prCtx({ pr: 'opencode' } as BatchSettings['agent'], {
        agentStageScopes: { pr: 'manifest' },
      })
    );
    calls = [];
    const today = await engine().runPrStep(
      prCtx({ pr: 'opencode' } as BatchSettings['agent'])
    );
    expect(attributed.state).toBe('blocked');
    expect(attributed.detail).not.toMatch(/if this model id is invalid/i);
    expect(attributed.detail).not.toMatch(/the .* config/i);
    expect(attributed.detail).toBe(today.detail);
    expect(attributed.blocker).toBe(today.blocker);
    expect(attributed.message).toBe(today.message);
    // Rendered output is byte-for-byte identical.
    expect(render(attributed)).toBe(render(today));
    expect(calls).toHaveLength(1);
  });

  it('a stage-map-driven decompose failure (default agent, no model) renders byte-for-byte today', async () => {
    spawnerBehavior = 'fail-fast';
    // A stage map that names `apply` but not `decompose` leaves the decompose
    // stage unmapped → the spawn falls to DEFAULT_AGENT with no model
    // → no attribution can arise, even with threaded scopes.
    const stageMapAgent = { apply: 'opencode:zai/glm-5.2' } as BatchSettings['agent'];
    const attributed = await engine().runDecompositionStep(
      decomposeCtx(stageMapAgent, { agentStageScopes: stageScopes('project') })
    );
    calls = [];
    const today = await engine().runDecompositionStep(decomposeCtx(stageMapAgent));
    expect(attributed.state).toBe('blocked');
    expect(attributed.detail).not.toMatch(/if this model id is invalid/i);
    expect(attributed.detail).not.toMatch(/the .* config/i);
    expect(attributed.detail).toBe(today.detail);
    expect(attributed.blocker).toBe(today.blocker);
    expect(attributed.message).toBe(today.message);
    expect(render(attributed)).toBe(render(today));
  });

  it('a scope-less pr context with an explicit model renders unchanged with no hint', async () => {
    spawnerBehavior = 'fail-fast';
    const result = await engine().runPrStep(
      prCtx({ pr: 'opencode:zai/glm-5.2' } as BatchSettings['agent'])
    );
    expect(result.state).toBe('blocked');
    expect(result.detail).not.toMatch(/if this model id is invalid/i);
    expect(result.detail).not.toMatch(/the .* config/i);
    expect(result.detail).toContain(STDERR);
    // Rendered output carries today's bare exit sentence (no hint).
    expect(render(result)).toMatch(/Agent exited with code 2 without reporting completion\./);
  });

  it('a scope-less decompose context with an explicit model renders unchanged with no hint', async () => {
    spawnerBehavior = 'fail-fast';
    const result = await engine().runDecompositionStep(
      decomposeCtx('opencode:zai/glm-5.2')
    );
    expect(result.state).toBe('blocked');
    expect(result.detail).not.toMatch(/if this model id is invalid/i);
    expect(result.detail).not.toMatch(/the .* config/i);
    expect(result.detail).toContain(STDERR);
    expect(render(result)).toMatch(/Agent exited with code 2 without reporting completion\./);
  });
});

// -----------------------------------------------------------------------------
// Signal-kill hint gate (features/signal-kill-hint-gate/signal-kill-hint-gate.feature).
// The hint requires a REAL non-zero exit code (spawn.signal === null). A
// signal-killed spawn (exitCode null, signal SIGKILL) under a valid explicit
// model surfaces its failure on every rendered surface WITHOUT the hint, while
// an exit-code fast-failure (code 2, no signal) still renders the hint.
// -----------------------------------------------------------------------------
describe('signal-kill under an explicit model surfaces without the hint', () => {
  async function signalKillResult() {
    spawnerBehavior = 'signal-kill';
    return engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
  }

  it('is blocked, carries no hint on detail/blocker/message, names the signal, and keeps the stderr tail', async () => {
    const result = await signalKillResult();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    expect(result.state).toBe('blocked');
    // No rendered surface carries the hint.
    expect(result.detail).not.toMatch(/if this model id is invalid/i);
    expect(result.blocker).not.toMatch(/if this model id is invalid/i);
    expect(result.message).not.toMatch(/if this model id is invalid/i);
    expect(result.detail).not.toMatch(/the .* config/i);
    expect(result.blocker).not.toMatch(/the .* config/i);
    expect(result.message).not.toMatch(/the .* config/i);
    // The detail, blocker, and message name the signal that killed the agent.
    expect(result.blocker).toMatch(/via signal SIGKILL/);
    expect(result.blocker).toMatch(/exited via signal SIGKILL without reporting completion/);
    expect(result.message).toBe('Agent failed during apply.');
    // The captured stderr tail is still surfaced verbatim.
    expect(result.detail).toContain(STDERR);
  });

  it('the standalone change-step renderer blocked line shows via-signal with NO hint', async () => {
    const result = await signalKillResult();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(CHANGE, result, false, {
        title: 'Apply',
        advanced: 'step advanced',
      });
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toMatch(/blocked —/);
      // The blocked line names the signal.
      expect(out).toMatch(/via signal SIGKILL/);
      // The blocked line does NOT carry the stage/agent/model/scope hint.
      expect(out).not.toMatch(/if this model id is invalid/i);
      expect(out).not.toMatch(/The .* stage ran the/i);
      expect(out).not.toMatch(/the .* config/i);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('the parked-step reason shown on resume names the signal without the hint', async () => {
    const result = await signalKillResult();
    parkStep(projectRoot, BATCH, {
      change: CHANGE,
      kind: 'blocked',
      reason: result.blocker ?? 'blocked',
    });
    const parked = getParkedStep(projectRoot, BATCH, CHANGE);
    expect(parked?.kind).toBe('blocked');
    expect(parked?.reason).toMatch(/via signal SIGKILL/);
    expect(parked?.reason).not.toMatch(/if this model id is invalid/i);
    expect(parked?.reason).not.toMatch(/The .* stage ran the/i);
  });

  it('the journal entry recorded for the signal-killed transition names the signal without the hint', async () => {
    await signalKillResult();
    const entries = readJournal(projectRoot, BATCH).filter(
      (e) => e.change === CHANGE && e.transition === 'apply'
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last.message).not.toMatch(/if this model id is invalid/i);
    expect(last.message).not.toMatch(/The .* stage ran the/i);
  });

  it('the JSON surface shows via-signal with no hint in detail/blocker/message', async () => {
    const result = await signalKillResult();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(CHANGE, result, true, {
        title: 'Apply',
        advanced: 'step advanced',
      });
      const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(printed);
      expect(parsed.blocker).toMatch(/via signal SIGKILL/);
      expect(parsed.detail).toContain(STDERR);
      expect(parsed.detail).not.toMatch(/if this model id is invalid/i);
      expect(parsed.blocker).not.toMatch(/if this model id is invalid/i);
      expect(parsed.message).not.toMatch(/if this model id is invalid/i);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('exit-code fast failure still renders the hint (signal-kill regression guard)', () => {
  it('the standalone change-step renderer blocked line carries the hint for code 2', async () => {
    spawnerBehavior = 'fail-fast';
    const result = await engine().runChangeStep(
      ctx('apply', 'opencode:zai/glm-5.2', {
        agentStageScopes: stageScopes('project'),
      })
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderStepResult(CHANGE, result, false, {
        title: 'Apply',
        advanced: 'step advanced',
      });
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toMatch(/blocked —/);
      expect(out).toContain('The "apply" stage ran the "opencode" agent');
      expect(out).toContain('with model "zai/glm-5.2"');
      expect(out).toMatch(/if this model id is invalid/i);
    } finally {
      logSpy.mockRestore();
    }
  });
});
