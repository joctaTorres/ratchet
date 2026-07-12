import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  makeRexRemoteRuntime,
  buildRemoteRunCommand,
  resolveTransport,
  type FetchLike,
  type RemoteDeps,
} from '../../src/core/batch/engine/runtime/rex-remote-runtime.js';
import type { AgentEvent } from '../../src/core/batch/engine/runtime/contract.js';
import type { AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';
import {
  MAX_PARTIAL_BYTES,
  surrogateEscapeByteLength,
} from '../../src/core/batch/engine/runtime/spawn-command.js';

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

/**
 * Job-control launch + group-kill teardown — the reap-agents-on-teardown change.
 *
 * The launch command runs under `set -m` and records the agent's pid to a
 * pidfile (`agent.pid`) so teardown can reap the whole process group (negative
 * pid) BEFORE removing the run dir and closing the session — the prior code
 * closed the session leaving the nohup'd agent alive on the server.
 */
describe('makeRexRemoteRuntime — job-control launch + group-kill teardown', () => {
  function executeCommands(server: { fetch: FetchLike; calls: Recorded[] }): string[] {
    return server.calls
      .filter((c) => c.path === '/execute')
      .map((c) => (c.body as { command: string }).command);
  }

  it('launches under `set -m` and writes the agent pid to a pidfile', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['x\n'], exitCode: 0 });
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    await runtime(req, () => {});
    const cmds = executeCommands(server);
    const launch = cmds.find((c) => /^nohup /.test(c));
    expect(launch).toBeDefined();
    // `set -m` makes the backgrounded pipeline its own process-group leader.
    expect(launch).toContain('set -m');
    // The pid is recorded to a pidfile so teardown finds the group.
    expect(launch).toContain('agent.pid');
    expect(launch).toMatch(/echo \$! >/);
  });

  it('teardown reaps the group (TERM→KILL) BEFORE rm -rf and close', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['x\n'], exitCode: 0 });
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    await runtime(req, () => {});

    const allCalls = server.calls;
    const executeCalls = allCalls.filter((c) => c.path === '/execute');
    const teardownKill = executeCalls.find((c) =>
      /kill -TERM -- -\$\(cat/.test((c.body as { command: string }).command)
    );
    expect(teardownKill).toBeDefined();
    const killCmd = (teardownKill!.body as { command: string }).command;
    // TERM then KILL on the negative pgid, best-effort.
    expect(killCmd).toContain('kill -TERM -- -$(cat');
    expect(killCmd).toContain('kill -KILL -- -$(cat');
    expect(killCmd).toContain('agent.pid');

    // ORDERING: the group-kill /execute appears BEFORE the rm -rf /execute and
    // the /close_session + /close calls (the pidfile lives in runDir and the
    // session must be alive for the kill to run).
    const killIdx = allCalls.indexOf(teardownKill!);
    const rmrf = allCalls.find((c) => {
      if (c.path !== '/execute') return false;
      return /^rm -rf /.test((c.body as { command: string }).command);
    });
    expect(rmrf).toBeDefined();
    const rmrfIdx = allCalls.indexOf(rmrf!);
    const closeSessionIdx = allCalls.findIndex((c) => c.path === '/close_session');
    const closeIdx = allCalls.findIndex((c) => c.path === '/close');
    expect(killIdx).toBeLessThan(rmrfIdx);
    expect(rmrfIdx).toBeLessThan(closeSessionIdx);
    expect(closeSessionIdx).toBeLessThan(closeIdx);
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

/**
 * Encode a JS string to raw bytes the way Python's
 * `str.encode("utf-8", "surrogateescape")` would: a lone surrogate in
 * U+DC80–U+DCFF is the escape for one original non-UTF-8 byte and re-emits that
 * single byte; every other code point emits its standard UTF-8 bytes.
 */
function surrogateEscapeEncode(s: string): Buffer {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xdc80 && cp <= 0xdcff) out.push(cp - 0xdc00);
    else out.push(...Buffer.from(ch, 'utf-8'));
  }
  return Buffer.from(out);
}

/**
 * Decode raw bytes the way Python's `bytes.decode("utf-8", "surrogateescape")`
 * would — the exact decode swe-rex applies before handing the runtime a string:
 * a byte that cannot start/continue a valid UTF-8 sequence surfaces as a lone
 * surrogate U+DC00+byte, otherwise the sequence decodes normally.
 */
function surrogateEscapeDecode(bytes: Buffer): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCodePoint(b);
      i += 1;
      continue;
    }
    let len = 0;
    let cp = 0;
    if (b >= 0xc2 && b <= 0xdf) {
      len = 2;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      len = 3;
      cp = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
      cp = b & 0x07;
    }
    if (len === 0 || i + len > bytes.length) {
      out += String.fromCodePoint(0xdc00 + b);
      i += 1;
      continue;
    }
    let ok = true;
    for (let k = 1; k < len; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      out += String.fromCodePoint(0xdc00 + b);
      i += 1;
      continue;
    }
    for (let k = 1; k < len; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

/**
 * A fake swerex-remote server whose logfile is modeled as RAW BYTES (not a JS
 * string), so `tail -c +N` slices at a true byte offset and the returned chunk
 * is surrogateescape-decoded exactly as the real server does. This exercises the
 * runtime's byte-cursor arithmetic against non-UTF-8 content: if the cursor and
 * the server disagree on how many bytes a decoded chunk spans, output is skipped
 * or duplicated. `tailOffsets` records every 0-based byte offset the runtime read
 * from, so the final cursor can be checked against the surrogateescape byte count.
 */
function fakeByteServer(opts: {
  authToken: string;
  byteChunks: Buffer[];
  exitCode: number;
}): { fetch: FetchLike; tailOffsets: number[] } {
  let pollIndex = 0;
  let fullLog = Buffer.alloc(0);
  const tailOffsets: number[] = [];

  const exec = (command: string): { stdout: string; exit_code: number } => {
    if (
      /^mkdir /.test(command) ||
      /^rm -rf /.test(command) ||
      /^nohup /.test(command) ||
      /kill /.test(command)
    ) {
      return { stdout: '', exit_code: 0 };
    }
    const tail = command.match(/^tail -c \+(\d+) /);
    if (tail) {
      const offset = Number(tail[1]) - 1; // 1-based → 0-based
      tailOffsets.push(offset);
      if (pollIndex < opts.byteChunks.length) {
        fullLog = Buffer.concat([fullLog, opts.byteChunks[pollIndex]]);
        pollIndex++;
      }
      return { stdout: surrogateEscapeDecode(fullLog.subarray(offset)), exit_code: 0 };
    }
    if (/exit\.code/.test(command)) {
      const done = pollIndex >= opts.byteChunks.length;
      return { stdout: done ? `${opts.exitCode}\n` : '', exit_code: 0 };
    }
    return { stdout: '', exit_code: 0 };
  };

  const fetch: FetchLike = async (url, init) => {
    const p = url.replace(/^https?:\/\/[^/]+/, '');
    const apiKey = init.headers['X-API-Key'];
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (apiKey !== opts.authToken) return makeRes(401, { detail: 'Invalid API Key' });
    if (p === '/is_alive') return makeRes(200, { is_alive: true });
    if (p === '/create_session') return makeRes(200, {});
    if (p === '/write_file') return makeRes(200, {});
    if (p === '/execute') return makeRes(200, exec((body as { command: string }).command));
    if (p === '/close_session') return makeRes(200, {});
    if (p === '/close') return makeRes(200, {});
    return makeRes(404, { detail: 'not found' });
  };

  return { fetch, tailOffsets };
}

describe('makeRexRemoteRuntime — surrogateescape byte cursor (issue #90)', () => {
  // Implements features/cursor-alignment/surrogateescape-byte-cursor.feature.
  it('keeps the tail-poll cursor aligned when non-UTF-8 bytes arrive split across polls', async () => {
    // A line whose middle byte 0x80 is NOT valid UTF-8: swe-rex surfaces it as the
    // lone surrogate U+DC80. `é` (U+00E9) is a 2-byte sequence. The full content is
    // 10 surrogateescape bytes; Buffer.byteLength would report 12 (a lone surrogate
    // encodes as the 3-byte replacement char) and skew the cursor by 2 → skipped
    // output. The runtime uses surrogateEscapeByteLength, so it stays aligned.
    const content = 'café\udc80bar\n';
    const expectedBytes = surrogateEscapeByteLength(content); // 3 + 2 + 1 + 3 + 1 = 10
    expect(expectedBytes).toBe(10);
    // Split INSIDE the line, with the boundary right after the lone surrogate.
    const server = fakeByteServer({
      authToken: 'tok',
      byteChunks: [surrogateEscapeEncode('café\udc80'), surrogateEscapeEncode('bar\n')],
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

    // The line is reconstructed intact and emitted exactly once — no skip, no dup.
    const lines = events.filter((e) => e.kind === 'stdout').map((e) => e.line);
    expect(lines).toEqual(['café\udc80bar']);
    expect(result.stdout).toBe('café\udc80bar');
    // The final cursor equals the sidecar's surrogateescape byte count for the content.
    expect(Math.max(...server.tailOffsets)).toBe(expectedBytes);
  });
});

describe('makeRexRemoteRuntime — bounded partial buffer (issue #90)', () => {
  // Implements features/bounded-partials/flush-oversized-partial.feature.
  it('flushes an oversized partial as a truncated stdout event and bounds the buffer', async () => {
    const big = 'x'.repeat(MAX_PARTIAL_BYTES + 100); // > 1 MiB, no newline
    const server = fakeServer({
      authToken: 'tok',
      logChunks: [big, 'y'.repeat(10) + '\n'],
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

    const lines = events.filter((e) => e.kind === 'stdout').map((e) => e.line as string);
    // The oversized partial was flushed (not held forever growing memory).
    expect(lines[0].length).toBe(MAX_PARTIAL_BYTES + 100);
    // The truncation is surfaced in the diagnostic transcript, not silently dropped.
    expect(result.stderr).toContain(
      '[sidecar protocol] partial line exceeded 1 MiB; flushed truncated'
    );
    // Subsequent bytes of the same long line continue as a fresh partial — the cap
    // splits the content, it is never lost.
    expect(lines).toContain('y'.repeat(10));
    expect(result.stdout.startsWith('x'.repeat(MAX_PARTIAL_BYTES + 100))).toBe(true);
    expect(result.stdout.endsWith('y'.repeat(10))).toBe(true);
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

  it('omits exports when the request env is empty (parity with prior output)', () => {
    const cmd = buildRemoteRunCommand('/tmp/run/prompt.txt', {
      command: 'agent',
      args: ['-p'],
      instructions: '',
      cwd: '/',
      env: {},
    });
    expect(cmd.startsWith('cat ')).toBe(true);
    expect(cmd).not.toContain('export ');
  });
});

/**
 * Env threading — the per-step env the engine places on AgentSpawnRequest.env
 * reaches the agent the remote runtime launches, with overlay merge semantics.
 *
 * Implements `features/rex-env-threading/env-reaches-spawned-agent.feature`.
 * The `/execute` nohup body assertion uses the fake server (no spawn); the
 * execution assertions run buildRemoteRunCommand's output through a real `sh -c`
 * with a controlled base env so actual visibility is proven (per the testing
 * standard: an execution test per builder proves the spawned command observes the
 * request value). Temp dirs are isolated via mkdtemp and removed in afterEach.
 */
describe('makeRexRemoteRuntime — env threading (env-reaches-spawned-agent.feature)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'rex-remote-env-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Run buildRemoteRunCommand's output through a real `sh -c` with a controlled
   * base env, returning the spawned command's stdout. Keeps PATH so `sh` and the
   * agent binary resolve; controls only the vars under test.
   */
  function runBuiltCommand(request: AgentSpawnRequest, baseEnv: NodeJS.ProcessEnv): string {
    const promptPath = path.join(tmp, 'prompt.txt');
    writeFileSync(promptPath, request.instructions ?? '');
    const cmd = buildRemoteRunCommand(promptPath, request);
    return execFileSync('sh', ['-c', cmd], {
      env: { PATH: process.env.PATH ?? '', ...baseEnv },
      encoding: 'utf-8',
    });
  }

  it('the /execute nohup body command exports a per-step env var set on the request env', async () => {
    const server = fakeServer({ authToken: 'tok', logChunks: ['x\n'], exitCode: 0 });
    const runtime = makeRexRemoteRuntime({
      host: 'h',
      port: 1,
      authToken: 'tok',
      pollIntervalMs: 0,
      deps: noWaitDeps(server.fetch),
    });
    await runtime({ ...req, env: { RATCHET_STEP_VAR: 'from-engine' } }, () => {});
    const launch = server.calls.find(
      (c) => c.path === '/execute' && /nohup/.test((c.body as { command: string }).command)
    );
    expect(launch).toBeDefined();
    const cmd = (launch!.body as { command: string }).command;
    // The export rides inside the nohup launcher's `( … )` subshell, before `cat`.
    // The outer `shquote(launch)` re-escapes the inner single quotes, so assert on
    // the quote-free tokens that survive the wrap (`export NAME=` and the value);
    // actual visibility is proven by the execution assertions below.
    expect(cmd).toContain('export RATCHET_STEP_VAR=');
    expect(cmd).toContain('from-engine');
    expect(cmd).toContain('cat ');
    expect(cmd).toContain('exit.code'); // the nohup launcher wrapping is unchanged
  });

  it('the spawned agent observes the request env value (execution via sh -c)', () => {
    const out = runBuiltCommand(
      {
        command: 'printenv',
        args: ['RATCHET_STEP_VAR'],
        instructions: '',
        cwd: '/srv/project',
        env: { RATCHET_STEP_VAR: 'from-engine' },
      },
      // A colliding SESSION base value — the request must win (overlay).
      { RATCHET_STEP_VAR: 'from-session' }
    );
    expect(out.trim()).toBe('from-engine');
  });

  it('a base var absent from the request env stays visible (overlay, not replace)', () => {
    const out = runBuiltCommand(
      {
        command: 'printenv',
        args: ['BASE_ONLY'],
        instructions: '',
        cwd: '/srv/project',
        env: { RATCHET_STEP_VAR: 'from-engine' },
      },
      // BASE_ONLY is in the session base but NOT in the request env.
      { BASE_ONLY: 'base-val' }
    );
    expect(out.trim()).toBe('base-val');
  });

  /**
   * Implements: features/agent-cmd-override/shared-spawn-helper.feature
   *
   * Scenario: an override-built request threads env like any other request. An
   * override-shaped request (`bash -c <override>` with a per-step env var) has
   * that var exported in the built launch command — the override path composes
   * with #89's env threading on the remote runtime.
   */
  it('an override-built (bash -c) request exports a per-step env var into the launch command', () => {
    const promptPath = path.join(tmp, 'prompt.txt');
    writeFileSync(promptPath, 'PROMPT BODY');
    const cmd = buildRemoteRunCommand(promptPath, {
      command: 'bash',
      args: ['-c', 'echo stub-agent'],
      instructions: 'PROMPT BODY',
      cwd: '/srv/project',
      env: { RATCHET_STEP_VAR: 'from-engine' },
    });
    expect(cmd).toContain('export RATCHET_STEP_VAR=');
    expect(cmd).toContain('from-engine');
    expect(cmd).toContain("'bash' '-c' 'echo stub-agent'");
    expect(cmd).toContain('cat ');
  });
});
