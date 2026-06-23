import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet-ai';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type { AgentAdapter, AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';
import type { FetchLike } from '../../src/core/batch/engine/runtime/rex-remote-runtime.js';

/**
 * Engine wiring for `locus: remote`. NO injected runtime override — the engine's
 * own `selectRuntime` must build the native-Node `RexRemoteRuntime`, so these
 * tests stub the GLOBAL `fetch` (the runtime's default dep) with a tiny fake
 * swerex server. This proves: (a) `remote` routes through REST end-to-end and
 * gets the same rendering/outcome mapping for free; (b) `local`/`docker` do NOT
 * touch fetch (they select the sidecar); (c) missing remote config fails
 * actionably BEFORE any REST call.
 */

let projectRoot: string;
let savedFetch: typeof globalThis.fetch;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-remote-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  savedFetch = globalThis.fetch;
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(async () => {
  globalThis.fetch = savedFetch;
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

const adapter: AgentAdapter = {
  name: 'fake',
  buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
    return { command: 'fake-agent', args: [], instructions, cwd, env };
  },
};

/** Install a fake swerex-remote server as the global fetch; returns the call log. */
function installFakeServer(
  authToken: string,
  logLine: string,
  exitCode: number,
  onLaunch?: () => void
): { paths: string[] } {
  const paths: string[] = [];
  let revealed = false;
  const fakeFetch: FetchLike = async (url, init) => {
    const p = url.replace(/^http:\/\/[^/]+/, '');
    paths.push(p);
    const res = (status: number, json: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    });
    if (init.headers['X-API-Key'] !== authToken) return res(401, { detail: 'Invalid API Key' });
    if (p === '/is_alive') return res(200, { is_alive: true });
    if (p === '/create_session') return res(200, { session_type: 'bash' });
    if (p === '/write_file') return res(200, {});
    if (p === '/execute') {
      const cmd = (JSON.parse(init.body!) as { command: string }).command;
      if (/^nohup /.test(cmd)) {
        onLaunch?.(); // the agent "ran" server-side and reported back
        return res(200, { stdout: '', exit_code: 0 });
      }
      if (/^tail -c /.test(cmd)) {
        const out = revealed ? '' : `${logLine}\n`;
        revealed = true;
        return res(200, { stdout: out, exit_code: 0 });
      }
      if (/exit\.code/.test(cmd)) {
        return res(200, { stdout: revealed ? `${exitCode}\n` : '', exit_code: 0 });
      }
      return res(200, { stdout: '', exit_code: 0 }); // mkdir / nohup / rm
    }
    if (p === '/close_session' || p === '/close') return res(200, {});
    return res(404, { detail: 'nope' });
  };
  globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;
  return { paths };
}

describe('engine — locus: remote selects the RexRemoteRuntime (over REST)', () => {
  it('routes a remote step through REST end-to-end and advances on completion', async () => {
    // The stub agent "runs" server-side: when the runtime launches it, it reports
    // completion DURING the session (so the engine's session-entry slice sees it).
    const server = installFakeServer('tok', 'remote line one', 0, () =>
      appendJournal(projectRoot, 'b', {
        change: 'add-login-api',
        kind: 'completion',
        message: 'proposed remotely',
        transition: 'propose',
      })
    );
    const printed: string[] = [];
    const engine = new RatchetBatchEngine({
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: (line) => printed.push(line),
    });

    const result = await engine.runStep(
      context({
        settings: settings({ locus: 'remote', host: 'localhost', port: 8123, authToken: 'tok' }),
      })
    );

    expect(result.state).toBe('advanced');
    // The REST sequence actually ran (health first, session, write, execute, close).
    expect(server.paths[0]).toBe('/is_alive');
    expect(server.paths).toContain('/create_session');
    expect(server.paths).toContain('/write_file');
    expect(server.paths).toContain('/execute');
    expect(server.paths).toContain('/close');
    // The streamed line was printed live via the same event channel.
    expect(printed).toContain('remote line one');
  });

  it('does NOT touch fetch for locus local (selects the sidecar) — proven by a throwing fetch', async () => {
    // If the engine wrongly selected the remote runtime for local, this fetch
    // would be hit and throw; instead the sidecar path is taken. We force a fast
    // sidecar failure via a bogus agent override and only assert fetch is unused.
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch must not be called for local locus');
    }) as unknown as typeof globalThis.fetch;
    process.env[ENV] = 'echo hi; exit 0';

    const engine = new RatchetBatchEngine({
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: () => {},
    });
    // Local goes through the sidecar; it may pass or fail depending on the venv,
    // but it must NEVER call fetch.
    await engine.runStep(context({ settings: settings({ locus: 'local' }) })).catch(() => {});
    expect(fetchCalled).toBe(false);
  });

  it('fails actionably when remote config is incomplete — BEFORE any REST call', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('no REST call should be attempted');
    }) as unknown as typeof globalThis.fetch;

    const printed: string[] = [];
    const engine = new RatchetBatchEngine({
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: (l) => printed.push(l),
    });

    // locus remote but no host/port/authToken.
    const result = await engine.runStep(
      context({ settings: settings({ locus: 'remote' }) })
    );

    // Non-zero exit without completion → mapped to blocked (failed surfaced).
    expect(result.state).toBe('blocked');
    // The actionable config message is printed live via the error event.
    expect(printed.join('\n')).toMatch(/host|port|authToken/i);
    expect(fetchCalled).toBe(false); // no REST call was attempted
  });

  it('a wrong token surfaces a clear auth error (non-zero result), naming the host not the token', async () => {
    installFakeServer('server-token', 'x', 0);
    const printed: string[] = [];
    const engine = new RatchetBatchEngine({
      adapters: { fake: adapter },
      projectRoot: () => projectRoot,
      printLine: (l) => printed.push(l),
    });

    const result = await engine.runStep(
      context({
        settings: settings({
          locus: 'remote',
          host: 'example.com',
          port: 9000,
          authToken: 'WRONG',
        }),
      })
    );

    expect(result.state).toBe('blocked'); // failed → blocked
    // The auth-failure message (with host:port, never the token) is printed live.
    const surfaced = printed.join('\n');
    expect(surfaced).toContain('example.com:9000');
    expect(surfaced).not.toContain('WRONG');
  });
});
