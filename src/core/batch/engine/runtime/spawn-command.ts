/**
 * Shared spawn-command helpers for the rex runtimes.
 *
 * Both `RexSidecarRuntime` and `RexRemoteRuntime` launch the agent as a shell
 * command built from an `AgentSpawnRequest`. The two constructions share two
 * primitives — single-quoting a token for safe shell embedding, and serializing
 * `AgentSpawnRequest.env` into `export` statements that overlay the runtime
 * session's base environment — so they live here once and the runtimes cannot
 * drift apart (seed of the phase-level "spawn-request construction lives in one
 * shared helper" criterion; pre-dedups part of #91).
 *
 * Env merge semantics are OVERLAY, not replace: the exports run on top of the
 * session's base environment, so a request value wins on collision and base
 * variables absent from the request remain visible to the agent. (The legacy
 * in-process `realSpawner` replaces the child env wholesale; a shell-session
 * runtime cannot sanely replace — `env -i` would strip the session `PATH` the
 * agent needs for command resolution on docker/remote loci.) Narrowing WHAT the
 * engine puts in `AgentSpawnRequest.env` (host-env leakage to docker/remote) is
 * out of scope here — that is issue #86 (allowlist), which this unblocks.
 *
 * Implements `features/rex-env-threading/env-serialization-safety.feature`.
 */

import type { AgentSpawnRequest } from '../agent.js';

/**
 * Upper bound (bytes) on a held partial-line buffer before it is flushed as a
 * truncated line rather than grown further. Shared by both rex runtimes' partial
 * buffers so an agent emitting a huge line with no newline cannot grow memory
 * without bound. `sidecar.py` declares the SAME value (`MAX_PARTIAL_BYTES`) with a
 * cross-language sync comment; keep the two in sync if this ever changes.
 *
 * The TS callers compare a buffer's UTF-16 code-unit length against this constant
 * (code units ≤ bytes, so the check trips no later than the byte bound and worst-
 * case memory stays ~2× this), keeping the hot path free of repeated byte-encoding.
 */
export const MAX_PARTIAL_BYTES = 1024 * 1024;

/** Single-quote a string for safe embedding in a `sh -c` / bash `-c` argument. */
export function shquote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Byte length of `s` under Python's `str.encode("utf-8", "surrogateescape")` —
 * the EXACT arithmetic the sidecar uses to advance its tail-poll byte cursor
 * (`sidecar.py`). Both rex runtimes read logfile bytes via `tail -c +N`, but ReX
 * `execute()` (sidecar) and the swerex-remote server both hand back an
 * already-DECODED string: bytes are decoded as UTF-8 with `errors="surrogateescape"`,
 * so any non-UTF-8 byte survives as a lone surrogate in U+DC80–U+DCFF. Counting
 * such a lone surrogate as ONE byte (the original it stands for) and every other
 * code point as its standard UTF-8 length reproduces the byte count of the raw
 * chunk, so the remote runtime's cursor agrees with the sidecar's on non-UTF-8
 * output instead of drifting (as `Buffer.byteLength`, which encodes a lone
 * surrogate as the 3-byte replacement char, would).
 *
 * Locked to the Python `len(chunk.encode("utf-8","surrogateescape"))` by the
 * cross-language `cursor-vectors.json` contract test (TS side in
 * `spawn-command.test.ts`, Python `CursorContractTests` in `test_sidecar.py`).
 */
export function surrogateEscapeByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xdc80 && cp <= 0xdcff) {
      // A surrogateescape lone surrogate encodes one original non-UTF-8 byte.
      bytes += 1;
    } else if (cp <= 0x7f) {
      bytes += 1;
    } else if (cp <= 0x7ff) {
      bytes += 2;
    } else if (cp <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

const SHELL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Serialize `env` into a sequence of shell `export` statements (each trailing
 * `"; "`) that overlay the runtime session's base environment when prefixed to
 * the agent launch command.
 *
 * - Values are single-quoted via {@link shquote} so metacharacters ($, spaces,
 *   quotes, newlines) survive byte-for-byte and are not interpreted by the shell.
 * - Entries whose name is not a valid shell identifier are skipped: such names
 *   are unreachable in shell and would break `export`.
 * - Entries with `undefined` values are skipped.
 * - An empty/absent env yields an empty prefix.
 */
export function buildEnvExports(env: NodeJS.ProcessEnv | undefined): string {
  if (!env) return '';
  let out = '';
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!SHELL_IDENT.test(name)) continue;
    out += `export ${name}=${shquote(String(value))}; `;
  }
  return out;
}

/**
 * The full agent launch command both rex runtimes build, in one place:
 * `[cd <cwd>; ]<exports>cat <promptFile> | <argv>`.
 *
 * `buildRunCommand` (sidecar) and `buildRemoteRunCommand` (remote) delegate here
 * so the two near-identical constructions cannot drift apart. The optional
 * `cwd` prefixes a single-quoted `cd <cwd>; ` (the sidecar threads it; the
 * remote runtime wraps its own `cd` outside this builder, so it omits it here).
 * `AgentSpawnRequest.env` is exported before the pipeline via
 * {@link buildEnvExports}, overlaying the runtime session's base environment.
 *
 * Implements `features/rex-command-builder/shared-run-command.feature`.
 */
export function buildAgentRunCommand(
  promptPath: string,
  request: AgentSpawnRequest,
  opts?: { cwd?: string }
): string {
  const argv = [request.command, ...request.args].map(shquote).join(' ');
  const prefix = opts?.cwd ? `cd ${shquote(opts.cwd)}; ` : '';
  const exports = buildEnvExports(request.env);
  return `${prefix}${exports}cat ${shquote(promptPath)} | ${argv}`;
}
