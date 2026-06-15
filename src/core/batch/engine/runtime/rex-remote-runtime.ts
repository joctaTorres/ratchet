/**
 * `RexRemoteRuntime` — the REMOTE `AgentRuntime`: drive an agent through a
 * `swerex-remote` server over its REST API from a NATIVE-NODE `fetch` client.
 *
 * Unlike `RexSidecarRuntime` there is NO local Python sidecar on this path — the
 * Python lives on the server. The runtime is pure `fetch`, so it needs no local
 * venv; it implements the SAME `AgentRuntime` interface and emits the SAME
 * `AgentEvent`s, so the engine's stream-json rendering and `mapSessionToOutcome`
 * work UNCHANGED.
 *
 * swe-rex is request/response — there is NO streaming endpoint — so the runtime
 * reproduces the sidecar's launch-to-logfile + tail-poll trick over REST:
 *
 *   GET  /is_alive       -> health check FIRST (short timeout, fail fast)
 *   POST /create_session -> create the bash session the agent runs in
 *   POST /write_file     -> write the prompt onto the SERVER filesystem
 *   POST /execute        -> non-blocking launch:
 *       sh -c '( cat <prompt> | <argv> ) >log 2>&1; echo $? >exit.code' &
 *   POST /execute (loop) -> tail-poll `tail -c +<offset+1> log`, advancing a byte
 *       offset; split complete lines, emit AgentEvent{kind:'stdout'} AND
 *       accumulate into stdout. A trailing partial line is held until its newline.
 *   POST /execute        -> read the exit-code sentinel; once present, drain the
 *       final tail, emit AgentEvent{kind:'exit'}, then close.
 *   POST /close_session + POST /close -> teardown.
 *
 * Transport: the `authToken` rides as the `X-API-Key` header, so the wire scheme
 * matters. `host` may carry an explicit `http://`/`https://`; a bare host gets
 * `http` for loopback (safe) and `https` for anything that leaves the machine.
 * Plaintext `http://` to a NON-LOCAL host is REFUSED (the token would cross the
 * network in the clear) unless `allowInsecure` is set — see `resolveTransport`.
 *
 * Auth failure (401), an unreachable server, or a `swerexception` body map to the
 * existing error-result path (mirroring `RexBootstrapError` in the sidecar
 * runtime): a non-zero `exitCode` with a clear message in `stderr` plus an
 * `AgentEvent{kind:'error'}`, so the engine maps it to blocked/failed with NO new
 * outcome states and NEVER a hang or a raw traceback. The secret `authToken` is
 * never printed in any error message (errors name host/port only).
 *
 * `fetch` and a `sleep` clock are injectable seams so unit tests drive the full
 * sequence with a mocked `fetch` and never boot a real server.
 */

import type { AgentSpawnRequest, AgentSpawnResult } from '../agent.js';
import type { AgentEvent, AgentRuntime } from './contract.js';

/** A minimal `fetch` surface (the Node global `fetch` is assignable to this). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Injectable side-effect seams (fetch / clock) for testability. */
export interface RemoteDeps {
  /** The HTTP client (defaults to the Node global `fetch`). */
  fetch: FetchLike;
  /** Resolve after `ms` (defaults to setTimeout); injected so tests skip real waits. */
  sleep(ms: number): Promise<void>;
  /** Current time in ms (defaults to Date.now); injected for deterministic ids. */
  now(): number;
}

export interface RexRemoteRuntimeOptions {
  /**
   * Host of the swerex-remote server (e.g. `localhost`). May carry an explicit
   * scheme (`http://host` / `https://host`); a bare host has its scheme chosen
   * by {@link resolveTransport} — `http` for a local host, `https` otherwise.
   */
  host: string;
  /** Port of the swerex-remote server. */
  port: number;
  /** Auth token sent as `X-API-Key`. SECRET — never printed. */
  authToken: string;
  /**
   * Opt-in to send the token over PLAINTEXT `http://` to a NON-LOCAL host. Off
   * by default: a bare non-local host upgrades to `https`, and an explicit
   * `http://` non-local host is REJECTED (the token never leaves in cleartext)
   * unless this is set. Local hosts (loopback) always allow plaintext.
   */
  allowInsecure?: boolean;
  /** Server-side directory for per-run prompt/log/exit files. Default `/tmp/ratchet-rex`. */
  serverRunRoot?: string;
  /** Overall guard against a hung run (ms). Default 10 minutes. */
  timeoutMs?: number;
  /** Short timeout for a single REST call (ms). Default 30s. */
  requestTimeoutMs?: number;
  /** Tail-poll cadence (ms). Default 300ms (matches the sidecar). */
  pollIntervalMs?: number;
  /** Injected seams; defaults to the real fetch/clock. */
  deps?: RemoteDeps;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_SERVER_RUN_ROOT = '/tmp/ratchet-rex';

const defaultDeps: RemoteDeps = {
  fetch: ((url, init) =>
    (globalThis.fetch as unknown as FetchLike)(url, init)) as FetchLike,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Single-quote a string for safe embedding in a `sh -c` argument. */
function shquote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Build the agent shell command the server will run: `cat <promptfile> | <argv>`.
 * Identical in spirit to the sidecar's `buildRunCommand`, but the prompt path is
 * a SERVER path (the prompt is written to the server via /write_file).
 */
export function buildRemoteRunCommand(serverPromptPath: string, request: AgentSpawnRequest): string {
  const argv = [request.command, ...request.args].map(shquote).join(' ');
  return `cat ${shquote(serverPromptPath)} | ${argv}`;
}

/** Raised internally to short-circuit to the error-result path with a clean message. */
class RemoteError extends Error {}

/**
 * Is `host` a loopback address? Loopback never leaves the machine, so plaintext
 * `http` to it cannot expose the token on the wire. Matches `localhost`, IPv4
 * loopback `127.0.0.0/8`, and IPv6 `::1` (bare or bracketed).
 */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost') return true;
  if (h === '::1' || h === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * The resolved HTTP transport for the remote runtime: the wire scheme plus the
 * bare host (scheme stripped) used for display/error messages.
 */
export interface ResolvedTransport {
  /** `http` or `https`. */
  scheme: 'http' | 'https';
  /** The host with any scheme prefix removed (for the base URL + error display). */
  host: string;
}

/**
 * Pick the wire scheme for `host`, refusing to send the secret token in
 * cleartext to a non-local host.
 *
 *   - An explicit `http://`/`https://` prefix on `host` is honoured — EXCEPT
 *     plaintext `http://` to a NON-LOCAL host, which is rejected unless
 *     `allowInsecure` is set (the token would cross the network in the clear).
 *   - A bare local host (loopback) defaults to `http` (safe — never leaves the
 *     machine); the swerex-remote dev server speaks plain http on localhost.
 *   - A bare NON-LOCAL host defaults to `https` (the secure default), so a
 *     misconfiguration fails closed rather than leaking the token.
 *
 * Throws `RemoteError` (caught by the run loop → actionable failed result) when
 * plaintext to a non-local host is requested without the opt-in. The token is
 * never included in the message.
 */
export function resolveTransport(host: string, allowInsecure = false): ResolvedTransport {
  const m = host.match(/^(https?):\/\/(.+)$/i);
  const explicitScheme = m ? (m[1].toLowerCase() as 'http' | 'https') : undefined;
  const bareHost = m ? m[2] : host;
  const local = isLocalHost(bareHost);

  if (explicitScheme === 'https') return { scheme: 'https', host: bareHost };
  if (explicitScheme === 'http') {
    if (local || allowInsecure) return { scheme: 'http', host: bareHost };
    throw new RemoteError(
      `Refusing to send the remote auth token over plaintext http:// to non-local host ` +
        `'${bareHost}': the X-API-Key would cross the network in cleartext. Use https:// ` +
        `(the default for a non-local host), or set allowInsecure to opt in to plaintext.`
    );
  }
  // No explicit scheme: http for loopback, https for anything that leaves the box.
  return { scheme: local ? 'http' : 'https', host: bareHost };
}

/** A response body shaped like a swe-rex serialized exception. */
function swerexceptionMessage(body: unknown): string | null {
  if (body && typeof body === 'object' && 'swerexception' in body) {
    const exc = (body as { swerexception?: { message?: string; class_path?: string } })
      .swerexception;
    if (exc && typeof exc === 'object') {
      const msg = typeof exc.message === 'string' ? exc.message : 'unknown error';
      const cls = typeof exc.class_path === 'string' ? exc.class_path : undefined;
      return cls ? `${msg} (${cls})` : msg;
    }
  }
  return null;
}

/**
 * Make a `RexRemoteRuntime` (an `AgentRuntime`). Each call drives the full
 * health→create→write→launch→tail→exit→close sequence over REST, streaming
 * incremental stdout events while accumulating the transcript, and tears the
 * session/runtime down on completion, error, or timeout.
 */
export function makeRexRemoteRuntime(options: RexRemoteRuntimeOptions): AgentRuntime {
  const deps = options.deps ?? defaultDeps;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const serverRunRoot = options.serverRunRoot ?? DEFAULT_SERVER_RUN_ROOT;
  // Resolve the wire scheme up front, but DEFER any rejection (plaintext to a
  // non-local host without opt-in) into the run loop so it surfaces as the
  // standard failed-result path rather than throwing from the factory.
  let transport: ResolvedTransport | undefined;
  let transportError: RemoteError | undefined;
  try {
    transport = resolveTransport(options.host, options.allowInsecure);
  } catch (err) {
    transportError = err instanceof RemoteError ? err : new RemoteError(String(err));
  }
  // host:port is safe to print (the token is not); used in every error message.
  // Uses the bare host (scheme stripped) when transport resolved.
  const where = `${transport?.host ?? options.host}:${options.port}`;
  const base = transport ? `${transport.scheme}://${transport.host}:${options.port}` : '';

  /**
   * Issue one REST call with the auth header and a bounded per-request timeout.
   * Maps connection failures, a 401, a `{detail}` HTTP error body, and a
   * `{swerexception}` body to a `RemoteError` with a readable message that never
   * contains the secret token.
   */
  async function call(pathName: string, body: unknown, opts: { health?: boolean } = {}): Promise<unknown> {
    // Hard stop: never touch the network on an insecure transport — not on the
    // run path NOR on teardown — so the token is NEVER sent in cleartext.
    if (transportError) throw transportError;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await deps.fetch(`${base}${pathName}`, {
        method: opts.health ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': options.authToken,
        },
        ...(opts.health ? {} : { body: JSON.stringify(body ?? {}) }),
        signal: controller.signal,
      });
    } catch {
      // A fetch reject (connection refused, DNS, or our AbortController timeout)
      // — never a hang, always an actionable message naming host/port.
      throw new RemoteError(`swerex-remote server unreachable at ${where}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      throw new RemoteError(
        `Remote agent auth failed (401) at ${where}: Invalid API Key — check authToken`
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      const swe = swerexceptionMessage(parsed);
      if (swe) throw new RemoteError(`Remote agent error at ${where}: ${swe}`);
      const detail =
        parsed && typeof parsed === 'object' && 'detail' in parsed
          ? String((parsed as { detail: unknown }).detail)
          : `HTTP ${res.status}`;
      throw new RemoteError(`Remote agent error (${res.status}) at ${where}: ${detail}`);
    }

    // A 200 may still carry a swerexception body in some runtime paths.
    const swe = swerexceptionMessage(parsed);
    if (swe) throw new RemoteError(`Remote agent error at ${where}: ${swe}`);

    return parsed;
  }

  /** Run a shell command on the server via /execute (shell:true). */
  async function execShell(command: string): Promise<{ stdout: string; exitCode: number | null }> {
    const res = (await call('/execute', { command, shell: true })) as {
      stdout?: string;
      exit_code?: number | null;
    };
    return { stdout: res?.stdout ?? '', exitCode: res?.exit_code ?? null };
  }

  return (req: AgentSpawnRequest, onEvent: (e: AgentEvent) => void): Promise<AgentSpawnResult> => {
    const runId = `${deps.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const runDir = `${serverRunRoot}/${runId}`;
    const promptPath = `${runDir}/prompt.txt`;
    const logPath = `${runDir}/agent.log`;
    const exitPath = `${runDir}/exit.code`;

    let stdout = '';
    let stderr = '';

    const failResult = (message: string): AgentSpawnResult => {
      onEvent({ kind: 'error', message });
      stderr += (stderr ? '\n' : '') + message;
      return { exitCode: 1, signal: null, stdout, stderr };
    };

    const run = async (): Promise<AgentSpawnResult> => {
      // 0. Refuse to proceed if the transport is insecure (plaintext to a
      //    non-local host) — fail BEFORE any fetch so the token never leaves.
      if (transportError) throw transportError;

      // 1. Health check FIRST so an unreachable/misconfigured server fails fast.
      await call('/is_alive', undefined, { health: true });

      // 2. Create the bash session the agent runs in.
      await call('/create_session', { session: 'default', session_type: 'bash', startup_source: [] });

      // 3. Write the prompt onto the SERVER filesystem (mkdir the run dir first).
      await execShell(`mkdir -p ${shquote(runDir)}`);
      await call('/write_file', { path: promptPath, content: req.instructions ?? '' });

      // 4. Non-blocking launch: background the agent to a logfile + an exit
      //    sentinel so /execute returns immediately while the agent keeps running.
      const agentCmd = buildRemoteRunCommand(promptPath, req);
      const cwd = req.cwd ? `cd ${shquote(req.cwd)}; ` : '';
      const launch =
        `${cwd}( ${agentCmd} ) >${shquote(logPath)} 2>&1; ` +
        `echo $? >${shquote(exitPath)}`;
      // Detach so the foreground /execute returns at once; nohup keeps it alive.
      await execShell(`nohup sh -c ${shquote(launch)} >/dev/null 2>&1 &`);

      // 5. Tail-poll the logfile, advancing a byte offset; hold a trailing partial.
      let offset = 0;
      let partial = '';
      const drainTail = async (): Promise<void> => {
        // `tail -c +N` is 1-based, so read from offset+1.
        const { stdout: chunk } = await execShell(`tail -c +${offset + 1} ${shquote(logPath)}`);
        if (!chunk) return;
        offset += Buffer.byteLength(chunk, 'utf-8');
        partial += chunk;
        let nl: number;
        while ((nl = partial.indexOf('\n')) >= 0) {
          const line = partial.slice(0, nl);
          partial = partial.slice(nl + 1);
          stdout += (stdout ? '\n' : '') + line;
          onEvent({ kind: 'stdout', line });
        }
      };

      const readExitCode = async (): Promise<number | null> => {
        // The sentinel exists only after the agent exits; absent → null (running).
        const { stdout: out } = await execShell(
          `test -f ${shquote(exitPath)} && cat ${shquote(exitPath)} || true`
        );
        const trimmed = out.trim();
        if (trimmed.length === 0) return null;
        const code = Number.parseInt(trimmed, 10);
        return Number.isNaN(code) ? null : code;
      };

      let exitCode: number | null = null;
      for (;;) {
        await drainTail();
        exitCode = await readExitCode();
        if (exitCode !== null) break;
        await deps.sleep(pollIntervalMs);
      }

      // 6. Drain any final bytes, flush a trailing partial line, emit exit, close.
      await drainTail();
      if (partial.length > 0) {
        stdout += (stdout ? '\n' : '') + partial;
        onEvent({ kind: 'stdout', line: partial });
        partial = '';
      }
      onEvent({ kind: 'exit', exitCode: exitCode ?? undefined });

      return { exitCode, signal: null, stdout, stderr };
    };

    // Best-effort session/runtime teardown — failures must not mask the result.
    const teardown = async (): Promise<void> => {
      try {
        await execShell(`rm -rf ${shquote(runDir)}`);
      } catch {
        /* best-effort */
      }
      try {
        await call('/close_session', { session: 'default', session_type: 'bash' });
      } catch {
        /* best-effort */
      }
      try {
        await call('/close', {});
      } catch {
        /* best-effort */
      }
    };

    // Overall timeout guard: a hung run resolves with an actionable error rather
    // than waiting forever; the underlying loop is abandoned (best-effort close).
    return new Promise<AgentSpawnResult>((resolve) => {
      let settled = false;
      const finish = (result: AgentSpawnResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(overall);
        void teardown().then(() => resolve(result));
      };
      const overall = setTimeout(() => {
        finish(failResult(`Remote agent timed out after ${timeoutMs}ms at ${where}`));
      }, timeoutMs);

      run()
        .then((result) => finish(result))
        .catch((err) => {
          const message = err instanceof RemoteError ? err.message : String(err?.message ?? err);
          finish(failResult(message));
        });
    });
  };
}
