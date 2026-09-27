import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet-ai';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import { readJournal } from '../../src/core/batch/journal.js';
import { resolvePermissionFlags } from '../../src/core/batch/runtime/agent-permissions.js';
import type { ResolvedPermissionsPolicy } from '../../src/core/batch/permissions-policy.js';
import type { AgentAdapter, Spawner, AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';

/**
 * The `RATCHET_BATCH_AGENT_CMD` override seam: when set AND the operator opted in
 * (`allowAgentOverride`, the `--allow-agent-override` flag), the engine runs the
 * command via `bash -c` (instructions on stdin) in place of the configured
 * adapter; without the opt-in the step is refused and nothing is spawned. Unset
 * → behavior is identical to today. The `Spawner` captures the built request.
 *
 * Implements:
 *   - features/agent-cmd-override/opt-in-gate.feature
 *   - features/agent-cmd-override/override-notice.feature
 *   - features/agent-cmd-override/override-provenance.feature (engine entry)
 *   - features/agent-cmd-override/override-permissions.feature
 */

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-override-'));
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
 * A fake adapter + capturing spawner. The adapter records when `buildRequest` is
 * called so a test can assert the adapter was (or was NOT) consulted; the spawner
 * captures every spawn request and can simulate a journal report + exit code.
 */
interface FakeAgent {
  adapter: AgentAdapter;
  spawner: Spawner;
  calls: AgentSpawnRequest[];
  /** Mutable counter of how many times `buildRequest` was called. */
  state: { adapterCalls: number };
}

function fakeAgent(behavior: {
  report?: (root: string, batch: string, change: string) => void;
  exitCode?: number;
}): FakeAgent {
  const calls: AgentSpawnRequest[] = [];
  const state = { adapterCalls: 0 };
  const adapter: AgentAdapter = {
    name: 'fake',
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      state.adapterCalls += 1;
      return { command: 'fake-agent', args: [], instructions, cwd, env };
    },
  };
  const spawner: Spawner = async (request) => {
    calls.push(request);
    behavior.report?.(projectRoot, 'b', 'add-login-api');
    return { exitCode: behavior.exitCode ?? 0, signal: null, stdout: '', stderr: '' };
  };
  return { adapter, spawner, calls, state };
}

function engineWith(
  behavior: Parameters<typeof fakeAgent>[0],
  opts: { allowAgentOverride?: boolean } = { allowAgentOverride: true }
) {
  const fake = fakeAgent(behavior);
  const notices: string[] = [];
  const engine = new RatchetBatchEngine({
    spawner: fake.spawner,
    adapters: { fake: fake.adapter },
    projectRoot: () => projectRoot,
    allowAgentOverride: opts.allowAgentOverride,
    notify: (line) => notices.push(line),
  });
  return { engine, fake, notices };
}

const reportComplete = (root: string, batch: string, change: string) =>
  appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' });

describe('RatchetBatchEngine.runStep — RATCHET_BATCH_AGENT_CMD override', () => {
  it('runs the override via `bash -c` with instructions on stdin, skipping the adapter', async () => {
    process.env[ENV] = 'echo stub-agent';
    const { engine, fake } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.state.adapterCalls).toBe(0); // adapter was NOT resolved/used
    expect(fake.calls.length).toBe(1);
    const req = fake.calls[0];
    expect(req.command).toBe('bash');
    // $0 names the resolved agent; no permission policy → no forwarded flags.
    expect(req.args).toEqual(['-c', 'export RATCHET_SPAWN_VIA=env-override; echo stub-agent', 'fake']);
    expect(req.cwd).toBe(projectRoot);
    expect(req.instructions.length).toBeGreaterThan(0); // step instructions on stdin
  });

  it('treats a blank/whitespace override as unset (configured adapter is used)', async () => {
    process.env[ENV] = '   ';
    const { engine, fake } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.state.adapterCalls).toBe(1); // adapter resolved as before
    expect(fake.calls[0].command).toBe('fake-agent');
  });

  it('uses the configured adapter when the override is unset', async () => {
    const { engine, fake } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.state.adapterCalls).toBe(1);
    expect(fake.calls[0].command).toBe('fake-agent');
  });

  it('a non-zero override exit is a failed step that leaves run-state consistent for retry', async () => {
    process.env[ENV] = 'exit 1';
    const { engine, fake } = engineWith({ exitCode: 1 }); // no journal report + non-zero exit

    const result = await engine.runStep(context());

    expect(result.state).toBe('blocked'); // failed surfaces as a resumable blocked step
    expect(result.blocker).toMatch(/exited|completion/i);
    expect(fake.calls[0].command).toBe('bash');

    // The batch run-state stays consistent: a later retry can run again.
    const retry = await engine.runStep(context());
    expect(retry.state).toBe('blocked');
    expect(fake.calls.length).toBe(2);
  });

  it('refuses an override without the opt-in: nothing spawned, resumable failed step', async () => {
    process.env[ENV] = 'echo stub-agent';
    const { engine, fake, notices } = engineWith({ report: reportComplete }, { allowAgentOverride: false });

    const result = await engine.runStep(context());

    expect(result.state).toBe('blocked');
    expect(result.blocker).toMatch(/RATCHET_BATCH_AGENT_CMD.*--allow-agent-override/);
    expect(result.agentOverride).toBeUndefined();
    expect(fake.calls).toHaveLength(0); // neither the stub nor the configured agent ran
    expect(fake.state.adapterCalls).toBe(0);
    expect(notices).toEqual([]); // the refusal is reported, not the notice

    // Resumable: once the operator opts in, the same step runs.
    const allowed = engineWith({ report: reportComplete });
    const retry = await allowed.engine.runStep(context());
    expect(retry.state).toBe('advanced');
  });

  it('the opt-in alone changes nothing when no override is set', async () => {
    const { engine, fake, notices } = engineWith({ report: reportComplete });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.calls[0].command).toBe('fake-agent');
    expect(result.agentOverride).toBeUndefined();
    expect(notices).toEqual([]);
    expect(readJournal(projectRoot, 'b').every((e) => e.via === undefined)).toBe(true);
  });

  it('flags the result, emits the notice once, and stamps the outcome journal entry', async () => {
    process.env[ENV] = 'echo stub-agent';
    const { engine, fake, notices } = engineWith({ report: reportComplete });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(result.agentOverride).toBe(true);
    expect(notices).toEqual(['⚠ agent overridden by RATCHET_BATCH_AGENT_CMD']);
    expect(fake.calls[0].args[1]).toMatch(/^export RATCHET_SPAWN_VIA=env-override; /);
    const journal = readJournal(projectRoot, 'b');
    const outcomeEntry = journal[journal.length - 1];
    expect(outcomeEntry.via).toBe('env-override');
    // The fake stub appended its report in-process (no inherited env), so only
    // the engine's own entry is stamped here; report stamping is covered in
    // test/commands/batch/report.test.ts.
    expect(journal[0].via).toBeUndefined();
  });

  it('forwards the resolved permission flags to the override as $@', async () => {
    process.env[ENV] = 'echo stub-agent';
    const policy: ResolvedPermissionsPolicy = {
      posture: 'repo-sandboxed-permissive',
      allow: [],
      deny: [],
      raw: {},
    };
    const { engine, fake } = engineWith({ report: reportComplete });

    await engine.runStep(context({ settings: settings({ agent: 'claude', permissions: policy }) }));

    expect(fake.calls[0].args).toEqual([
      '-c',
      'export RATCHET_SPAWN_VIA=env-override; echo stub-agent',
      'claude',
      ...resolvePermissionFlags('claude', policy, projectRoot),
    ]);
  });

  it('refuses when the permission policy cannot be translated for the resolved agent', async () => {
    process.env[ENV] = 'echo stub-agent';
    const policy: ResolvedPermissionsPolicy = {
      posture: 'repo-sandboxed-permissive',
      allow: [],
      deny: [],
      raw: {},
    };
    const { engine, fake } = engineWith({ report: reportComplete });

    const result = await engine.runStep(context({ settings: settings({ permissions: policy }) }));

    expect(result.state).toBe('blocked');
    expect(result.blocker).toMatch(/cannot be translated for agent 'fake'/);
    expect(fake.calls).toHaveLength(0);
  });
});
