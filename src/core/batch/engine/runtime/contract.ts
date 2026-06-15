/**
 * The `AgentRuntime` seam — a streaming sibling of `Spawner`.
 *
 * `Spawner` (agent.ts) spawns the agent directly and accumulates its stdout into
 * a string that only surfaces after the process exits — a silent multi-minute
 * wait. `AgentRuntime` keeps the SAME accumulated `AgentSpawnResult` return shape
 * (so `mapSessionToOutcome` is unchanged) but ALSO forwards each line of output
 * to an `onEvent` callback as it arrives, so the engine can print it live.
 *
 * It is a function-type seam, injected into the engine exactly like `Spawner`, so
 * unit tests pass a fake runtime with canned events and never start Python.
 */

import type { AgentSpawnRequest, AgentSpawnResult } from '../agent.js';

/**
 * One streamed event from a running agent. `stdout` carries one line of agent
 * output; `exit` carries the final exit code; `error` carries a failure message
 * (a sidecar error or a bootstrap failure) that the engine surfaces as failed.
 */
export interface AgentEvent {
  kind: 'stdout' | 'exit' | 'error';
  /** Present for kind 'stdout' — one line of agent output (no trailing newline). */
  line?: string;
  /** Present for kind 'exit' — the agent's process exit code. */
  exitCode?: number;
  /** Present for kind 'error' — an actionable failure message. */
  message?: string;
}

/**
 * Drive one agent run, streaming `AgentEvent`s live to `onEvent` AND returning
 * the accumulated `AgentSpawnResult` (stdout newline-joined, exitCode from the
 * exit event). A failure (sidecar `error` / bootstrap failure) resolves with a
 * non-zero `exitCode` and the message in `stderr` so the engine maps it to a
 * blocked/failed outcome — no new outcome states.
 */
export type AgentRuntime = (
  req: AgentSpawnRequest,
  onEvent: (e: AgentEvent) => void
) => Promise<AgentSpawnResult>;
