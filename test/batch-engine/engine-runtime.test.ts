import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type { AgentAdapter, AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';
import type { AgentEvent, AgentRuntime } from '../../src/core/batch/engine/runtime/contract.js';

/**
 * Engine routing through the streaming `AgentRuntime` seam. A FAKE runtime is
 * injected (no Python): it streams canned stdout lines via `onEvent` and returns
 * an accumulated `AgentSpawnResult`. The tests assert lines are PRINTED live, the
 * `RATCHET_BATCH_AGENT_CMD` override flows THROUGH the runtime, and the
 * accumulated result reaches `mapSessionToOutcome` (advanced/blocked) unchanged.
 */

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-runtime-'));
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

const adapter: AgentAdapter = {
  name: 'fake',
  buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
    return { command: 'fake-agent', args: [], instructions, cwd, env };
  },
};

/** A stream-json-capable fake adapter (emitsStreamJson true) → rich rendering. */
const sjAdapter: AgentAdapter = {
  name: 'sj',
  emitsStreamJson: true,
  buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
    return { command: 'sj-agent', args: [], instructions, cwd, env };
  },
};

/** A fake streaming runtime that emits canned lines and reports an exit code. */
function fakeRuntime(behavior: {
  lines?: string[];
  exitCode?: number;
  report?: (root: string, batch: string, change: string) => void;
}): { runtime: AgentRuntime; calls: AgentSpawnRequest[] } {
  const calls: AgentSpawnRequest[] = [];
  const runtime: AgentRuntime = async (req, onEvent) => {
    calls.push(req);
    behavior.report?.(projectRoot, 'b', 'add-login-api');
    const lines = behavior.lines ?? [];
    for (const line of lines) onEvent({ kind: 'stdout', line });
    const exitCode = behavior.exitCode ?? 0;
    onEvent({ kind: 'exit', exitCode });
    return { exitCode, signal: null, stdout: lines.join('\n'), stderr: '' };
  };
  return { runtime, calls };
}

describe('RatchetBatchEngine — routing through the AgentRuntime seam', () => {
  it('prints each stdout line live and advances on a completion report', async () => {
    const printed: string[] = [];
    const { runtime, calls } = fakeRuntime({
      lines: ['line one', 'line two', 'line three'],
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: (line) => printed.push(line),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(printed).toEqual(['line one', 'line two', 'line three']); // streamed live
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('fake-agent'); // adapter built the request
  });

  it('routes RATCHET_BATCH_AGENT_CMD through the runtime (not a bare spawn)', async () => {
    process.env[ENV] = 'echo stub-agent';
    const printed: string[] = [];
    const { runtime, calls } = fakeRuntime({
      lines: ['stub output'],
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'done', transition: 'propose' }),
    });
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: (line) => printed.push(line),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    // The override command flowed THROUGH the runtime.
    expect(calls[0].command).toBe('bash');
    expect(calls[0].args).toEqual(['-c', 'echo stub-agent']);
    expect(printed).toEqual(['stub output']);
  });

  it('treats a blank override as unset (configured adapter builds the request) but still streams', async () => {
    process.env[ENV] = '   ';
    const { runtime, calls } = fakeRuntime({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'done', transition: 'propose' }),
    });
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(calls[0].command).toBe('fake-agent'); // adapter, not bash
  });

  it('maps the accumulated result to mapSessionToOutcome unchanged (non-zero exit → blocked)', async () => {
    const { runtime } = fakeRuntime({ lines: ['oops'], exitCode: 1 }); // no completion report
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
    });

    const result = await engine.runStep(context());
    expect(result.state).toBe('blocked'); // failed surfaced as blocked
    expect(result.blocker).toMatch(/exited|completion/i);
  });

  it('uses the injected runtime exclusively — no Python/sidecar is started', async () => {
    let started = false;
    const runtime: AgentRuntime = async (_req, onEvent) => {
      started = true;
      onEvent({ kind: 'exit', exitCode: 0 });
      appendJournal(projectRoot, 'b', { change: 'add-login-api', kind: 'completion', message: 'ok', transition: 'propose' });
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    };
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
    });

    const result = await engine.runStep(context());
    expect(started).toBe(true);
    expect(result.state).toBe('advanced');
  });
});

describe('RatchetBatchEngine — stream-json capability routing', () => {
  const NDJSON = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there.' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] } }),
    'this is not json {', // malformed → must degrade to raw, never crash
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 2 } }),
  ];

  it('routes a capable adapter through the renderer (formatted, not raw NDJSON)', async () => {
    const printed: string[] = [];
    const { runtime } = fakeRuntime({
      lines: NDJSON,
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { sj: sjAdapter },
      projectRoot: () => projectRoot,
      printLine: (line) => printed.push(line),
    });

    const result = await engine.runStep(context({ settings: settings({ agent: 'sj' }) }));
    expect(result.state).toBe('advanced');

    const out = printed.join('\n');
    // Rendered, not raw: prose, a tool-call line, and a summary appear; the raw
    // NDJSON object lines do NOT (no `"type":"assistant"` braces).
    expect(out).toContain('Hello there.');
    expect(out).toContain('Bash');
    expect(out).toContain('pnpm test');
    expect(out.toLowerCase()).toContain('success');
    expect(printed.some((l) => l.includes('"type":"assistant"'))).toBe(false);
    // The malformed line degraded to raw, not a crash.
    expect(printed).toContain('this is not json {');
  });

  it('keeps a non-capable adapter on raw line printing (renderer not invoked)', async () => {
    const printed: string[] = [];
    const { runtime } = fakeRuntime({
      lines: NDJSON,
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });
    const engine = new RatchetBatchEngine({
      runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: (line) => printed.push(line),
    });

    const result = await engine.runStep(context());
    expect(result.state).toBe('advanced');
    // Raw: each NDJSON line is printed verbatim, unrendered.
    expect(printed).toEqual(NDJSON);
  });

  it('renders display-only: the accumulated transcript is byte-identical with and without rendering', async () => {
    const report = (root: string, batch: string, change: string) =>
      appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' });

    // A runtime that captures the EXACT `AgentSpawnResult.stdout` it returns to
    // the engine (the value that flows into mapSessionToOutcome), so we can prove
    // rendering never mutates it.
    const makeCapturing = () => {
      let returnedStdout: string | undefined;
      const runtime: AgentRuntime = async (req, onEvent) => {
        report(projectRoot, 'b', 'add-login-api');
        for (const line of NDJSON) onEvent({ kind: 'stdout', line });
        onEvent({ kind: 'exit', exitCode: 0 });
        returnedStdout = NDJSON.join('\n');
        return { exitCode: 0, signal: null, stdout: returnedStdout, stderr: '' };
      };
      return { runtime, get: () => returnedStdout };
    };

    const rendered = makeCapturing();
    await new RatchetBatchEngine({
      runtime: rendered.runtime,
      adapters: { sj: sjAdapter },
      projectRoot: () => projectRoot,
      printLine: () => {},
    }).runStep(context({ settings: settings({ agent: 'sj' }) }));

    const raw = makeCapturing();
    await new RatchetBatchEngine({
      runtime: raw.runtime,
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: () => {},
    }).runStep(context());

    // The transcript the runtime hands the engine is the raw, unrendered NDJSON
    // in BOTH cases — byte-identical regardless of rich rendering.
    expect(rendered.get()).toBe(NDJSON.join('\n'));
    expect(rendered.get()).toBe(raw.get());
  });
});

describe('AgentRuntime contract shape', () => {
  it('a fake runtime streams stdout events and returns an accumulated AgentSpawnResult', async () => {
    const events: AgentEvent[] = [];
    const runtime: AgentRuntime = async (_req, onEvent) => {
      for (const line of ['a', 'b', 'c']) onEvent({ kind: 'stdout', line });
      onEvent({ kind: 'exit', exitCode: 0 });
      return { exitCode: 0, signal: null, stdout: 'a\nb\nc', stderr: '' };
    };

    const result = await runtime(
      { command: 'x', args: [], instructions: 'i', cwd: '/', env: {} },
      (e) => events.push(e)
    );

    expect(events.filter((e) => e.kind === 'stdout').map((e) => e.line)).toEqual(['a', 'b', 'c']);
    expect(events.find((e) => e.kind === 'exit')?.exitCode).toBe(0);
    expect(result.stdout).toBe('a\nb\nc');
    expect(result.exitCode).toBe(0);
  });
});
