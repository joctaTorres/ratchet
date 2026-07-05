/**
 * Config-to-argv model selection proof (phase proof-of-work for
 * per-stage-model-selection).
 *
 * Implements: features/model-selection-proof-and-docs/config-to-argv-proof.feature
 *
 * The unit suites already prove the parser (`parseAgentSpec`), the schema
 * (`AgentSettingSchema`'s `superRefine`), and each adapter's `buildRequest`
 * (`model-flag-argv`). This integration suite proves the ONE thing they cannot:
 * that a spec a user writes in config demonstrably lands on the spawned agent's
 * argv through resolution → engine parse → adapter. It drives the REAL builtin
 * adapters through the engine over a tmpdir fixture with an injected fake
 * `Spawner` — asserting on the captured `AgentSpawnRequest.args` only, never on
 * parser internals already proven at the unit level.
 *
 * Phase proof-of-work: `pnpm test test/batch-engine/agent-model-selection.test.ts`.
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
import type {
  BatchSettings,
  BatchManifest,
  ProofOfWork,
} from '../../src/core/batch/config.js';
import { resolveBatchSettings } from '../../src/core/batch/config.js';
import { ProjectConfigSchema } from '../../src/core/project-config.js';
import { parseBatchManifest } from '../../src/core/batch/manifest.js';

const ENV = 'RATCHET_BATCH_AGENT_CMD';
const BATCH = 'ams';
const CHANGE = 'c1';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };
const STAGES: Transition[] = ['propose', 'apply', 'verify'];

let projectRoot: string;
let savedEnv: string | undefined;
let calls: AgentSpawnRequest[];

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-model-'));
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

/**
 * The fake Spawner: captures the request the engine built (with the REAL builtin
 * adapters — no `adapters` override is passed to the engine, so `resolveAdapter`
 * picks `BUILTIN_ADAPTERS`) and returns a clean exit 0. No real agent binary is
 * spawned; the captured `args` carry the genuine `--model`/`-m` flags each
 * adapter declares.
 */
const spawner: Spawner = async (request) => {
  calls.push(request);
  return { exitCode: 0, signal: null, stdout: '', stderr: '' };
};

function engine(): RatchetBatchEngine {
  return new RatchetBatchEngine({
    spawner,
    // No `adapters` override: resolveAdapter uses BUILTIN_ADAPTERS, so the
    // captured argv carries each real adapter's declared model flag.
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

/**
 * Assert the captured argv carries the model-flag pair `[flag, model]` as
 * consecutive elements. Asserting on the pair (not the whole argv) keeps the
 * suite robust to sibling changes that legitimately alter an adapter's base argv,
 * while still proving the exact model string reached the spawned argv.
 */
function expectModelFlag(
  args: string[],
  flag: string,
  model: string
): void {
  const idx = args.indexOf(flag);
  expect(idx, `argv should contain "${flag}"`).toBeGreaterThanOrEqual(0);
  expect(args[idx + 1], `argv["${flag}"] should be "${model}"`).toBe(model);
}

function expectNoModelFlag(args: string[], flag: string): void {
  expect(args, `argv should not contain "${flag}"`).not.toContain(flag);
}

// -----------------------------------------------------------------------------
// Scenario: Per-stage specs emit each agent's model flag with the exact model string
// -----------------------------------------------------------------------------
describe('per-stage specs emit each agent model flag with the exact model string', () => {
  const stageMap = {
    propose: 'claude:fable',
    apply: 'opencode:zai/glm-5.2',
    verify: 'opencode:qwen/qwen-3.7',
  } as const;

  it('propose runs the claude adapter with --model fable', async () => {
    await engine().runChangeStep(ctx('propose', { ...stageMap }));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expectModelFlag(calls[0].args, '--model', 'fable');
  });

  it('apply runs the opencode adapter with --model zai/glm-5.2', async () => {
    await engine().runChangeStep(ctx('apply', { ...stageMap }));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    expectModelFlag(calls[0].args, '--model', 'zai/glm-5.2');
  });

  it('verify runs the opencode adapter with --model qwen/qwen-3.7', async () => {
    await engine().runChangeStep(ctx('verify', { ...stageMap }));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    expectModelFlag(calls[0].args, '--model', 'qwen/qwen-3.7');
  });
});

// -----------------------------------------------------------------------------
// Scenario: A scalar spec covers every lifecycle stage
// -----------------------------------------------------------------------------
describe('a scalar spec covers every lifecycle stage', () => {
  for (const stage of STAGES) {
    it(`scalar claude:fable carries --model fable on the ${stage} argv`, async () => {
      await engine().runChangeStep(ctx(stage, 'claude:fable'));
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('claude');
      expectModelFlag(calls[0].args, '--model', 'fable');
    });
  }
});

// -----------------------------------------------------------------------------
// Scenario: A dash-m agent's spec emits its -m flag end to end
// -----------------------------------------------------------------------------
describe('a dash-m agent emits its -m flag end to end', () => {
  it('scalar codex:gpt-5.2-codex carries -m gpt-5.2-codex on the apply argv', async () => {
    await engine().runChangeStep(ctx('apply', 'codex:gpt-5.2-codex'));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('codex');
    expectModelFlag(calls[0].args, '-m', 'gpt-5.2-codex');
  });
});

// -----------------------------------------------------------------------------
// Scenario: A bare agent name emits no model flag and leaves argv byte-for-byte
// unchanged
// -----------------------------------------------------------------------------
describe('a bare agent name emits no model flag and argv is byte-for-byte unchanged', () => {
  it('agent: claude carries no --model and deep-equals the argv with no agent set', async () => {
    // Capture argv with a bare agent name.
    await engine().runChangeStep(ctx('apply', 'claude'));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expectNoModelFlag(calls[0].args, '--model');
    const bareArgs = [...calls[0].args];

    // Capture argv with no agent setting configured (falls back to the default
    // agent, which is also claude). A fresh engine instance keeps the two
    // captures independent, but the resolved adapter and argv shape are identical.
    calls = [];
    await engine().runChangeStep(ctx('apply', undefined));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expectNoModelFlag(calls[0].args, '--model');
    // Byte-for-byte identical: the bare name touches nothing, preserving today's
    // argv exactly (proven by deep equality, not a hardcoded snapshot).
    expect(calls[0].args).toEqual(bareArgs);
  });
});

// -----------------------------------------------------------------------------
// Scenario: Nearest-wins per-stage merge moves agent and model atomically across
// scopes
// -----------------------------------------------------------------------------
describe('nearest-wins per-stage merge moves agent and model atomically across scopes', () => {
  it('project scalar claude:fable + manifest apply opencode:zai/glm-5.2 splits per stage', async () => {
    // Build a tmpdir fixture: a project config whose batch agent is the scalar
    // spec "claude:fable", resolved against a manifest whose settings map
    // "apply" to "opencode:zai/glm-5.2". resolveBatchSettings performs the
    // nearest-wins per-stage merge over whole spec strings, so agent+model move
    // atomically across scopes.
    const ratchetDir = path.join(projectRoot, '.ratchet');
    await fs.mkdir(ratchetDir, { recursive: true });
    await fs.writeFile(
      path.join(ratchetDir, 'config.yaml'),
      'schema: ratchet\nbatch:\n  agent: claude:fable\n'
    );
    const manifest: BatchManifest = {
      name: BATCH,
      phases: [],
      settings: { agent: { apply: 'opencode:zai/glm-5.2' } },
    };

    const { settings: resolved } = resolveBatchSettings(projectRoot, manifest);
    // The resolved agent is a materialized full map: the manifest's `apply`
    // overrides the project scalar for that stage only; every other stage
    // inherits the project scalar `claude:fable`.
    expect(resolved.agent).toEqual({
      propose: 'claude:fable',
      apply: 'opencode:zai/glm-5.2',
      verify: 'claude:fable',
      pr: 'claude:fable',
    });

    // Propose spawns claude with --model fable.
    calls = [];
    await engine().runChangeStep(
      ctx('propose', undefined, { settings: { ...resolved } })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expectModelFlag(calls[0].args, '--model', 'fable');

    // Apply spawns opencode with --model zai/glm-5.2 and carries no trace of
    // "fable" — agent+model moved atomically.
    calls = [];
    await engine().runChangeStep(
      ctx('apply', undefined, { settings: { ...resolved } })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    expectModelFlag(calls[0].args, '--model', 'zai/glm-5.2');
    expect(calls[0].args).not.toContain('fable');
  });
});

// -----------------------------------------------------------------------------
// Scenario: An empty model part fails config load naming the offending value
// Scenario: An empty agent part fails manifest load naming the offending value
// -----------------------------------------------------------------------------
describe('malformed specs fail load before any spawn naming the offending value', () => {
  it('project config "claude:" is rejected at config load naming "claude:"', async () => {
    // Write a project config whose batch agent value is "claude:". The config-
    // load validator is ProjectConfigSchema.shape.batch (the schema readProjectConfig
    // safeParses); it rejects the malformed spec forwarding the parser's message,
    // which names the offending value — before any agent is spawned.
    const ratchetDir = path.join(projectRoot, '.ratchet');
    await fs.mkdir(ratchetDir, { recursive: true });
    await fs.writeFile(
      path.join(ratchetDir, 'config.yaml'),
      'schema: ratchet\nbatch:\n  agent: "claude:"\n'
    );

    // The config-load validation rejects the malformed spec naming "claude:".
    const raw = await fs.readFile(path.join(ratchetDir, 'config.yaml'), 'utf-8');
    const yaml = (await import('yaml')).parse(raw);
    const result = ProjectConfigSchema.shape.batch.safeParse(yaml.batch);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('\n');
      expect(message).toContain('claude:');
      expect(message).toMatch(/empty model part/);
    }
  });

  it('manifest ":fable" is rejected at manifest load naming ":fable"', async () => {
    // A batch manifest whose settings map "verify" to ":fable" fails load
    // (parseBatchManifest throws BatchManifestError) before any spawn, with the
    // parser's message naming the offending value.
    const manifestYaml = [
      'name: b1',
      'settings:',
      '  agent:',
      '    verify: ":fable"',
      'phases: []',
      '',
    ].join('\n');

    expect(() => parseBatchManifest(manifestYaml)).toThrow(/:fable/);
  });
});
