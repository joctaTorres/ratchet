import { describe, it, expect } from 'vitest';
import {
  makeRexRemoteRuntime,
  buildRemoteRunCommand,
  resolveTransport,
  type FetchLike,
  type RemoteDeps,
} from '../../src/core/batch/engine/runtime/rex-remote-runtime.js';
import type { AgentEvent } from '../../src/core/batch/engine/runtime/contract.js';
import type { AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';

/**
 * Unit tests for the native-Node REST runtime with a MOCKED `fetch` — NO real
 * server. A small fake server models the swerex endpoints over an in-memory
 * filesystem so the full health→create→write→launch→tail→exit→close sequence,
 * incremental emission, transcript accumulation, auth-failure, connection
 * failure, and the swerexception path are all exercised deterministically.
 */

interface Recorded {
  path: string;
  body: unknown;
  apiKey: string | undefined;
}

/**
 * A fake swerex-remote server backed by a tiny in-memory FS. The agent log is
 * pre-seeded as a script of "polls" — each tail-poll reveals the next chunk, so
 * tests control exactly how output streams across the run.
 */
function fakeServer(opts: {
  authToken: string;
  /** Successive chunks the logfile reveals on each tail-poll. */
  logChunks: string[];
  /** The exit code written to the sentinel once the chunks are exhausted. */
  exitCode: number;
}): { fetch: FetchLike; calls: Recorded[]; files: Map<string, string> } {
  const calls: Recorded[] = [];
  const files = new Map<string, string>();
  let pollIndex = 0;
  let fullLog = '';
  let exitWritten = false;

  const exec = (command: string): { stdout: string; exit_code: number } => {
    // mkdir / rm / nohup launch are side-effect no-ops for the model.
    if (/^mkdir /.test(command) || /^rm -rf /.test(command) || /^nohup /.test(command)) {
      return { stdout: '', exit_code: 0 };
    }
    // tail -c +<n> <logpath>: reveal one more chunk per poll, return bytes >= offset.
    const tail = command.match(/^tail -c \+(\d+) /);
    if (tail) {
      const offset = Number(tail[1]) - 1; // 1-based → 0-based
      if (pollIndex < opts.logChunks.length) {
        fullLog += opts.logChunks[pollIndex];
        pollIndex++;
      } else if (!exitWritten) {
        exitWritten = true;
      }
      const slice = Buffer.from(fullLog, 'utf-8').slice(offset).toString('utf-8');
      return { stdout: slice, exit_code: 0 };
    }
    // exit sentinel read: only present after all chunks revealed.
    if (/exit\.code/.test(command)) {
      const done = pollIndex >= opts.logChunks.length;
      return { stdout: done ? `${opts.exitCode}\n` : '', exit_code: 0 };
    }
    return { stdout: '', exit_code: 0 };
  };

  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const apiKey = init.headers['X-API-Key'];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body, apiKey });

    if (apiKey !== opts.authToken) {
      return makeRes(401, { detail: 'Invalid API Key' });
    }
    if (path === '/is_alive') return makeRes(200, { is_alive: true, message: '' });
    if (path === '/create_session') return makeRes(200, { output: '', session_type: 'bash' });
    if (path === '/write_file') {
      files.set((body as { path: string }).path, (body as { content: string }).content);
      return makeRes(200, {});
    }
    if (path === '/execute') {
      return makeRes(200, exec((body as { command: string }).command));
    }
    if (path === '/close_session') return makeRes(200, { session_type: 'bash' });
    if (path === '/close') return makeRes(200, {});
    return makeRes(404, { detail: 'not found' });
  };

  return { fetch, calls, files };
}

function makeRes(status: number, json: unknown): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function noWaitDeps(fetch: FetchLike): RemoteDeps {
  return { fetch, sleep: async () => {}, now: () => 1234 };
}

const req: AgentSpawnRequest = {
  command: 'my-agent',
  args: ['--flag'],
  instructions: 'do the thing',
  cwd: '/srv/project',
  env: {},
};

describe('makeRexRemoteRuntime — full REST sequence', () => {
  it('runs health→create→write→launch→tail→exit→close and accumulates the transcript', async () => {
    const server = fakeServer({
      authToken: 'tok',
      logChunks: ['line-1\n', 'line-2\n', 'line-3\n'],
      exitCode: 0,
    });
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'localhost',
      port: 8123,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });

    const result = await runtime(req, (e) => events.push(e));

    // The sequence touched each endpoint in order.
    const paths = server.calls.map((c) => c.path);
    expect(paths[0]).toBe('/is_alive');
    expect(paths).toContain('/create_session');
    expect(paths).toContain('/write_file');
    expect(paths).toContain('/execute');
    expect(paths).toContain('/close_session');
    expect(paths).toContain('/close');

    // The prompt was written to a SERVER path (under /tmp/ratchet-rex), with the
    // instructions content — never the host path.
    const written = [...server.files.entries()];
    expect(written).toHaveLength(1);
    expect(written[0][0]).toMatch(/^\/tmp\/ratchet-rex\/.*\/prompt\.txt$/);
    expect(written[0][1]).toBe('do the thing');

    // Every line streamed AND accumulated.
    const stdoutLines = events.filter((e) => e.kind === 'stdout').map((e) => e.line);
    expect(stdoutLines).toEqual(['line-1', 'line-2', 'line-3']);
    expect(result.stdout).toBe('line-1\nline-2\nline-3');
    expect(result.exitCode).toBe(0);
    expect(events.some((e) => e.kind === 'exit' && e.exitCode === 0)).toBe(true);
  });

  it('captures a non-zero exit code from the server-side sentinel', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['only-line\n'], exitCode: 7 });
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    expect(result.exitCode).toBe(7);
    expect(events.find((e) => e.kind === 'exit')?.exitCode).toBe(7);
  });

  it('launches the agent as "cat <serverPromptPath> | <argv>" via /execute', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['x\n'], exitCode: 0 });
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    await runtime(req, () => {});
    const launch = server.calls.find(
      (c) => c.path === '/execute' && /nohup/.test((c.body as { command: string }).command)
    );
    expect(launch).toBeDefined();
    const cmd = (launch!.body as { command: string }).command;
    expect(cmd).toContain('cat ');
    expect(cmd).toContain('/tmp/ratchet-rex/');
    // The agent argv is present (shquoted, then re-escaped inside the outer sh -c).
    expect(cmd).toContain('my-agent');
    expect(cmd).toContain('--flag');
    expect(cmd).toContain('exit.code'); // the sentinel write
    expect(cmd).toContain('/srv/project'); // req.cwd threaded as cd
  });

  it('holds a trailing partial line until its newline arrives, then flushes it', async () => {
    // "par" has no newline in the first chunk; its completion arrives later.
    const server = fakeServer({
      authToken: 'tok',
      logChunks: ['par', 'tial\ndone'],
      exitCode: 0,
    });
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    const lines = events.filter((e) => e.kind === 'stdout').map((e) => e.line);
    // "partial" emitted once (not "par" + "tial"); "done" flushed at the end.
    expect(lines).toEqual(['partial', 'done']);
    expect(result.stdout).toBe('partial\ndone');
  });

  it('always sends the token in the X-API-Key header', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['x\n'], exitCode: 0 });
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    await runtime(req, () => {});
    expect(server.calls.every((c) => c.apiKey === 'tok')).toBe(true);
  });
});

describe('makeRexRemoteRuntime — error paths (actionable, no hang, no secret leak)', () => {
  it('maps a 401 to a clear auth error naming host/port, not the token', async () => {
    const server = fakeServer({ authToken: 'right-token', logChunks: ['x\n'], exitCode: 0 });
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'example.com',
      port: 9000,
      authToken: 'WRONG-secret',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('401');
    expect(result.stderr).toContain('example.com:9000');
    expect(result.stderr).toContain('authToken'); // names the key to fix
    expect(result.stderr).not.toContain('WRONG-secret'); // never the value
    expect(events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('maps a fetch reject (unreachable) to an actionable error naming host/port', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'down.local',
      port: 4321,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unreachable');
    expect(result.stderr).toContain('down.local:4321');
    expect(result.stderr).not.toContain('ECONNREFUSED'); // mapped, not raw
  });

  it('maps an AbortController timeout (slow server) to the unreachable error', async () => {
    // A fetch that rejects via the abort signal models a request timeout.
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'slow.local',
      port: 7,
      authToken: 'tok',
      requestTimeoutMs: 5,
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unreachable');
    expect(result.stderr).toContain('slow.local:7');
  });

  it('surfaces a swerexception body readably (message + class_path)', async () => {
    const fetch: FetchLike = async (url, init) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (init.headers['X-API-Key'] !== 'tok') return makeRes(401, { detail: 'Invalid API Key' });
      if (path === '/is_alive') return makeRes(200, { is_alive: true });
      // create_session blows up server-side.
      return makeRes(511, {
        swerexception: {
          message: 'session boom',
          class_path: 'swerex.exceptions.SessionError',
          traceback: 'Traceback (most recent call last): ...secret-internal...',
        },
      });
    };
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('session boom');
    expect(result.stderr).toContain('SessionError');
    expect(result.stderr).not.toContain('Traceback'); // the raw traceback is not surfaced
    expect(events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('attempts best-effort teardown (close) even on the happy path', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['x\n'], exitCode: 0 });
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    await runtime(req, () => {});
    expect(server.calls.some((c) => c.path === '/close_session')).toBe(true);
    expect(server.calls.some((c) => c.path === '/close')).toBe(true);
  });
});

describe('resolveTransport — scheme selection + plaintext guard', () => {
  it('defaults a loopback host to http (token never leaves the machine)', () => {
    expect(resolveTransport('localhost')).toEqual({ scheme: 'http', host: 'localhost' });
    expect(resolveTransport('127.0.0.1')).toEqual({ scheme: 'http', host: '127.0.0.1' });
    expect(resolveTransport('127.5.5.5')).toEqual({ scheme: 'http', host: '127.5.5.5' });
    expect(resolveTransport('::1')).toEqual({ scheme: 'http', host: '::1' });
    expect(resolveTransport('[::1]')).toEqual({ scheme: 'http', host: '[::1]' });
  });

  it('defaults a non-local host to https (secure by default)', () => {
    expect(resolveTransport('example.com')).toEqual({ scheme: 'https', host: 'example.com' });
    expect(resolveTransport('10.0.0.5')).toEqual({ scheme: 'https', host: '10.0.0.5' });
  });

  it('honours an explicit scheme on the host', () => {
    expect(resolveTransport('https://example.com')).toEqual({
      scheme: 'https',
      host: 'example.com',
    });
    expect(resolveTransport('http://localhost')).toEqual({ scheme: 'http', host: 'localhost' });
  });

  it('allows explicit http to a loopback host', () => {
    expect(resolveTransport('http://127.0.0.1')).toEqual({ scheme: 'http', host: '127.0.0.1' });
  });

  it('REJECTS explicit plaintext http to a non-local host without the opt-in', () => {
    expect(() => resolveTransport('http://example.com')).toThrow(/plaintext/);
    expect(() => resolveTransport('http://example.com')).toThrow(/cleartext/);
  });

  it('allows plaintext http to a non-local host only with allowInsecure', () => {
    expect(resolveTransport('http://example.com', true)).toEqual({
      scheme: 'http',
      host: 'example.com',
    });
  });
});

describe('makeRexRemoteRuntime — transport on the wire', () => {
  /** A fetch that records the full URL of every call (and serves the happy path). */
  function recordingServer(authToken: string): { fetch: FetchLike; urls: string[] } {
    const urls: string[] = [];
    const inner = fakeServer({ authToken, logChunks: ['x\n'], exitCode: 0 });
    const fetch: FetchLike = (url, init) => {
      urls.push(url);
      return inner.fetch(url, init);
    };
    return { fetch, urls };
  }

  it('uses http on the wire for a localhost host', async () => {
    const { fetch, urls } = recordingServer('tok');
    const runtime = makeRexRemoteRuntime({
      host: 'localhost',
      port: 8123,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    await runtime(req, () => {});
    expect(urls.every((u) => u.startsWith('http://localhost:8123'))).toBe(true);
  });

  it('uses https on the wire for a non-local host (default)', async () => {
    const { fetch, urls } = recordingServer('tok');
    const runtime = makeRexRemoteRuntime({
      host: 'agent.example.com',
      port: 443,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    await runtime(req, () => {});
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('https://agent.example.com:443'))).toBe(true);
  });

  it('refuses plaintext to a non-local host: fails BEFORE any fetch, token never sent', async () => {
    const { fetch, urls } = recordingServer('tok');
    const events: AgentEvent[] = [];
    const runtime = makeRexRemoteRuntime({
      host: 'http://agent.example.com',
      port: 80,
      authToken: 'super-secret',
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    const result = await runtime(req, (e) => events.push(e));
    expect(result.exitCode).toBe(1);
    // Not a single network call was made — the token never left the process.
    expect(urls).toHaveLength(0);
    expect(result.stderr).toMatch(/plaintext|cleartext/);
    expect(result.stderr).not.toContain('super-secret');
    expect(events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('allows plaintext to a non-local host with allowInsecure (opt-in)', async () => {
    const { fetch, urls } = recordingServer('tok');
    const runtime = makeRexRemoteRuntime({
      host: 'http://agent.example.com',
      port: 80,
      authToken: 'tok',
      allowInsecure: true,
      pollIntervalMs: 0,
      deps: noWaitDeps(fetch),
    });
    const result = await runtime(req, () => {});
    expect(result.exitCode).toBe(0);
    expect(urls.every((u) => u.startsWith('http://agent.example.com:80'))).toBe(true);
  });
});

describe('buildRemoteRunCommand', () => {
  it('shquotes the prompt path and argv', () => {
    const cmd = buildRemoteRunCommand('/tmp/run/prompt.txt', {
      command: 'agent',
      args: ['-p', "it's"],
      instructions: '',
      cwd: '/',
      env: {},
    });
    expect(cmd).toBe("cat '/tmp/run/prompt.txt' | 'agent' '-p' 'it'\\''s'");
  });
});
