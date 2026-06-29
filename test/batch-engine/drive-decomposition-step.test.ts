/**
 * `ratchet batch apply` drives a ready empty phase's decomposition NATIVELY (#30).
 *
 * `empty-phase-is-not-done` taught status/selection to RECOGNIZE a reachable,
 * ungated phase with empty `changes` as an outstanding decomposition step. This
 * slice makes the apply path ACT on it: `pickNextStep` surfaces the decomposition
 * step, and the engine's phase-scoped entry point spawns ONE agent that delegates
 * to the canonical decomposition skill to author that phase's concrete change
 * intents into `batch.yaml` from the prior phase's shipped results — then the loop
 * continues into the new changes and `done` stays honest.
 *
 * Asserted here (the phase proof-of-work):
 *  (a) the decomposition step is SELECTED (not "nothing ready");
 *  (b) exactly ONE agent is spawned for the phase and its instructions INVOKE the
 *      canonical decomposition skill with the phase context + prior results
 *      injected (not an inline re-description);
 *  (c) after the step the previously-empty phase holds concrete change intents
 *      (each with a non-empty `done`) in `batch.yaml`;
 *  (d) the next selection advances the first NEW change, not the decomposition;
 *  (e) status stays NOT `done` until every reachable phase is decomposed and all
 *      changes done;
 *  (f) a spawn locus missing the decomposition command renders it, or (remote)
 *      fails with the actionable bootstrap message and spawns nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal, recordProofOfWork } from '../../src/core/batch/journal.js';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type { AgentRuntime } from '../../src/core/batch/engine/runtime/contract.js';
import type {
  DecompositionStepContext,
} from '../../src/core/batch/engine/contract.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import {
  loadBatchManifest,
  getBatchManifestPath,
  type BatchSettings,
  type ProofOfWork,
} from '../../src/core/batch/manifest.js';
import { pickNextStep } from '../../src/commands/batch/apply.js';

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

const BATCH = 'ddstep';
const POW = `proofOfWork: { kind: integration, run: x, pass: '0' }`;

/** Manifest: p1 has one change, p2 is reachable-but-empty (to decompose). */
const UNDECOMPOSED = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s2
    ${POW}
    changes: []
`;

/** What the stub decomposition agent writes: p2 now carries a concrete change. */
const DECOMPOSED = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s2
    ${POW}
    changes:
      - name: second
        done: second is done
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ddstep-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function writeManifest(content: string): Promise<void> {
  await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), content, 'utf-8');
}

/** Mark a change done under the journal-aware rule: tasks checked + verify journaled. */
async function markDone(change: string): Promise<void> {
  const dir = path.join(projectRoot, '.ratchet', 'changes', change);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] 1.1 done\n', 'utf-8');
  appendJournal(projectRoot, BATCH, {
    change,
    kind: 'completion',
    message: 'verified',
    transition: 'verify',
  });
}

/** Record a passing boundary proof for a phase (what `batch apply` records). */
function recordTerminalProof(phase: string): void {
  recordProofOfWork(projectRoot, BATCH, phase, {
    phase,
    passed: true,
    gatePassed: true,
    policy: 'hard-gate',
    reason: 'pass-condition-met',
    detail: 'Proof-of-work passed (0).',
  });
}

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    agent: 'claude',
    ...over,
  };
}

function decompositionContext(over: Partial<DecompositionStepContext> = {}): DecompositionStepContext {
  return {
    batch: BATCH,
    phase: {
      name: 'p2',
      goal: 'decompose me later',
      success: 's2',
      proofOfWork: { kind: 'integration', run: 'x', pass: '0' } as ProofOfWork,
    },
    priorResults: [{ phase: 'p1', changes: [{ name: 'first', done: 'first is done' }] }],
    settings: settings(),
    ...over,
  };
}

/**
 * A recording runtime that stands in for the decomposition agent: captures every
 * spawn request, writes the decomposed manifest (authoring p2's change intents),
 * and reports a completion keyed by the phase name (the decomposition journal key).
 */
function stubDecomposer(): { runtime: AgentRuntime; calls: { instructions: string }[] } {
  const calls: { instructions: string }[] = [];
  const runtime: AgentRuntime = async (req, onEvent) => {
    calls.push({ instructions: req.instructions });
    await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), DECOMPOSED, 'utf-8');
    appendJournal(projectRoot, BATCH, {
      change: 'p2',
      kind: 'completion',
      message: 'authored p2 change intents',
      transition: 'decompose',
    });
    onEvent({ kind: 'exit', exitCode: 0 });
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
  return { runtime, calls };
}

describe('drive-decomposition-step: apply drives a ready empty phase natively', () => {
  it('(a) selection surfaces the empty phase as the decomposition step', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    // p1's boundary proof is treated as already recorded so this isolates the
    // decomposition selection; the predecessor-proof-before-decompose ordering
    // (S4) is covered by its own test below.
    const target = pickNextStep(status, manifest.phases, new Set(['p1']));
    expect(target).toBeDefined();
    expect(target!.kind).toBe('decompose');
    expect(target!.phase.name).toBe('p2');
  });

  it('(S4) runs the predecessor phase boundary proof before the decomposition step', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    // p1 is done with a configured but UNRECORDED proof; p2 (undecomposed) is
    // entered off p1's shipped slice, so p1's boundary proof must run FIRST —
    // before the decomposition step — exactly as before a change step.
    const target = pickNextStep(status, manifest.phases, new Set());
    expect(target).toMatchObject({ kind: 'proof-of-work' });
    expect(target!.phase.name).toBe('p1');
  });

  it('(b)(c) spawns ONE delegating agent that authors p2 intents into batch.yaml', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');

    const stub = stubDecomposer();
    const engine = new RatchetBatchEngine({
      runtime: stub.runtime,
      projectRoot: () => projectRoot,
      printLine: () => {},
    });

    const result = await engine.runDecompositionStep(decompositionContext());

    // (b) exactly one agent, instructions delegate to the canonical skill with
    // context injected — not an inline re-description of the steps.
    expect(stub.calls).toHaveLength(1);
    const instr = stub.calls[0].instructions;
    expect(instr).toContain('/rct:decompose-phase p2'); // canonical skill invocation (claude token)
    expect(instr).toContain('decompose me later'); // phase goal injected
    expect(instr).toContain('s2'); // phase success injected
    expect(instr).toContain('first: first is done'); // prior phase shipped result injected
    expect(instr).toMatch(/Do NOT hand-build|delegate to the skill/); // delegation, not inline steps
    expect(result.state).toBe('advanced');
    expect(result.transition).toBe('decompose');

    // (c) the previously-empty phase now holds a concrete change intent with done.
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const p2 = manifest.phases.find((p) => p.name === 'p2')!;
    expect(p2.changes.length).toBeGreaterThan(0);
    expect(p2.changes.every((c) => c.done.trim().length > 0)).toBe(true);
  });

  it('(W1) a resumed decomposition surfaces the answer text in the spawned instructions', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');

    const stub = stubDecomposer();
    const engine = new RatchetBatchEngine({
      runtime: stub.runtime,
      projectRoot: () => projectRoot,
      printLine: () => {},
    });

    // A decomposition that was parked on a blocker and then answered: the answer
    // must ride into the spawned instructions, not be silently dropped on resume.
    await engine.runDecompositionStep(
      decompositionContext({
        resume: {
          kind: 'blocked',
          reason: 'which slice should p2 ship?',
          answer: 'ship the read-only dashboard slice',
        },
      })
    );

    expect(stub.calls).toHaveLength(1);
    const instr = stub.calls[0].instructions;
    // The resolved answer rides on the decompose-phase invocation as an argument.
    expect(instr).toContain('ship the read-only dashboard slice');
    expect(instr).toContain('/rct:decompose-phase p2');
    // The resume intent framing is present too (incorporate, do not start over).
    expect(instr).toContain('which slice should p2 ship?');
  });

  it('(d)(e) after decomposition the next step is the new change, and done stays honest', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');
    const stub = stubDecomposer();
    const engine = new RatchetBatchEngine({
      runtime: stub.runtime,
      projectRoot: () => projectRoot,
      printLine: () => {},
    });
    await engine.runDecompositionStep(decompositionContext());

    // (d) selection now advances the first NEW change, not the decomposition step.
    // p1's proof is treated as already recorded here so the boundary proof step
    // (its own concern, covered separately) does not mask the decomposition flow.
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);
    const target = pickNextStep(status, manifest.phases, new Set(['p1']));
    expect(target!.kind).toBe('change');
    expect(target).toMatchObject({ kind: 'change', change: 'second' });

    // (e) NOT done while the decomposed phase still has an unfinished change.
    expect(status.status).not.toBe('done');

    // Finish the new change → now every reachable phase is decomposed and done.
    await markDone('second');
    // p2 is the terminal phase; record its boundary proof so the batch can be
    // `done` (C2 — the terminal proof has no successor boundary to trigger it).
    recordTerminalProof('p2');
    const doneStatus = await computeBatchStatus(projectRoot, manifest);
    expect(doneStatus.status).toBe('done');
    expect(pickNextStep(doneStatus, manifest.phases)).toBeUndefined();
  });

  it('(f) a missing decomposition command is rendered into the spawn locus before spawning', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');
    const stub = stubDecomposer();
    const engine = new RatchetBatchEngine({
      runtime: stub.runtime,
      projectRoot: () => projectRoot,
      printLine: () => {},
    });

    expect(
      existsSync(path.join(projectRoot, '.claude', 'commands', 'rct', 'decompose-phase.md'))
    ).toBe(false);

    const result = await engine.runDecompositionStep(decompositionContext());

    expect(result.state).toBe('advanced');
    // The canonical decomposition command was rendered into the spawn locus.
    expect(
      existsSync(path.join(projectRoot, '.claude', 'commands', 'rct', 'decompose-phase.md'))
    ).toBe(true);
  });

  it('(f) a locus the engine cannot render into fails with an actionable message, no spawn', async () => {
    await writeManifest(UNDECOMPOSED);
    await markDone('first');
    const stub = stubDecomposer();
    const printed: string[] = [];
    const engine = new RatchetBatchEngine({
      runtime: stub.runtime,
      projectRoot: () => projectRoot,
      printLine: (l) => printed.push(l),
    });

    const result = await engine.runDecompositionStep(
      decompositionContext({
        settings: settings({ locus: 'remote', host: 'h', port: 1, authToken: 't' }),
      })
    );

    expect(stub.calls).toHaveLength(0); // no spawn
    expect(result.state).toBe('blocked'); // failed → blocked, resumable
    const surfaced = (result.message ?? '') + '\n' + printed.join('\n');
    expect(surfaced).toContain('decompose-phase'); // names the missing command
    expect(surfaced).toContain('remote'); // names the locus
  });

  it('end-to-end: an empty later phase is not done after the first phase and is driven to done', async () => {
    // PRIOR STATE: p1 done, p2 empty. The batch is NOT done.
    await writeManifest(UNDECOMPOSED);
    await markDone('first');
    let manifest = loadBatchManifest(projectRoot, BATCH);
    let status = await computeBatchStatus(projectRoot, manifest);
    expect(status.status).not.toBe('done');
    // p1's boundary proof is treated as recorded so this isolates the
    // decomposition step from the (separately covered) predecessor-proof ordering.
    expect(pickNextStep(status, manifest.phases, new Set(['p1']))!.kind).toBe('decompose');

    // One apply decomposes p2 (delegating to the canonical skill) — no manual detour.
    const stub = stubDecomposer();
    const engine = new RatchetBatchEngine({
      runtime: stub.runtime,
      projectRoot: () => projectRoot,
      printLine: () => {},
    });
    await engine.runDecompositionStep(decompositionContext());
    expect(stub.calls).toHaveLength(1);

    // Subsequent apply advances p2's authored change; only then is the batch done.
    manifest = loadBatchManifest(projectRoot, BATCH);
    status = await computeBatchStatus(projectRoot, manifest);
    expect(status.status).not.toBe('done');
    // p1's boundary proof treated as recorded so this asserts the decomposition
    // flow, not the (separately covered) proof-of-work boundary step.
    expect(pickNextStep(status, manifest.phases, new Set(['p1']))).toMatchObject({
      kind: 'change',
      change: 'second',
    });

    await markDone('second');
    // p2 is the terminal phase: its boundary proof must be recorded for the
    // batch to be `done` (C2).
    recordTerminalProof('p2');
    status = await computeBatchStatus(projectRoot, manifest);
    expect(status.status).toBe('done');
  });
});
