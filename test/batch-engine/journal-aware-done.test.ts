/**
 * The single journal-aware definition of done, end to end.
 *
 * Drives propose -> apply -> verify on ONE change with a stub agent and asserts
 * the three consumers of "done" agree on one predicate (delegated-lifecycle:
 * "'Done' has one definition"):
 *
 *  - after apply (all tasks checked, NO journaled verify) the change is
 *    `awaiting-verify` — NOT done — and the next scheduled transition is `verify`;
 *    `computeBatchStatus`, `computeNextTransition`, and `selectRunnableStep` all
 *    agree the change still has runnable work.
 *  - once the verify step journals a verify completion the change is `done` and
 *    there is no next transition / nothing runnable.
 *  - status NEVER reports done for a change the transition logic still wants to
 *    verify.
 *  - the existing ready / blocked / in-progress derivations are not regressed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import { appendJournal } from '../../src/core/batch/journal.js';
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
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jad-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const BATCH = 'jad';
const CHANGE = 'journal-aware-done';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

const MANIFEST = `
name: ${BATCH}
phases:
  - name: p1
    goal: a single done-rule slice
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

function context(over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    batch: BATCH,
    change: CHANGE,
    transition: 'propose',
    phase: { name: 'p1', goal: 'a single done-rule slice', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
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

/** Build the selection view for the single-change phase from disk + journal. */
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

function statusChange() {
  return computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST)).then((s) => {
    for (const phase of s.phases) {
      const c = phase.changes.find((ch) => ch.name === CHANGE);
      if (c) return { status: s, change: c };
    }
    throw new Error('change not found');
  });
}

describe('single journal-aware done-rule, driven propose -> apply -> verify', () => {
  it('schedules and runs verify as the gate before a change is done', async () => {
    // --- propose: change dir + plan with an open task -------------------------
    const r1 = await engineWith(proposeEffect).engine.runStep(context());
    expect(r1.state).toBe('advanced');
    expect(r1.transition).toBe('propose');
    {
      const { change } = await statusChange();
      // Plan exists with an open task: in-progress, not yet awaiting-verify.
      expect(change.status).toBe('in-progress');
    }

    // --- apply: tasks all checked, NO journaled verify ------------------------
    const r2 = await engineWith(applyEffect).engine.runStep(context());
    expect(r2.state).toBe('advanced');
    expect(r2.transition).toBe('apply');

    const journalAfterApply = readChangeJournalTolerant(projectRoot, BATCH, CHANGE);

    // (a) status: awaiting-verify, NOT done, and it is the next actionable step.
    {
      const { status, change } = await statusChange();
      expect(change.status).toBe('awaiting-verify');
      expect(change.status).not.toBe('done');
      expect(status.doneCount).toBe(0);
      expect(status.status).toBe('in-progress');
      expect(status.next).toEqual({ phase: 'p1', change: CHANGE });
    }

    // (c) transition + selection agree: verify is next, and the change is runnable.
    expect(computeNextTransition(projectRoot, CHANGE, journalAfterApply)).toBe('verify');
    expect(selectRunnableStep(selectableFor()).step).toEqual({ phase: 'p1', change: CHANGE });

    // --- verify: runs and journals a verify completion ------------------------
    const r3 = await engineWith(verifyEffect).engine.runStep(context());
    expect(r3.state).toBe('advanced');
    expect(r3.transition).toBe('verify');

    const journalAfterVerify = readChangeJournalTolerant(projectRoot, BATCH, CHANGE);

    // (b) once verify is journaled: done, nothing runnable, batch done.
    {
      const { status, change } = await statusChange();
      expect(change.status).toBe('done');
      expect(status.doneCount).toBe(1);
      expect(status.status).toBe('done');
      expect(status.next).toBeUndefined();
    }
    expect(computeNextTransition(projectRoot, CHANGE, journalAfterVerify)).toBeUndefined();
    expect(selectRunnableStep(selectableFor()).reason).toBe('all-done');
  });

  it('status never reports done for a change the transition logic still wants to verify', async () => {
    // All tasks checked but no verify journaled — the disagreement the old two
    // divergent rules produced. Both consumers must agree it is not done.
    const dir = path.join(projectRoot, '.ratchet', 'changes', CHANGE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] 1.1\n', 'utf-8');

    const { change } = await statusChange();
    expect(change.status).not.toBe('done');
    expect(change.status).toBe('awaiting-verify');
    expect(computeNextTransition(projectRoot, CHANGE, [])).toBe('verify');
  });
});

describe('single journal-aware done-rule, regression guards', () => {
  it('preserves ready / blocked for not-yet-created changes', async () => {
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
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(twoChange));
    const first = status.phases[0].changes.find((c) => c.name === 'first')!;
    const second = status.phases[0].changes.find((c) => c.name === 'second')!;
    expect(first.status).toBe('ready');
    expect(second.status).toBe('blocked');
    expect(first.status).not.toBe('awaiting-verify');
    expect(second.status).not.toBe('awaiting-verify');
  });

  it('keeps a partially-checked plan in-progress regardless of the journal', async () => {
    const dir = path.join(projectRoot, '.ratchet', 'changes', CHANGE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] 1.1\n- [ ] 1.2\n', 'utf-8');
    const { change } = await statusChange();
    expect(change.status).toBe('in-progress');
    expect(change.status).not.toBe('awaiting-verify');
    expect(change.status).not.toBe('done');
  });
});
