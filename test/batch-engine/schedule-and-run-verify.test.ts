/**
 * The verify gate, won at the REAL selection seam.
 *
 * `journal-aware-done` proved the done-predicate and the status surface by
 * hand-feeding `runStep` a forced `context()`. This test instead exercises the
 * path `ratchet batch apply` actually takes to decide WHICH change/transition
 * runs next: it drives propose -> apply with a stub agent, then lets SELECTION
 * choose the step (`pickNextStep` over `computeBatchStatus`, plus the pure
 * `selectRunnableStep`) and runs exactly that selected step. It asserts:
 *
 *  (a) after apply, both `pickNextStep` and `selectRunnableStep` return the
 *      `awaiting-verify` change, with `verify` as its next transition;
 *  (b) running the selected step spawns a prompt that DELEGATES to
 *      `/rct:verify <change>` (the canonical skill) rather than describing verify
 *      inline (`delegated-lifecycle`);
 *  (c) the journaled verify completion flips the change to `done` with nothing
 *      further runnable (selection drains, `computeNextTransition` undefined);
 *  (d) a partially-applied change is selected for `apply`, not `verify`;
 *  (e) `ready` / `blocked` selection is not regressed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import { appendJournal, recordProofOfWork } from '../../src/core/batch/journal.js';
import {
  computeNextTransition,
  isChangeDone,
  readChangeDiskState,
  selectRunnableStep,
  type SelectablePhase,
} from '../../src/core/batch/engine/index.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import { readChangeJournalTolerant } from '../../src/core/batch/engine/run-state.js';
import { parseBatchManifest } from '../../src/core/batch/manifest.js';
import { pickNextStep } from '../../src/commands/batch/apply.js';
import type {
  ResolvedStepContext,
  BatchSettings,
  ProofOfWork,
} from 'ratchet-ai';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'srv-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const BATCH = 'srv';
const CHANGE = 'schedule-and-run-verify';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

const MANIFEST = `
name: ${BATCH}
phases:
  - name: p1
    goal: schedule and run verify from selection
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: ${CHANGE}
        done: the change is implemented and verified
`;

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'autonomous',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    agent: 'fake',
    ...over,
  };
}

/** A stub agent that runs an effect for whichever transition it is given. */
function engineWith(effect: (root: string, request: AgentSpawnRequest) => Promise<void>): {
  engine: RatchetBatchEngine;
  calls: AgentSpawnRequest[];
} {
  const calls: AgentSpawnRequest[] = [];
  const adapter: AgentAdapter = {
    name: 'fake',
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      return { command: 'fake-agent', args: [], instructions, cwd, env };
    },
  };
  const spawner: Spawner = async (request) => {
    calls.push(request);
    await effect(projectRoot, request);
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
  const engine = new RatchetBatchEngine({
    spawner,
    adapters: { fake: adapter },
    projectRoot: () => projectRoot,
  });
  return { engine, calls };
}

/** propose: scaffold the change dir + a plan with one OPEN task. */
async function proposeEffect(root: string): Promise<void> {
  const dir = path.join(root, '.ratchet', 'changes', CHANGE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [ ] 1.1 build the slice\n', 'utf-8');
  appendJournal(root, BATCH, {
    change: CHANGE,
    kind: 'completion',
    message: 'proposed the slice',
    transition: 'propose',
  });
}

/** apply: check every task and report completion — but journal NO verify. */
async function applyEffect(root: string): Promise<void> {
  const plan = path.join(root, '.ratchet', 'changes', CHANGE, 'plan.md');
  await fs.writeFile(plan, '## Tasks\n- [x] 1.1 build the slice\n', 'utf-8');
  appendJournal(root, BATCH, {
    change: CHANGE,
    kind: 'completion',
    message: 'implemented the tasks',
    transition: 'apply',
  });
}

/** verify: report a verify completion — this is the gate the done-rule requires. */
async function verifyEffect(root: string): Promise<void> {
  appendJournal(root, BATCH, {
    change: CHANGE,
    kind: 'completion',
    message: 'verified the slice',
    transition: 'verify',
  });
}

/** The pure selection view for the single-change phase, from disk + journal. */
function selectableFor(): SelectablePhase[] {
  const disk = readChangeDiskState(projectRoot, CHANGE);
  const journal = readChangeJournalTolerant(projectRoot, BATCH, CHANGE);
  return [
    {
      name: 'p1',
      gated: false,
      // `done` fed from the SAME journal-aware predicate as status/transition.
      changes: [{ name: CHANGE, after: [], done: isChangeDone(disk, journal), parked: false }],
    },
  ];
}

/**
 * Run exactly the step SELECTION picks — mirroring `batchApplyCommand`: pick the
 * next step from the derived status, then build the context the way the CLI does
 * (transition DERIVED from `computeNextTransition`, never hand-fed). Returns the
 * spawned requests so callers can assert on the delegated prompt.
 */
async function runSelectedStep(
  effect: (root: string, request: AgentSpawnRequest) => Promise<void>
): Promise<{ calls: AgentSpawnRequest[]; transition: string; change: string }> {
  const manifest = parseBatchManifest(MANIFEST);
  const status = await computeBatchStatus(projectRoot, manifest);
  const target = pickNextStep(status, manifest.phases);
  if (!target) throw new Error('expected a runnable step');
  const transition = computeNextTransition(projectRoot, target.change) ?? 'propose';
  const ctx: ResolvedStepContext = {
    batch: BATCH,
    change: target.change,
    changeDone: target.changeDone,
    transition,
    phase: { name: target.phase.name, goal: target.phase.goal, success: target.phase.success, proofOfWork: POW },
    settings: settings(),
    journal: readChangeJournalTolerant(projectRoot, BATCH, target.change),
  };
  const { engine, calls } = engineWith(effect);
  await engine.runStep(ctx);
  return { calls, transition, change: target.change };
}

/** Resolve the single change's derived status from the batch status surface. */
async function statusOf(change: string): Promise<{
  status: Awaited<ReturnType<typeof computeBatchStatus>>;
  change: { name: string; status: string };
}> {
  const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
  for (const phase of status.phases) {
    const c = phase.changes.find((ch) => ch.name === change);
    if (c) return { status, change: c };
  }
  throw new Error('change not found');
}

describe('verify scheduled and run through the real selection seam', () => {
  it('selects awaiting-verify, runs a delegated /rct:verify, then flips to done', async () => {
    // --- drive propose -> apply with a stub agent (sets up disk + journal) ----
    await runSelectedStep(proposeEffect); // propose: plan with an open task
    {
      // After propose the plan has an open task: selected for apply, not verify.
      const manifest = parseBatchManifest(MANIFEST);
      const status = await computeBatchStatus(projectRoot, manifest);
      const target = pickNextStep(status, manifest.phases)!;
      expect(target.change).toBe(CHANGE);
      expect(computeNextTransition(projectRoot, CHANGE)).toBe('apply');
    }
    await runSelectedStep(applyEffect); // apply: all tasks checked, NO verify

    const journalAfterApply = readChangeJournalTolerant(projectRoot, BATCH, CHANGE);

    // (a) SELECTION returns the awaiting-verify change, verify is its next step.
    {
      const { change } = await statusOf(CHANGE);
      expect(change.status).toBe('awaiting-verify');
      const manifest = parseBatchManifest(MANIFEST);
      const status = await computeBatchStatus(projectRoot, manifest);
      const target = pickNextStep(status, manifest.phases);
      expect(target).toBeDefined();
      expect(target!.change).toBe(CHANGE);
    }
    expect(computeNextTransition(projectRoot, CHANGE, journalAfterApply)).toBe('verify');
    expect(selectRunnableStep(selectableFor()).step).toEqual({ phase: 'p1', change: CHANGE });

    // (b) running the SELECTED step spawns a verify transition that DELEGATES to
    //     /rct:verify <change> rather than re-describing verify inline.
    const verifyRun = await runSelectedStep(verifyEffect);
    expect(verifyRun.transition).toBe('verify');
    expect(verifyRun.calls).toHaveLength(1);
    const prompt = verifyRun.calls[0].instructions;
    expect(prompt).toContain(`/rct:verify ${CHANGE}`);
    // Delegation, not re-authoring: the prompt hands off to the skill as the
    // single author of the verify lifecycle (delegated-lifecycle).
    expect(prompt).toContain('delegate to the skill');
    expect(prompt).toMatch(/Do NOT hand-build or re-describe\n?the verify steps/);

    // (c) the change is done, but p1 is the TERMINAL phase: selection now surfaces
    //     its boundary proof-of-work as the next step (C2) — the batch is not done
    //     until that terminal proof is recorded.
    const journalAfterVerify = readChangeJournalTolerant(projectRoot, BATCH, CHANGE);
    {
      const { status, change } = await statusOf(CHANGE);
      expect(change.status).toBe('done');
      expect(status.next).toEqual({ phase: 'p1', proof: true });
      const manifest = parseBatchManifest(MANIFEST);
      const proofTarget = pickNextStep(status, manifest.phases);
      expect(proofTarget).toMatchObject({ kind: 'proof-of-work' });
      expect((proofTarget as { phase: { name: string } }).phase.name).toBe('p1');
    }

    // The terminal-phase boundary proof runs and records a passing verdict (what
    // `batch apply` does at the terminal boundary); now the batch drains to done.
    recordProofOfWork(projectRoot, BATCH, 'p1', {
      phase: 'p1',
      passed: true,
      gatePassed: true,
      policy: 'hard-gate',
      reason: 'pass-condition-met',
      detail: 'Proof-of-work passed (0).',
    });
    {
      const { status, change } = await statusOf(CHANGE);
      expect(change.status).toBe('done');
      expect(status.next).toBeUndefined();
      const manifest = parseBatchManifest(MANIFEST);
      expect(pickNextStep(status, manifest.phases, new Set(['p1']))).toBeUndefined();
    }
    expect(computeNextTransition(projectRoot, CHANGE, journalAfterVerify)).toBeUndefined();
    expect(selectRunnableStep(selectableFor()).reason).toBe('all-done');
  });

  it('(d) selects a partially-applied change for apply, not verify', async () => {
    const dir = path.join(projectRoot, '.ratchet', 'changes', CHANGE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] 1.1\n- [ ] 1.2\n', 'utf-8');

    const { change } = await statusOf(CHANGE);
    expect(change.status).toBe('in-progress');

    const manifest = parseBatchManifest(MANIFEST);
    const status = await computeBatchStatus(projectRoot, manifest);
    const target = pickNextStep(status, manifest.phases);
    expect(target!.change).toBe(CHANGE);
    // The selected step's transition is apply (tasks not all checked), not verify.
    expect(computeNextTransition(projectRoot, CHANGE)).toBe('apply');
  });

  it('(e) does not regress ready / blocked selection', async () => {
    const twoChange = `
name: ${BATCH}
phases:
  - name: p1
    goal: g
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: first
        done: first is done
      - name: second
        after: [first]
        done: second is done
`;
    const manifest = parseBatchManifest(twoChange);
    const status = await computeBatchStatus(projectRoot, manifest);
    const first = status.phases[0].changes.find((c) => c.name === 'first')!;
    const second = status.phases[0].changes.find((c) => c.name === 'second')!;
    expect(first.status).toBe('ready');
    expect(second.status).toBe('blocked');

    // The CLI seam picks the ready change, never the blocked one.
    const target = pickNextStep(status, manifest.phases);
    expect(target!.change).toBe('first');

    // The pure seam agrees: first is runnable, second is gated behind it.
    const phases: SelectablePhase[] = [
      {
        name: 'p1',
        gated: false,
        changes: [
          { name: 'first', after: [], done: false, parked: false },
          { name: 'second', after: ['first'], done: false, parked: false },
        ],
      },
    ];
    expect(selectRunnableStep(phases).step).toEqual({ phase: 'p1', change: 'first' });
  });
});
