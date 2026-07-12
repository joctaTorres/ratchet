/**
 * Spawn one PR agent at batch completion (whole-batch PR grouping).
 *
 * Implements: features/pr-spawn-at-completion/whole-batch-pr-spawn.feature
 *
 * Drives the engine's whole-batch PR entry point (`runPrStep`) through the same
 * fake-adapter + `Spawner` seam `agent-stage-routing.test.ts` uses, and asserts
 * the engine-layer guarantees independent of any CLI wiring:
 *   - `prGrouping: whole-batch`, no prior PR journal → EXACTLY ONE spawn that
 *     delegates to `/rct:open-pr` carrying the resolved work/base branch, and a
 *     `completion` entry with `transition: 'pr'` recorded at the batch locus;
 *   - the `pr` stage routes the spawn (mapped / scalar / default agent) and the
 *     invocation token uses that agent's own command syntax;
 *   - `prGrouping: off`/unset → ZERO spawns, `nothing-ready`, no journal entry;
 *   - a pre-seeded `pr` completion → ZERO spawns on re-run (idempotent resume);
 *   - a non-zero exit without a reported completion → a failure with NO `pr`
 *     completion journaled (retry stays possible);
 *   - a `remote` locus the engine cannot render into → a failure with ZERO spawns
 *     and an actionable bootstrap message.
 *
 * The `Spawner` captures the request the engine built; the fake adapters are keyed
 * by real agent ids so `resolveAdapter` picks them, each stamping its own name as
 * the spawn `command` so the routed adapter is observable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine, type LinePrinter } from '../../src/core/batch/engine/engine.js';
import { DEFAULT_AGENT } from '../../src/core/batch/engine/agent.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import { spawnerAsRuntime } from '../helpers/spawner-as-runtime.js';
import type { PrStepContext } from '../../src/core/batch/engine/contract.js';
import { prJournalKey } from '../../src/core/batch/engine/instructions.js';
import { hasJournaledPr } from '../../src/core/batch/engine/transition.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import { readJournalTolerant } from '../../src/core/batch/engine/run-state.js';
import type { BatchSettings, ProofOfWork } from '../../src/core/batch/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/index.js';

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

const BATCH = 'prb';
const KEY = prJournalKey(BATCH);
const WORK = 'feature/prb-work';
const BASE = 'main';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

/** Every spawn request the engine built this test, newest last. */
let calls: AgentSpawnRequest[];

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-spawn-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
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

// Keyed by real agent ids so `resolveAdapter` (builtins ← extra) picks the fake.
const fakeAdapters: Record<string, AgentAdapter> = {
  claude: fakeAdapter('claude'),
  opencode: fakeAdapter('opencode'),
  gemini: fakeAdapter('gemini'),
};

/** Capture the request and exit 0 without reporting anything (routing/no-op tests). */
const capturingSpawner: Spawner = async (request) => {
  calls.push(request);
  return { exitCode: 0, signal: null, stdout: '', stderr: '' };
};

/**
 * Capture the request, then simulate the PR agent reporting a completion by
 * appending a `completion` entry for the PR key at the batch locus — WITHOUT a
 * `transition` field (mirroring what `ratchet batch report --complete` writes), so
 * the test proves the ENGINE records the `transition: 'pr'` mirror entry.
 */
const completingSpawner: Spawner = async (request) => {
  calls.push(request);
  appendJournalForLocus(
    projectRoot,
    { batch: BATCH },
    { change: KEY, kind: 'completion', message: 'opened the whole-batch PR' }
  );
  return { exitCode: 0, signal: null, stdout: 'opened PR', stderr: '' };
};

/** Capture the request and exit non-zero without reporting a completion. */
const failingSpawner: Spawner = async (request) => {
  calls.push(request);
  return { exitCode: 1, signal: null, stdout: '', stderr: 'commit failed' };
};

function engine(opts: { spawner: Spawner; printLine?: LinePrinter }): RatchetBatchEngine {
  return new RatchetBatchEngine({
    runtime: spawnerAsRuntime(opts.spawner),
    adapters: fakeAdapters,
    projectRoot: () => projectRoot,
    ...(opts.printLine ? { printLine: opts.printLine } : {}),
    // The command-file guarantee is exercised elsewhere; here the command is
    // always "present" so no file is written and routing is the sole variable.
    skillLocusDeps: { exists: () => true, writeText: () => {} },
  });
}

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    prGrouping: 'whole-batch',
    ...over,
  };
}

function prCtx(over: Partial<PrStepContext> = {}): PrStepContext {
  return {
    batch: BATCH,
    phase: { name: 'terminal', goal: 'open the PR', success: 's', proofOfWork: POW },
    settings: settings(),
    baseBranch: BASE,
    workBranch: WORK,
    ...over,
  };
}

describe('pr-spawn-at-completion — whole-batch grouping spawns one delegating PR agent', () => {
  it('spawns exactly one PR agent delegating to /rct:open-pr with branch data, and journals a pr completion', async () => {
    const result = await engine({ spawner: completingSpawner }).runPrStep(prCtx());

    // Exactly one agent, spawned as the default agent (unset `agent`).
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(DEFAULT_AGENT);

    // Its instructions delegate to the shared /rct:open-pr command (the default
    // agent's own invocation token), not an inline engine-authored PR prompt.
    const instr = calls[0].instructions;
    expect(instr).toContain(
      CommandAdapterRegistry.get(DEFAULT_AGENT)!.getInvocation('open-pr')
    );
    expect(instr).toMatch(/Do NOT hand-build|delegate to the skill/);
    // The resolved work/base branch ride in the prompt as the open-pr Input data.
    expect(instr).toContain(WORK);
    expect(instr).toContain(BASE);
    // It reports under the PR journal key, not a change name.
    expect(instr).toContain(`--change ${KEY}`);

    // The step advanced, and a PR-open completion (transition: 'pr') is recorded
    // at the batch locus — EXACTLY one such engine mirror entry.
    expect(result.state).toBe('advanced');
    expect(result.transition).toBe('pr');
    const journal = readJournalTolerant(projectRoot, BATCH);
    expect(hasJournaledPr(journal)).toBe(true);
    expect(
      journal.filter((e) => e.kind === 'completion' && e.transition === 'pr')
    ).toHaveLength(1);
  });
});

describe('pr-spawn-at-completion — the pr stage routes the spawn', () => {
  it('routes the spawn to the agent the pr stage maps to, with that agent’s invocation syntax', async () => {
    await engine({ spawner: capturingSpawner }).runPrStep(
      prCtx({ settings: settings({ agent: { pr: 'opencode' } }) })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    expect(calls[0].instructions).toContain(
      CommandAdapterRegistry.get('opencode')!.getInvocation('open-pr')
    );
  });

  it('a scalar agent routes the pr stage to it', async () => {
    await engine({ spawner: capturingSpawner }).runPrStep(
      prCtx({ settings: settings({ agent: 'gemini' }) })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('gemini');
    expect(calls[0].instructions).toContain(
      CommandAdapterRegistry.get('gemini')!.getInvocation('open-pr')
    );
  });

  it('an unset agent (and an unmapped pr stage) spawns the default agent', async () => {
    // Unset → default.
    await engine({ spawner: capturingSpawner }).runPrStep(prCtx());
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(DEFAULT_AGENT);

    // A stage-map that does not name `pr` also falls back to the default agent.
    calls = [];
    await engine({ spawner: capturingSpawner }).runPrStep(
      prCtx({ settings: settings({ agent: { apply: 'opencode' } }) })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(DEFAULT_AGENT);
  });
});

describe('pr-spawn-at-completion — grouping off/unset never spawns', () => {
  it('prGrouping off → zero spawns, nothing-ready, no journal entry', async () => {
    const result = await engine({ spawner: capturingSpawner }).runPrStep(
      prCtx({ settings: settings({ prGrouping: 'off' }) })
    );
    expect(calls).toHaveLength(0);
    expect(result.state).toBe('nothing-ready');
    expect(result.transition).toBe('pr');
    expect(readJournalTolerant(projectRoot, BATCH)).toHaveLength(0);
  });

  it('prGrouping unset behaves exactly as off → zero spawns, nothing-ready', async () => {
    // A resolved BatchSettings always carries prGrouping; simulate an unset value
    // at the engine boundary by omitting it.
    const unset = { ...settings() } as Partial<BatchSettings>;
    delete unset.prGrouping;
    const result = await engine({ spawner: capturingSpawner }).runPrStep(
      prCtx({ settings: unset as BatchSettings })
    );
    expect(calls).toHaveLength(0);
    expect(result.state).toBe('nothing-ready');
    expect(readJournalTolerant(projectRoot, BATCH)).toHaveLength(0);
  });
});

describe('pr-spawn-at-completion — idempotent resume never double-opens', () => {
  it('a pre-seeded pr completion → zero spawns on re-run, no second entry', async () => {
    // A PR was already opened in a prior run: the batch journal carries a pr
    // completion.
    appendJournalForLocus(
      projectRoot,
      { batch: BATCH },
      { change: KEY, kind: 'completion', message: 'opened earlier', transition: 'pr' }
    );

    const result = await engine({ spawner: capturingSpawner }).runPrStep(prCtx());
    expect(calls).toHaveLength(0);
    expect(result.state).toBe('nothing-ready');
    // Still exactly the one pre-seeded entry — nothing new appended.
    expect(readJournalTolerant(projectRoot, BATCH)).toHaveLength(1);
  });
});

describe('pr-spawn-at-completion — failures surface and keep retry possible', () => {
  it('a non-zero exit without a completion → a failure with NO pr completion journaled', async () => {
    const result = await engine({ spawner: failingSpawner }).runPrStep(prCtx());
    // The agent WAS spawned, but failed.
    expect(calls).toHaveLength(1);
    // A failure surfaces as a resumable blocked step (failed → blocked).
    expect(result.state).toBe('blocked');
    // No pr completion journaled, so a subsequent run is free to retry.
    expect(hasJournaledPr(readJournalTolerant(projectRoot, BATCH))).toBe(false);
  });

  it('a remote locus the engine cannot render into → a failure with zero spawns', async () => {
    const printed: string[] = [];
    const result = await engine({
      spawner: capturingSpawner,
      printLine: (l) => printed.push(l),
    }).runPrStep(
      prCtx({ settings: settings({ locus: 'remote', host: 'h', port: 1, authToken: 't' }) })
    );

    expect(calls).toHaveLength(0); // no spawn
    expect(result.state).toBe('blocked'); // failed → blocked, resumable
    const surfaced = (result.message ?? '') + '\n' + printed.join('\n');
    expect(surfaced).toContain('open-pr'); // names the missing command
    expect(surfaced).toContain('remote'); // names the locus
    // A locus failure records no pr completion, so retry stays possible.
    expect(hasJournaledPr(readJournalTolerant(projectRoot, BATCH))).toBe(false);
  });
});
