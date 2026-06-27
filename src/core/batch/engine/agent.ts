/**
 * Agent adapters: spawn the configured coding agent as a subprocess.
 *
 * An adapter knows how to launch one coding agent (its binary, args, and how the
 * instructions are passed). The engine spawns a FRESH agent per transition for
 * context hygiene; the agent reports back only through `ratchet batch report`,
 * so an adapter needs nothing more than an agent that can run a shell command.
 *
 * STUBBED BOUNDARY: the concrete agent binaries (claude, etc.) are not present
 * in CI/tests, so the spawn seam is exercised with an injected fake `Spawner`.
 * The default adapters declare the real command/args; the `Spawner` is the one
 * point to inject for tests or to harden later. No fake "success" is baked in —
 * a real spawn runs the real agent; the fake only stands in for the binary.
 */

import { spawn } from 'node:child_process';
import { resolvePermissionFlags } from '../runtime/agent-permissions.js';
import type { ResolvedPermissionsPolicy } from '../permissions-policy.js';
import { AI_TOOLS, type AIToolOption } from '../../config.js';

/**
 * The narrow slice of step context an adapter may read when building a spawn
 * request. `ResolvedStepContext` is assignable to this, so the engine passes its
 * full context unchanged; callers without a transition (e.g. the eval judge) can
 * build a minimal, fully-typed value instead of casting.
 */
export interface AgentRequestContext {
  /** Run-state locus only; optional so a standalone (no-batch) step is assignable. */
  batch?: string;
  change: string;
  /**
   * The narrow slice of resolved settings an adapter reads. `ResolvedStepContext`
   * (whose `settings` is the full `BatchSettings`) is assignable to this, so the
   * engine passes its context unchanged. Only `permissions` is read here, and it
   * is optional so minimal callers (e.g. the eval judge) need not supply it — a
   * missing policy yields no permission flags.
   */
  settings?: {
    permissions?: ResolvedPermissionsPolicy;
  };
}

export interface AgentSpawnResult {
  /** Process exit code (null if killed by signal). */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface AgentSpawnRequest {
  command: string;
  args: string[];
  /** Instructions passed via stdin (most agents accept a prompt on stdin). */
  instructions: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** The injectable process-spawn seam. */
export type Spawner = (request: AgentSpawnRequest) => Promise<AgentSpawnResult>;

export interface AgentAdapter {
  readonly name: string;
  /**
   * Whether this adapter's argv makes the agent emit structured `stream-json`
   * NDJSON on stdout (one event per line). When true the engine routes the
   * agent's stdout through the generic stream-json renderer for polished live
   * output; when false/absent the engine prints each line raw. This is a
   * tool-agnostic CAPABILITY flag — the renderer is gated on it, never on the
   * agent name — so any future stream-json agent reuses the renderer by setting
   * it true.
   */
  readonly emitsStreamJson?: boolean;
  /**
   * Build the spawn request for a transition. Pure: turns context+instructions
   * into a command + args so it is unit-testable without spawning.
   */
  buildRequest(
    context: AgentRequestContext,
    instructions: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): AgentSpawnRequest;
}

/**
 * Default adapter for an agent invoked as `<bin> -p <instructions>` on stdin or
 * argv. Each supported agent registers one of these.
 */
class CommandAgentAdapter implements AgentAdapter {
  constructor(
    readonly name: string,
    private readonly command: string,
    private readonly argv: (instructions: string) => string[],
    private readonly passOnStdin: boolean,
    readonly emitsStreamJson: boolean = false
  ) {}

  buildRequest(
    context: AgentRequestContext,
    instructions: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): AgentSpawnRequest {
    // Append the resolved permission flags AFTER the base argv. `cwd` is the
    // project/repo root the engine spawns in, so it doubles as the repo root the
    // translator scopes the agent to (`--add-dir`/sandbox). A missing policy
    // (minimal callers) appends nothing.
    const permissionFlags = context.settings?.permissions
      ? resolvePermissionFlags(this.name, context.settings.permissions, cwd)
      : [];
    return {
      command: this.command,
      args: [...this.argv(instructions), ...permissionFlags],
      instructions: this.passOnStdin ? instructions : '',
      cwd,
      env,
    };
  }
}

/**
 * The spawnable binary for an agent id, read from the `ratchet init` tool
 * registry (`AI_TOOLS`). This keeps the CLI binary name a SINGLE literal source
 * of truth in `config.ts`: the adapter argv below and `AGENT_BINARIES` both read
 * it from here, so neither can drift from init. Throws at module load if an
 * adapter references an id that init does not mark as a coding agent.
 */
function agentBinaryFor(id: string): string {
  const tool = AI_TOOLS.find((t) => t.value === id);
  if (!tool?.agentBinary) {
    throw new Error(
      `No agentBinary declared in AI_TOOLS for agent '${id}'. ` +
        `Add the agent (with an agentBinary) to the init tool registry in config.ts.`
    );
  }
  return tool.agentBinary;
}

/**
 * Built-in adapters for the coding agents ratchet supports. The argv shape is
 * the documented non-interactive ("print"/headless) invocation for each agent;
 * instructions go on stdin where the agent reads a prompt there. The binary each
 * adapter spawns is read from `AI_TOOLS` (via `agentBinaryFor`), not hardcoded,
 * so init stays the single source of truth for binary names.
 */
const BUILTIN_ADAPTERS: Record<string, AgentAdapter> = {
  // claude emits structured stream-json (one NDJSON event per line) with partial
  // message deltas, so the engine renders it richly. `--verbose` is required for
  // stream-json with `-p`; `--include-partial-messages` streams text deltas live.
  claude: new CommandAgentAdapter(
    'claude',
    agentBinaryFor('claude'),
    () => ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    true,
    true
  ),
  codex: new CommandAgentAdapter('codex', agentBinaryFor('codex'), () => ['exec', '-'], true),
  gemini: new CommandAgentAdapter('gemini', agentBinaryFor('gemini'), () => ['-p'], true),
  cursor: new CommandAgentAdapter('cursor', agentBinaryFor('cursor'), () => ['-p'], true),
};

/** The default agent when the resolved settings name none. */
export const DEFAULT_AGENT = 'claude';

/**
 * The binary each coding agent needs on PATH, keyed by agent id. DERIVED FROM
 * the `ratchet init` tool registry (`AI_TOOLS` in `src/core/config.ts`): an init
 * tool is a coding agent iff it declares an `agentBinary`, and that binary is the
 * single source of truth for "which CLI does agent X need on PATH".
 *
 * This makes init the source of truth for which coding agents exist: adding an
 * init tool with an `agentBinary` (and a matching spawn adapter in
 * `BUILTIN_ADAPTERS`) automatically makes `doctor` probe it and the engine spawn
 * it, with no edit here. `doctor` iterates this map to check every coding agent
 * (never special-casing one). Init tools WITHOUT an `agentBinary` (e.g.
 * github-copilot, opencode) are config targets, not spawnable agents, so they are
 * excluded by construction.
 *
 * Invariant (enforced by the drift-guard test): the keys here === the
 * `agentBinary`-marked `AI_TOOLS` ids === the `BUILTIN_ADAPTERS` keys, and each
 * adapter's spawn command === its `AI_TOOLS` `agentBinary`.
 */
export const AGENT_BINARIES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    AI_TOOLS.filter(
      (tool): tool is AIToolOption & { agentBinary: string } =>
        Boolean(tool.agentBinary)
    ).map((tool) => [tool.value, tool.agentBinary])
  )
);

export class UnknownAgentError extends Error {
  constructor(
    public readonly requested: string,
    public readonly available: string[]
  ) {
    super(
      `Unknown agent adapter '${requested}'. ` +
        `Available adapters: ${available.join(', ')}.`
    );
    this.name = 'UnknownAgentError';
  }
}

export function availableAdapters(extra?: Record<string, AgentAdapter>): string[] {
  return Object.keys({ ...BUILTIN_ADAPTERS, ...extra }).sort();
}

/**
 * Resolve the adapter named by the resolved settings. Throws `UnknownAgentError`
 * BEFORE any spawn when the name is not registered, listing what is available.
 */
export function resolveAdapter(
  name: string | undefined,
  extra?: Record<string, AgentAdapter>
): AgentAdapter {
  const registry = { ...BUILTIN_ADAPTERS, ...extra };
  const key = name ?? DEFAULT_AGENT;
  const adapter = registry[key];
  if (!adapter) {
    throw new UnknownAgentError(key, availableAdapters(extra));
  }
  return adapter;
}

/**
 * The real spawner: runs the agent binary, feeds instructions on stdin when
 * present, and captures stdout/stderr and exit status.
 */
export const realSpawner: Spawner = (request) =>
  new Promise<AgentSpawnResult>((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('error', (err) => reject(err));
    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });

    if (request.instructions && child.stdin) {
      child.stdin.write(request.instructions);
      child.stdin.end();
    }
  });
