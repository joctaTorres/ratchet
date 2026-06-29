import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type { BatchSettings, ProofOfWork } from 'ratchet-ai';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type { ChangeStepContext } from '../../src/core/batch/engine/contract.js';
import type { AgentRuntime } from '../../src/core/batch/engine/runtime/contract.js';
import type { SkillLocusDeps } from '../../src/core/batch/engine/skill-locus.js';

/**
 * Engine integration for the skill-in-spawn-locus guarantee. The guarantee runs
 * inside `runChangeStep` BEFORE the spawn request is built and the runtime is
 * invoked, against the FORCED transition `ctx.transition` (so these tests drive
 * the change-scoped core directly rather than `runStep`, which re-derives the
 * transition from disk). They inject a recording runtime to prove: (a) when the
 * guarantee fails (remote locus / failed render) the runtime is NEVER invoked and
 * the step blocks with the actionable message; (b) when it succeeds the rct
 * command file is present in the spawn cwd BEFORE the runtime runs.
 */

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-skill-locus-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

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

function context(over: Partial<ChangeStepContext> = {}): ChangeStepContext {
  return {
    batch: 'b',
    change: 'add-login-api',
    changeDone: 'login works',
    transition: 'apply',
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

/**
 * A recording runtime: captures whether (and with what cwd) it was invoked, and
 * snapshots whether the claude rct command file existed in the spawn cwd at the
 * moment of invocation. Reports a completion so a reached spawn maps to advanced.
 */
function recordingRuntime(): {
  runtime: AgentRuntime;
  calls: number;
  sawCommandFile: boolean | null;
} {
  const state = { calls: 0, sawCommandFile: null as boolean | null };
  const runtime: AgentRuntime = async (req, onEvent) => {
    state.calls += 1;
    state.sawCommandFile = existsSync(
      path.join(req.cwd, '.claude', 'commands', 'rct', 'apply.md')
    );
    appendJournal(projectRoot, 'b', {
      change: 'add-login-api',
      kind: 'completion',
      message: 'applied',
      transition: 'apply',
    });
    onEvent({ kind: 'exit', exitCode: 0 });
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
  return {
    runtime,
    get calls() {
      return state.calls;
    },
    get sawCommandFile() {
      return state.sawCommandFile;
    },
  };
}

describe('engine — skill-in-spawn-locus guarantee renders the command before the spawn', () => {
  it('renders the rct command into the spawn cwd BEFORE the runtime runs', async () => {
    const rec = recordingRuntime();
    const engine = new RatchetBatchEngine({
      runtime: rec.runtime,
      projectRoot: () => projectRoot,
      printLine: () => {},
    });

    const result = await engine.runChangeStep(context());

    // The runtime ran, and the command file already existed in its cwd.
    expect(rec.calls).toBe(1);
    expect(rec.sawCommandFile).toBe(true);
    // And the file is on disk at the claude adapter path under the project root.
    expect(
      existsSync(path.join(projectRoot, '.claude', 'commands', 'rct', 'apply.md'))
    ).toBe(true);
    expect(result.state).toBe('advanced');
  });
});

describe('engine — a locus the engine cannot render into blocks before any spawn', () => {
  it('does NOT invoke the runtime and blocks with the actionable message (remote)', async () => {
    const rec = recordingRuntime();
    const printed: string[] = [];
    const engine = new RatchetBatchEngine({
      runtime: rec.runtime,
      projectRoot: () => projectRoot,
      printLine: (l) => printed.push(l),
    });

    const result = await engine.runChangeStep(
      context({
        settings: settings({ locus: 'remote', host: 'h', port: 1, authToken: 't' }),
      })
    );

    expect(rec.calls).toBe(0); // runtime NEVER invoked
    expect(result.state).toBe('blocked'); // failed → blocked, resumable
    const surfaced = (result.message ?? '') + '\n' + printed.join('\n');
    expect(surfaced).toContain('/rct:apply'); // names the missing command
    expect(surfaced).toContain('remote'); // names the locus
    expect(surfaced).not.toMatch(/invoke `?\/rct:apply/); // never tells agent to run it
  });
});

describe('engine — a render failure blocks before any spawn', () => {
  it('does NOT invoke the runtime and reports the bootstrap error through the outcome channel', async () => {
    const rec = recordingRuntime();
    const failingDeps: SkillLocusDeps = {
      exists: () => false,
      writeText: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const printed: string[] = [];
    const engine = new RatchetBatchEngine({
      runtime: rec.runtime,
      projectRoot: () => projectRoot,
      printLine: (l) => printed.push(l),
      skillLocusDeps: failingDeps,
    });

    const result = await engine.runChangeStep(context());

    expect(rec.calls).toBe(0); // no spawn
    expect(result.state).toBe('blocked');
    expect((result.message ?? '') + printed.join('\n')).toContain('/rct:apply');
  });
});
