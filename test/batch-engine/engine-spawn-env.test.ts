/**
 * Engine spawn requests carry a scoped environment.
 *
 * Implements: features/agent-env-scoping/engine-spawn-env.feature
 *
 * Every engine spawn site (change-transition, decompose, pr) threads the scoped
 * environment into the `AgentSpawnRequest` so no engine path exports the full
 * host environment into an agent session. A planted host secret is dropped at
 * every site while `RATCHET_BATCH_NAME` rides through, and the `RATCHET_BATCH_AGENT_CMD`
 * override still stands in for the coding agent under the scoped environment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal, appendJournalForLocus } from '../../src/core/batch/journal.js';
import { RatchetBatchEngine, type LinePrinter } from '../../src/core/batch/engine/engine.js';
import { DEFAULT_AGENT } from '../../src/core/batch/engine/agent.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
  AgentRuntime,
} from '../../src/core/batch/engine/agent.js';
import type {
  ResolvedStepContext,
  DecompositionStepContext,
  PrStepContext,
} from '../../src/core/batch/engine/contract.js';
import { prJournalKey } from '../../src/core/batch/engine/instructions.js';
import {
  getBatchManifestPath,
  type BatchSettings,
  type ProofOfWork,
} from '../../src/core/batch/manifest.js';

let projectRoot: string;
const SECRET = 'SUPER_SECRET_TOKEN';
let savedSecret: string | undefined;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-spawn-env-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  savedSecret = process.env[SECRET];
  savedEnv = process.env[ENV];
  delete process.env[SECRET];
  delete process.env[ENV];
});

afterEach(async () => {
  if (savedSecret === undefined) delete process.env[SECRET];
  else process.env[SECRET] = savedSecret;
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** Plant the host secret so `scopeAgentEnv(process.env)` sees and drops it. */
function plantSecret(): void {
  process.env[SECRET] = 'hunter2';
}

/** Corroborate a propose completion by writing the change dir + plan.md. */
function corroboratePropose(root: string, change: string): void {
  const dir = path.join(root, '.ratchet', 'changes', change);
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(path.join(dir, 'plan.md'), '## Tasks\n- [ ] do it\n');
}

/** Fake adapter that stamps its own name as the spawn command and threads env. */
function fakeAdapter(name: string): AgentAdapter {
  return {
    name,
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      return { command: name, args: [], instructions, cwd, env };
    },
  };
}

const fakeAdapters: Record<string, AgentAdapter> = {
  claude: fakeAdapter('claude'),
  opencode: fakeAdapter('opencode'),
  gemini: fakeAdapter('gemini'),
};

function changeSettings(over: Partial<BatchSettings> = {}): BatchSettings {
  return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', agent: 'fake', ...over };
}

function changeContext(over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    batch: 'b',
    change: 'add-login-api',
    transition: 'propose',
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: changeSettings(),
    journal: [],
    ...over,
  };
}

describe('engine-spawn-env — change-transition spawn is scoped', () => {
  it('excludes a host secret and carries RATCHET_BATCH_NAME', async () => {
    plantSecret();
    const calls: AgentSpawnRequest[] = [];
    const spawner: Spawner = async (request) => {
      calls.push(request);
      corroboratePropose(projectRoot, 'add-login-api');
      appendJournal(projectRoot, 'b', { change: 'add-login-api', kind: 'completion', message: 'proposed', transition: 'propose' });
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    };
    const engine = new RatchetBatchEngine({
      spawner,
      adapters: { fake: fakeAdapter('fake') },
      projectRoot: () => projectRoot,
    });

    await engine.runStep(changeContext());

    expect(calls).toHaveLength(1);
    const env = calls[0].env ?? {};
    expect(env).not.toHaveProperty(SECRET);
    expect(env.RATCHET_BATCH_NAME).toBe('b');
    // A baseline var still passes through.
    if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH);
  });
});

describe('engine-spawn-env — decompose spawn is scoped', () => {
  const BATCH = 'dcmp';
  const UNDECOMPOSED = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s2
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes: []
`;
  const DECOMPOSED = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s2
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: second
        done: second is done
`;

  beforeEach(async () => {
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
  });

  function decompositionContext(over: Partial<DecompositionStepContext> = {}): DecompositionStepContext {
    return {
      batch: BATCH,
      phase: { name: 'p2', goal: 'decompose me later', success: 's2', proofOfWork: POW },
      priorResults: [{ phase: 'p1', changes: [{ name: 'first', done: 'first is done' }] }],
      settings: { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', agent: 'claude' },
      ...over,
    };
  }

  it('excludes a host secret and carries RATCHET_BATCH_NAME', async () => {
    plantSecret();
    await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), UNDECOMPOSED, 'utf-8');
    // Mark p1's only change done so p2 is the reachable decomposition step.
    const dir = path.join(projectRoot, '.ratchet', 'changes', 'first');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] 1.1 done\n', 'utf-8');
    appendJournal(projectRoot, BATCH, { change: 'first', kind: 'completion', message: 'verified', transition: 'verify' });

    let captured: AgentSpawnRequest | undefined;
    const runtime: AgentRuntime = async (request, onEvent) => {
      captured = request;
      await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), DECOMPOSED, 'utf-8');
      appendJournal(projectRoot, BATCH, { change: 'p2', kind: 'completion', message: 'authored p2', transition: 'decompose' });
      onEvent({ kind: 'exit', exitCode: 0 });
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    };
    const engine = new RatchetBatchEngine({ runtime, projectRoot: () => projectRoot, printLine: () => {} });

    await engine.runDecompositionStep(decompositionContext());

    expect(captured).toBeDefined();
    const env = captured!.env ?? {};
    expect(env).not.toHaveProperty(SECRET);
    expect(env.RATCHET_BATCH_NAME).toBe(BATCH);
  });
});

describe('engine-spawn-env — pr spawn is scoped', () => {
  const BATCH = 'prb';
  const KEY = prJournalKey(BATCH);
  const WORK = 'feature/prb-work';
  const BASE = 'main';

  beforeEach(async () => {
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
  });

  function prSettings(over: Partial<BatchSettings> = {}): BatchSettings {
    return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', prGrouping: 'whole-batch', ...over };
  }

  function prContext(over: Partial<PrStepContext> = {}): PrStepContext {
    return {
      batch: BATCH,
      phase: { name: 'terminal', goal: 'open the PR', success: 's', proofOfWork: POW },
      settings: prSettings(),
      baseBranch: BASE,
      workBranch: WORK,
      ...over,
    };
  }

  it('excludes a host secret and carries RATCHET_BATCH_NAME', async () => {
    plantSecret();
    const calls: AgentSpawnRequest[] = [];
    const spawner: Spawner = async (request) => {
      calls.push(request);
      appendJournalForLocus(projectRoot, { batch: BATCH }, { change: KEY, kind: 'completion', message: 'opened the PR' });
      return { exitCode: 0, signal: null, stdout: 'opened PR', stderr: '' };
    };
    const engine = new RatchetBatchEngine({
      spawner,
      adapters: fakeAdapters,
      projectRoot: () => projectRoot,
      skillLocusDeps: { exists: () => true, writeText: () => {} },
    });

    await engine.runPrStep(prContext());

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(DEFAULT_AGENT);
    const env = calls[0].env ?? {};
    expect(env).not.toHaveProperty(SECRET);
    expect(env.RATCHET_BATCH_NAME).toBe(BATCH);
  });
});

describe('engine-spawn-env — the agent-cmd override still works under the scoped environment', () => {
  it('stands in for the coding agent while the scoped env excludes the host secret', async () => {
    process.env[ENV] = 'echo stub-agent';
    plantSecret();
    const calls: AgentSpawnRequest[] = [];
    const spawner: Spawner = async (request) => {
      calls.push(request);
      corroboratePropose(projectRoot, 'add-login-api');
      appendJournal(projectRoot, 'b', { change: 'add-login-api', kind: 'completion', message: 'proposed', transition: 'propose' });
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    };
    const engine = new RatchetBatchEngine({
      spawner,
      adapters: { fake: fakeAdapter('fake') },
      projectRoot: () => projectRoot,
    });

    const result = await engine.runStep(changeContext());

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('bash');
    expect(calls[0].args).toEqual(['-c', 'echo stub-agent']);
    const env = calls[0].env ?? {};
    expect(env).not.toHaveProperty(SECRET);
    expect(env.RATCHET_BATCH_NAME).toBe('b');
    expect(result.agentOverride).toBe(true);
  });
});
