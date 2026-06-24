import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet-ai';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type { AgentAdapter, Spawner, AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-run-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', agent: 'fake', ...over };
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

/**
 * A fake adapter + spawner. The spawner simulates the agent reporting through
 * the journal by appending entries, then exiting with the configured code. It
 * also records each invocation so tests can assert "fresh agent per step".
 */
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
    spawner,
    adapters: { fake: adapter },
    projectRoot: () => projectRoot,
  });
  return { engine, calls };
}

describe('RatchetBatchEngine.runStep', () => {
  it('advances when the agent reports completion', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });
    const result = await engine.runStep(context());
    expect(result.state).toBe('advanced');
    expect(result.change).toBe('add-login-api');
    expect(result.transition).toBe('propose');
  });

  it('parks as blocked when the agent raises a blocker (voluntary gate)', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'blocker', message: 'which auth provider?' }),
    });
    const result = await engine.runStep(context());
    expect(result.state).toBe('blocked');
    expect(result.blocker).toContain('auth provider');
  });

  it('treats a non-zero exit without completion as a failed (blocked) step, keeping state consistent', async () => {
    const { engine } = engineWith({ exitCode: 1 });
    const result = await engine.runStep(context());
    expect(result.state).toBe('blocked'); // failed surfaced as blocked
    expect(result.blocker).toMatch(/exited|completion/i);
  });

  it('parks for approval after propose under an after-propose gate', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'draft ready', transition: 'propose' }),
    });
    const result = await engine.runStep(context({ settings: settings({ gate: 'after-propose' }) }));
    expect(result.state).toBe('awaiting-approval');
    expect(result.approvalRequest).toContain('draft');
  });

  it('does not advance an unresolved blocked park (no answer yet)', async () => {
    const { engine, calls } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'x', transition: 'propose' }),
    });
    const result = await engine.runStep(
      context({ resume: { kind: 'blocked', reason: 'which provider?' } })
    );
    expect(result.state).toBe('blocked');
    expect(calls.length).toBe(0); // never spawned the agent
  });

  it('resumes a blocked step once an answer is recorded, re-spawning the agent with answer in context', async () => {
    const { engine, calls } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'done', transition: 'propose' }),
    });
    const result = await engine.runStep(
      context({ resume: { kind: 'blocked', reason: 'which provider?', answer: 'use OAuth' } })
    );
    expect(result.state).toBe('advanced');
    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('use OAuth');
  });

  it('re-runs propose with feedback in context on reject-with-feedback (no rollback)', async () => {
    // Existing draft on disk so the change "exists" but has no plan -> propose.
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes', 'add-login-api'), { recursive: true });
    const { engine, calls } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'revised', transition: 'propose' }),
    });
    const result = await engine.runStep(
      context({
        resume: { kind: 'awaiting-approval', reason: 'draft v1', feedback: 'scope it smaller' },
      })
    );
    expect(result.transition).toBe('propose'); // re-runs propose, not apply
    expect(calls[0].instructions).toContain('scope it smaller');
  });

  it('autonomous gate advances through propose without an approval pause', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'done', transition: 'propose' }),
    });
    const result = await engine.runStep(context({ settings: settings({ gate: 'autonomous' }) }));
    expect(result.state).toBe('advanced');
  });

  it('rejects an unknown agent adapter before spawning, listing available ones', async () => {
    const { engine } = engineWith({});
    const result = await engine.runStep(context({ settings: settings({ agent: 'no-such-agent' }) }));
    expect(result.state).toBe('blocked');
    expect(result.blocker).toContain('no-such-agent');
    expect(result.blocker).toContain('fake'); // available adapters listed
  });

  it('stamps .ratchet.yaml for a propose-created change so it stays discoverable (issue #19)', async () => {
    const changeDir = path.join(projectRoot, '.ratchet', 'changes', 'add-login-api');
    // Simulate the PROPOSE agent writing artifacts directly on disk WITHOUT a
    // `.ratchet.yaml` (the bug): a change dir with features/ + plan.md only.
    const { engine } = engineWith({
      report: (root, batch, change) => {
        fsSync.mkdirSync(path.join(changeDir, 'features'), { recursive: true });
        fsSync.writeFileSync(path.join(changeDir, 'plan.md'), '## Tasks\n- [ ] do it\n');
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' });
      },
    });

    const result = await engine.runStep(context());
    expect(result.state).toBe('advanced');
    // The engine must have stamped the metadata file the agent omitted, so the
    // change is discoverable by validate/list/archive (not just batch status).
    await expect(fs.access(path.join(changeDir, '.ratchet.yaml'))).resolves.toBeUndefined();
  });

  it('does not overwrite an existing .ratchet.yaml on propose', async () => {
    const changeDir = path.join(projectRoot, '.ratchet', 'changes', 'add-login-api');
    await fs.mkdir(changeDir, { recursive: true });
    const original = 'schema: ratchet\ncreated: 2020-01-01\n';
    await fs.writeFile(path.join(changeDir, '.ratchet.yaml'), original);
    const { engine } = engineWith({
      report: (root, batch, change) => {
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' });
      },
    });
    await engine.runStep(context());
    const after = await fs.readFile(path.join(changeDir, '.ratchet.yaml'), 'utf-8');
    expect(after).toBe(original); // left untouched (idempotent)
  });

  it('spawns a fresh agent per step (no carried context except the journal)', async () => {
    const { engine, calls } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'ok', transition: 'propose' }),
    });
    await engine.runStep(context());
    await engine.runStep(context());
    expect(calls.length).toBe(2); // two distinct spawn requests
  });
});
