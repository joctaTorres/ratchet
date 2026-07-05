/**
 * Per-stage adapter resolution in the engine (phase proof-of-work).
 *
 * Implements: features/agent-stage-resolution/resolution.feature
 * Implements: features/model-flag-threading/engine-spec-parsing.feature (spawn scenarios)
 *
 * Drives the engine's change core (`runChangeStep`) and decomposition entry point
 * through the existing fake-adapter + `Spawner` seam (as `engine-agent-override`
 * does) and asserts WHICH adapter is spawned for each transition:
 *   - a scalar `agent` routes every stage to that one agent;
 *   - an unset `agent` and an unmapped stage spawn the default agent;
 *   - a full/partial stage-map spawns the agent mapped to each stage, and the
 *     invocation is rendered with that agent's command adapter;
 *   - an unknown mapped agent fails before any spawn;
 *   - the phase-decomposition step (not a lifecycle stage) ignores the stage-map.
 *
 * Also covers `engine-spec-parsing.feature` spawn scenarios: a spec-form value
 * resolves the adapter by its agent part and threads the model into the captured
 * request context; a bare name threads no model; an unset agent falls back to
 * the default adapter with no model; an unknown agent part throws
 * `UnknownAgentError` before any spawn naming the agent part (`rex`, not
 * `rex:some-model`).
 *
 * The `Spawner` captures the request the engine built; the fake adapters are keyed
 * by real agent ids so `resolveAdapter` picks them, each stamping its own name as
 * the spawn `command` so the resolved adapter is observable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import { DEFAULT_AGENT } from '../../src/core/batch/engine/agent.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import type {
  ChangeStepContext,
  DecompositionStepContext,
  Transition,
} from '../../src/core/batch/engine/contract.js';
import type { BatchSettings, ProofOfWork } from '../../src/core/batch/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/index.js';

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

const BATCH = 'asr';
const CHANGE = 'c1';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };
const STAGES: Transition[] = ['propose', 'apply', 'verify'];

/** Every spawn request the engine built this test, newest last. */
let calls: AgentSpawnRequest[];

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-routing-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  savedEnv = process.env[ENV];
  delete process.env[ENV];
  calls = [];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** A fake adapter that stamps its own agent id as the spawn `command`. */
function fakeAdapter(name: string): AgentAdapter {
  return {
    name,
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      return { command: name, args: [], instructions, cwd, env };
    },
  };
}

/**
 * A context-capturing fake adapter: records the `AgentRequestContext` handed to
 * `buildRequest` so a test can assert the engine threaded `model` (or did not).
 * The argv carries the model flag pair so spec-form model threading is observable
 * end-to-end through `buildSpawnRequest`.
 */
function capturingAdapter(name: string, modelFlag = '--model'): {
  adapter: AgentAdapter;
  captured: AgentRequestContext[];
} {
  const captured: AgentRequestContext[] = [];
  const adapter: AgentAdapter = {
    name,
    modelFlag,
    buildRequest(ctx, instructions, cwd, env): AgentSpawnRequest {
      captured.push(ctx);
      const modelFlags = ctx.model ? [modelFlag, ctx.model] : [];
      return { command: name, args: modelFlags, instructions, cwd, env };
    },
  };
  return { adapter, captured };
}

// Keyed by real agent ids so `resolveAdapter` (builtins ← extra) picks the fake.
const fakeAdapters: Record<string, AgentAdapter> = {
  claude: fakeAdapter('claude'),
  opencode: fakeAdapter('opencode'),
  gemini: fakeAdapter('gemini'),
};

const spawner: Spawner = async (request) => {
  calls.push(request);
  return { exitCode: 0, signal: null, stdout: '', stderr: '' };
};

function engine(): RatchetBatchEngine {
  return new RatchetBatchEngine({
    spawner,
    adapters: fakeAdapters,
    projectRoot: () => projectRoot,
    // The command-file guarantee is exercised elsewhere; here the command is
    // always "present" so no file is written and resolution is the sole variable.
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

function ctx(transition: Transition, agent: BatchSettings['agent']): ChangeStepContext {
  return {
    batch: BATCH,
    change: CHANGE,
    changeDone: 'the change is done',
    transition,
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(agent),
    journal: [],
  };
}

describe('per-stage adapter resolution — scalar and unset', () => {
  it('a scalar agent routes every stage to that one agent', async () => {
    for (const stage of STAGES) {
      calls = [];
      await engine().runChangeStep(ctx(stage, 'opencode'));
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('opencode');
      // The invocation is rendered with the SAME agent's command adapter.
      expect(calls[0].instructions).toContain(
        CommandAdapterRegistry.get('opencode')!.getInvocation(stage)
      );
    }
  });

  it('an unset agent routes every stage to the default agent', async () => {
    for (const stage of STAGES) {
      calls = [];
      await engine().runChangeStep(ctx(stage, undefined));
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe(DEFAULT_AGENT);
    }
  });
});

describe('per-stage adapter resolution — stage-maps', () => {
  const fullMap = { propose: 'claude', apply: 'opencode', verify: 'opencode' } as const;

  for (const stage of STAGES) {
    it(`a full stage-map spawns the agent mapped to ${stage}`, async () => {
      await engine().runChangeStep(ctx(stage, { ...fullMap }));
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe(fullMap[stage]);
      expect(calls[0].instructions).toContain(
        CommandAdapterRegistry.get(fullMap[stage])!.getInvocation(stage)
      );
    });
  }

  it('a partial stage-map spawns the mapped agent for a mapped stage', async () => {
    await engine().runChangeStep(ctx('apply', { apply: 'opencode' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
  });

  for (const stage of ['propose', 'verify'] as const) {
    it(`a partial stage-map falls back to the default agent for the unmapped ${stage} stage`, async () => {
      await engine().runChangeStep(ctx(stage, { apply: 'opencode' }));
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe(DEFAULT_AGENT);
    });
  }
});

describe('per-stage adapter resolution — rejection before spawn', () => {
  for (const stage of STAGES) {
    it(`an unknown agent mapped to ${stage} is rejected before any spawn`, async () => {
      const result = await engine().runChangeStep(ctx(stage, { [stage]: 'nope' }));
      // No process is spawned, and the failure names the unknown agent + the
      // available adapters (UnknownAgentError surfaced as a resumable blocked step).
      expect(calls).toHaveLength(0);
      expect(result.state).toBe('blocked');
      expect(result.blocker).toContain('nope');
      expect(result.blocker).toMatch(/available adapters/i);
    });
  }
});

describe('per-stage adapter resolution — decomposition ignores the stage-map', () => {
  function decompCtx(agent: BatchSettings['agent']): DecompositionStepContext {
    return {
      batch: BATCH,
      phase: { name: 'p2', goal: 'g', success: 's', proofOfWork: POW },
      priorResults: [],
      settings: settings(agent),
    };
  }

  it('spawns the default agent even when a stage-map maps apply elsewhere', async () => {
    await engine().runDecompositionStep(decompCtx({ apply: 'opencode' }));
    expect(calls).toHaveLength(1);
    // The decomposition is not a lifecycle stage: the map's `apply` entry does not
    // reach it, so it falls back through the scalar (none) to the default agent.
    expect(calls[0].command).toBe(DEFAULT_AGENT);
  });
});

/**
 * Implements: features/model-flag-threading/engine-spec-parsing.feature (spawn scenarios)
 *
 * The engine parses the resolved `agent[:model]` spec once per transition in
 * `buildSpawnRequest`: the adapter is resolved by the AGENT PART and the model
 * is threaded into the `AgentRequestContext` handed to `buildRequest`. An unknown
 * agent part throws `UnknownAgentError` before any spawn, naming the agent part
 * (not the full spec).
 */
describe('engine spec-parsing — buildSpawnRequest threads the model (engine-spec-parsing.feature)', () => {
  /**
   * Build an engine whose fake adapters RECORD the context each `buildRequest`
   * received so the threaded `model` (or its absence) is observable. Keyed by
   * real agent ids so `resolveAdapter` picks them up via `adapters`.
   */
  function engineWithCapturing(
    adapters: Record<string, AgentAdapter>
  ): { engine: RatchetBatchEngine; calls: AgentSpawnRequest[] } {
    const calls: AgentSpawnRequest[] = [];
    const spawner: Spawner = async (request) => {
      calls.push(request);
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    };
    const engine = new RatchetBatchEngine({
      spawner,
      adapters,
      projectRoot: () => projectRoot,
      skillLocusDeps: { exists: () => true, writeText: () => {} },
    });
    return { engine, calls };
  }

  // Scenario: Spec-form value resolves the adapter by its agent part and threads the model.
  it('a spec-form stage value resolves the mapped adapter and threads the exact model', async () => {
    const opencode = capturingAdapter('opencode');
    const { engine, calls } = engineWithCapturing({ opencode: opencode.adapter });
    await engine.runChangeStep(
      ctx('apply', { apply: 'opencode:zai/glm-5.2' })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    // The context handed to the adapter carried the exact model string.
    expect(opencode.captured[0].model).toBe('zai/glm-5.2');
    // And the adapter's argv reflects the threaded model via its own flag.
    expect(calls[0].args).toEqual(['--model', 'zai/glm-5.2']);
  });

  // Scenario: Bare agent name threads no model.
  it('a bare agent name threads no model (captured context has no model key)', async () => {
    const claude = capturingAdapter('claude');
    const { engine, calls } = engineWithCapturing({ claude: claude.adapter });
    await engine.runChangeStep(ctx('propose', 'claude'));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect(claude.captured[0].model).toBeUndefined();
    expect(calls[0].args).toEqual([]); // no model flag pair appended
  });

  // Scenario: Unset agent still falls back to the default adapter with no model.
  it('an unset agent falls back to the default adapter and threads no model', async () => {
    // The default agent (claude) must be in the extra registry for this engine
    // instance, since no builtins are overridden here.
    const claude = capturingAdapter('claude');
    const { engine, calls } = engineWithCapturing({ claude: claude.adapter });
    await engine.runChangeStep(ctx('apply', undefined));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(DEFAULT_AGENT);
    expect(claude.captured[0].model).toBeUndefined();
  });

  // Scenario: Unknown agent part still throws before any spawn.
  it('an unknown agent part ("rex:some-model") throws UnknownAgentError naming "rex", not the full spec', async () => {
    // No adapter is registered for "rex"; this engine uses only a claude fake.
    const claude = capturingAdapter('claude');
    const { engine, calls } = engineWithCapturing({ claude: claude.adapter });
    const result = await engine.runChangeStep(ctx('apply', 'rex:some-model'));
    expect(calls).toHaveLength(0); // no process spawned
    expect(result.state).toBe('blocked');
    expect(result.blocker).toContain('rex');
    expect(result.blocker).not.toContain('rex:some-model');
    expect(result.blocker).toMatch(/available adapters/i);
  });

  // Scenario: Spec-form scalar value threads the model too (scalar covers every stage).
  it('a spec-form SCALAR value resolves the adapter and threads the model for every stage', async () => {
    const claude = capturingAdapter('claude');
    const { engine, calls } = engineWithCapturing({ claude: claude.adapter });
    await engine.runChangeStep(ctx('propose', 'claude:fable'));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect(claude.captured[0].model).toBe('fable');
  });
});
