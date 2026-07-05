/**
 * Attributed model-failure surface — integration proof (phase proof-of-work for
 * model-failure-attribution).
 *
 * Implements:
 *  - features/model-failure-attribution/attribution-hint.feature
 *  - features/model-failure-attribution/unchanged-surfaces.feature
 *
 * Drives `runChangeStep` over a tmpdir fixture with an injected runtime exiting
 * non-zero and writing no journal entries (the argv-rejection signature). An
 * explicit-model transition with threaded `agentStageScopes` surfaces a blocked,
 * resumable step whose `detail` names the stage, agent, exact model string, and
 * supplying scope above the stderr tail — with exactly one spawn and no fallback
 * model. A bare-name spec and a session-progressed failure surface byte-for-byte
 * unchanged (no hint, no attribution).
 *
 * Phase proof-of-work: `pnpm test test/batch-engine/model-failure-attribution.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type {
  AgentSpawnRequest,
  Spawner,
} from '../../src/core/batch/engine/agent.js';
import type {
  ChangeStepContext,
  Transition,
} from '../../src/core/batch/engine/contract.js';
import type { BatchSettings, ProofOfWork } from '../../src/core/batch/config.js';
import type { SettingSource } from '../../src/core/batch/config.js';
import type { AgentStage } from '../../src/core/batch/agent-setting.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';

const ENV = 'RATCHET_BATCH_AGENT_CMD';
const BATCH = 'mfa';
const CHANGE = 'c1';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };
const STDERR = 'error: unknown model id "zai/glm-5.2"';

let projectRoot: string;
let savedEnv: string | undefined;
let calls: AgentSpawnRequest[];
let spawnerBehavior: 'fail-fast' | 'fail-fast-progress';

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
 * mapper's zero-session-entries gate does not fire.
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
  return { exitCode: 2, signal: null, stdout: '', stderr: STDERR };
};

function engine(): RatchetBatchEngine {
  return new RatchetBatchEngine({
    spawner,
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
  stages: AgentStage[] = ['propose', 'apply', 'verify', 'pr']
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
    // blocker/message are the unchanged today values (no hint leaked in).
    expect(result.blocker).toBe('Agent exited with code 2 without reporting completion.');
    expect(result.message).toBe('Agent failed during apply.');
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
