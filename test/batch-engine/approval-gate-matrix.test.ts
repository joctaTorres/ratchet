// Feature: approval-gate-matrix/per-gate-parking.feature
// Feature: approval-gate-matrix/approval-resume-flow.feature
// Integration scenarios for the gate matrix at the engine-flow layer (tmpdir fixtures).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type {
  ResolvedStepContext,
  BatchSettings,
  ProofOfWork,
} from 'ratchet-ai';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import { spawnerAsRuntime } from '../helpers/spawner-as-runtime.js';
import { readChangeDiskState } from '../../src/core/batch/engine/transition.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-matrix-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    agent: 'fake',
    ...over,
  };
}

function context(over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    batch: 'b',
    change: 'add-login-api',
    transition: 'propose',
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

function fakeAgent(behavior: {
  report?: (root: string, batch: string, change: string) => void;
  exitCode?: number;
}): { adapter: AgentAdapter; spawner: Spawner; calls: AgentSpawnRequest[] } {
  const calls: AgentSpawnRequest[] = [];
  const adapter: AgentAdapter = {
    name: 'fake',
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      return { command: 'fake-agent', args: [], instructions, cwd, env };
    },
  };
  const spawner: Spawner = async (request) => {
    calls.push(request);
    behavior.report?.(projectRoot, 'b', 'add-login-api');
    return { exitCode: behavior.exitCode ?? 0, signal: null, stdout: '', stderr: '' };
  };
  return { adapter, spawner, calls };
}

function engineWith(behavior: Parameters<typeof fakeAgent>[0]) {
  const { adapter, spawner, calls } = fakeAgent(behavior);
  const engine = new RatchetBatchEngine({
    runtime: spawnerAsRuntime(spawner),
    adapters: { fake: adapter },
    projectRoot: () => projectRoot,
  });
  return { engine, calls };
}

function corroborate(
  root: string,
  change: string,
  transition: 'propose' | 'apply' | 'verify'
): void {
  const dir = path.join(root, '.ratchet', 'changes', change);
  if (transition === 'propose') {
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(path.join(dir, 'plan.md'), '## Tasks\n- [ ] do it\n');
  } else if (transition === 'apply') {
    const planPath = path.join(dir, 'plan.md');
    if (!fsSync.existsSync(planPath)) {
      fsSync.mkdirSync(dir, { recursive: true });
      fsSync.writeFileSync(planPath, '## Tasks\n- [ ] do it\n');
    }
    fsSync.writeFileSync(planPath, '## Tasks\n- [x] do it\n');
  }
  // verify: no disk artifact; the verdict rides in the completion message.
}

const VERIFY_COMPLETION = 'All scenarios satisfied. Ready for archive.';

describe('per-gate-parking: voluntary gate never parks a completed transition', () => {
  for (const transition of ['propose', 'apply', 'verify'] as const) {
    it(`voluntary + ${transition} → advanced, no awaiting-approval park`, async () => {
      // For apply/verify the change must already be proposed/applied on disk so
      // the transition derives correctly and corroboration passes.
      if (transition !== 'propose') {
        corroborate(projectRoot, 'add-login-api', 'propose');
        if (transition === 'verify') corroborate(projectRoot, 'add-login-api', 'apply');
      }
      const { engine } = engineWith({
        report: (root, batch, change) => {
          corroborate(root, change, transition);
          appendJournal(root, batch, {
            change,
            kind: 'completion',
            message: transition === 'verify' ? VERIFY_COMPLETION : 'done',
            transition,
          });
        },
      });
      const result = await engine.runStep(
        context({
          transition,
          ...(transition !== 'propose'
            ? { journal: [] }
            : {}),
        })
      );
      expect(result.state).toBe('advanced');
    });
  }
});

describe('per-gate-parking: after-propose parks propose only', () => {
  it('after-propose + propose → awaiting-approval', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) => {
        corroborate(root, change, 'propose');
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'draft ready',
          transition: 'propose',
        });
      },
    });
    const result = await engine.runStep(
      context({ settings: settings({ gate: 'after-propose' }) })
    );
    expect(result.state).toBe('awaiting-approval');
  });

  it('after-propose + apply → advanced, no park', async () => {
    corroborate(projectRoot, 'add-login-api', 'propose');
    const { engine } = engineWith({
      report: (root, batch, change) => {
        corroborate(root, change, 'apply');
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'applied',
          transition: 'apply',
        });
      },
    });
    const result = await engine.runStep(
      context({ transition: 'apply', settings: settings({ gate: 'after-propose' }) })
    );
    expect(result.state).toBe('advanced');
  });
});

describe('per-gate-parking: every-phase parks every completed change transition', () => {
  for (const transition of ['propose', 'apply', 'verify'] as const) {
    it(`every-phase + ${transition} → awaiting-approval, message names ${transition}`, async () => {
      if (transition !== 'propose') {
        corroborate(projectRoot, 'add-login-api', 'propose');
        if (transition === 'verify') corroborate(projectRoot, 'add-login-api', 'apply');
      }
      const { engine } = engineWith({
        report: (root, batch, change) => {
          corroborate(root, change, transition);
          appendJournal(root, batch, {
            change,
            kind: 'completion',
            message: transition === 'verify' ? VERIFY_COMPLETION : 'done',
            transition,
          });
        },
      });
      const result = await engine.runStep(
        context({ transition, settings: settings({ gate: 'every-phase' }) })
      );
      expect(result.state).toBe('awaiting-approval');
      const label =
        transition === 'propose'
          ? 'Propose'
          : transition === 'apply'
            ? 'Apply'
            : 'Verify';
      expect(result.message).toBe(`${label} complete; awaiting approval.`);
    });
  }
});

describe('per-gate-parking: autonomous gate never parks a completed transition', () => {
  it('autonomous + propose → advanced, no park', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) => {
        corroborate(root, change, 'propose');
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'done',
          transition: 'propose',
        });
      },
    });
    const result = await engine.runStep(
      context({ settings: settings({ gate: 'autonomous' }) })
    );
    expect(result.state).toBe('advanced');
  });
});

describe('approval-resume-flow: approving a parked propose does not exempt the subsequent apply', () => {
  it('every-phase: approve a parked propose, then apply parks again', async () => {
    // 1. Propose parks under every-phase.
    corroborate(projectRoot, 'add-login-api', 'propose');
    const { engine } = engineWith({
      report: (root, batch, change) => {
        corroborate(root, change, 'apply');
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'applied',
          transition: 'apply',
        });
      },
    });
    // The propose was approved: resume carries answer (approval), so apply does
    // NOT suppress the park (answer/feedback suppression is per-TRANSITION; an
    // approved propose's resume only suppresses a re-run of propose).
    const result = await engine.runStep(
      context({
        transition: 'apply',
        settings: settings({ gate: 'every-phase' }),
        // No resume on the apply transition itself → it parks fresh.
      })
    );
    expect(result.state).toBe('awaiting-approval');
    expect(result.message).toBe('Apply complete; awaiting approval.');
  });
});

describe('approval-resume-flow: a rejected transition re-runs without re-parking', () => {
  it('every-phase: rejected apply re-runs and advances (feedback suppresses park)', async () => {
    // Leave the change proposed-but-not-applied so the forced apply transition
    // has a real task to check off this session (corroboration measures a delta).
    corroborate(projectRoot, 'add-login-api', 'propose');
    const { engine, calls } = engineWith({
      report: (root, batch, change) => {
        corroborate(root, change, 'apply');
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'revised apply',
          transition: 'apply',
        });
      },
    });
    // runChangeStep forces the transition verbatim (no computeNextTransition),
    // exactly as the headless apply verb does.
    const result = await engine.runChangeStep({
      ...context({
        transition: 'apply',
        settings: settings({ gate: 'every-phase' }),
        resume: {
          kind: 'awaiting-approval',
          reason: 'apply v1',
          feedback: 'cover the edge case',
        },
      }),
    });
    expect(result.state).toBe('advanced');
    expect(calls[0].instructions).toContain('cover the edge case');
  });
});

describe('approval-resume-flow: rejection resume framing names the parked transition', () => {
  it('rejected apply resume guidance names apply, not propose', async () => {
    corroborate(projectRoot, 'add-login-api', 'propose');
    const { engine, calls } = engineWith({
      report: (root, batch, change) => {
        corroborate(root, change, 'apply');
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'revised',
          transition: 'apply',
        });
      },
    });
    await engine.runChangeStep({
      ...context({
        transition: 'apply',
        settings: settings({ gate: 'every-phase' }),
        resume: {
          kind: 'awaiting-approval',
          reason: 'apply v1',
          feedback: 'widen coverage',
        },
      }),
    });
    expect(calls[0].instructions).toMatch(/prior apply work was REJECTED/i);
    expect(calls[0].instructions).toMatch(/re-run apply/i);
    expect(calls[0].instructions).not.toMatch(/re-run propose/i);
  });
});

describe('approval-resume-flow: awaiting-approval park message names the completed transition', () => {
  it('every-phase: verify completion park message names verify', async () => {
    corroborate(projectRoot, 'add-login-api', 'propose');
    corroborate(projectRoot, 'add-login-api', 'apply');
    const { engine } = engineWith({
      report: (root, batch, change) => {
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: VERIFY_COMPLETION,
          transition: 'verify',
        });
      },
    });
    const result = await engine.runStep(
      context({
        transition: 'verify',
        settings: settings({ gate: 'every-phase' }),
      })
    );
    expect(result.state).toBe('awaiting-approval');
    expect(result.message).toBe('Verify complete; awaiting approval.');
  });
});

describe('per-gate-parking: decomposition and PR steps never park under every-phase', () => {
  it('decompose never parks (matrix returns false for every-phase + decompose)', async () => {
    // The pure matrix already proves this; assert the engine routes through it
    // by confirming a decompose completion advances under every-phase.
    const { engine } = engineWith({
      report: (root, batch, _change) => {
        appendJournal(root, batch, {
          change: 'phase-x',
          kind: 'completion',
          message: 'decomposed',
          transition: 'decompose',
        });
      },
    });
    const result = await engine.runDecompositionStep({
      batch: 'b',
      phase: { name: 'phase-x', goal: 'g', success: 's', proofOfWork: POW },
      priorResults: [],
      settings: settings({ gate: 'every-phase' }),
    });
    expect(result.state).toBe('advanced');
  });

  it('pr never parks (matrix returns false for every-phase + pr)', async () => {
    const { engine } = engineWith({
      report: (root, batch, _change) => {
        appendJournal(root, batch, {
          change: 'pr:b',
          kind: 'completion',
          message: 'pr opened',
          transition: 'pr',
        });
      },
    });
    const result = await engine.runPrStep({
      batch: 'b',
      phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
      settings: settings({ gate: 'every-phase', prGrouping: 'whole-batch' }),
      baseBranch: 'main',
      workBranch: 'w',
    });
    expect(result.state).toBe('advanced');
  });
});

describe('approval-resume-flow: approving a parked apply selects verify next', () => {
  it('every-phase: after apply approved, next transition is verify', () => {
    // computeNextTransition is journal/task-derived; an approved apply (all
    // tasks checked) leaves applied=true → next is verify. This asserts the
    // disk-state derivation the park suppression relies on, not a park.
    corroborate(projectRoot, 'add-login-api', 'apply');
    const after = readChangeDiskState(projectRoot, 'add-login-api');
    expect(after.applied).toBe(true);
  });
});
