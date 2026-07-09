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

/** Single-quote a string for safe embedding in a `sh -c` / bash `-c` argument. */
export function shquote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
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
