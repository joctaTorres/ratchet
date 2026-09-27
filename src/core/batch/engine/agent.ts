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
import { canTranslatePermissions, resolvePermissionFlags } from '../runtime/agent-permissions.js';
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
  /**
   * The model part of a resolved `agent[:model]` spec, threaded from the engine's
   * single `parseAgentSpec` call per transition. Present only when the user named
   * a model; a bare agent name carries no `model` key so the adapter emits no
   * model flag and the agent uses its harness-configured default model. The
   * adapter owns its flag ({@link AgentAdapter.modelFlag}); this is just the
   * value the engine handed it, so `AgentRequestContext` stays the narrow,
   * structural slice adapters may read.
   */
  model?: string;
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

/** The env var that overrides the batch engine's coding-agent spawn. */
export const BATCH_AGENT_CMD_ENV = 'RATCHET_BATCH_AGENT_CMD';
/** The env var that overrides the eval judge / mutation harness agent spawn. */
export const EVAL_AGENT_CMD_ENV = 'RATCHET_EVAL_AGENT_CMD';
/** The CLI flag an operator passes to deliberately allow an agent-cmd override. */
export const ALLOW_AGENT_OVERRIDE_FLAG = '--allow-agent-override';

/**
 * Provenance marker stamped on journal entries and eval run records produced
 * under an agent-cmd override, so synthetic runs are distinguishable from real
 * agent work after the fact.
 */
export type EnvOverrideProvenance = 'env-override';
export const ENV_OVERRIDE_PROVENANCE: EnvOverrideProvenance = 'env-override';

/**
 * Env var exported ONLY inside a stand-in built under an allowed override (value
 * {@link ENV_OVERRIDE_PROVENANCE}). `ratchet batch report`, run by the stand-in,
 * stamps its journal entries from it — so a leftover override var in an
 * operator's shell never mislabels a manual report. It is exported at the head
 * of the `bash -c` script itself (not only set on `request.env`) so it reaches
 * the stand-in under every runtime, including ones that launch the command with
 * their own environment.
 */
export const SPAWN_VIA_ENV = 'RATCHET_SPAWN_VIA';

/**
 * The active agent-cmd override for `envVar` in `env`, or `undefined` when
 * unset / whitespace-only (a blank value is inactive, never an override).
 */
export function activeAgentCmdOverride(
  envVar: string,
  env: NodeJS.ProcessEnv
): string | undefined {
  const trimmed = env[envVar]?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The `bash -c` script an allowed override runs: export the provenance marker,
 * then run the operator's command unchanged.
 */
export function overrideScript(override: string): string {
  return `export ${SPAWN_VIA_ENV}=${ENV_OVERRIDE_PROVENANCE}; ${override}`;
}

/** The one-line notice emitted on every spawn made under an override. */
export function agentOverrideNotice(envVar: string): string {
  return `⚠ agent overridden by ${envVar}`;
}

/**
 * A spawn refused by the override gate: the override is active but the operator
 * did not opt in, or the resolved permission policy cannot be forwarded to it.
 * Nothing is spawned; callers surface the message as a failed step / run.
 */
export class AgentOverrideRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOverrideRefusedError';
  }
}

/** The refusal message for an active override without the operator opt-in. */
export function agentOverrideNotAllowedMessage(envVar: string): string {
  return (
    `${envVar} is set but agent overrides are disabled: pass ${ALLOW_AGENT_OVERRIDE_FLAG} ` +
    `to run it in place of the configured agent, or unset ${envVar}.`
  );
}

/**
 * Refuse up front when `envVar` carries an active override the operator did not
 * opt into. Used by callers (e.g. `executeRun`) that must fail before any work,
 * not just at spawn time; the spawn-time gate in {@link buildAgentSpawnRequest}
 * applies the same rule.
 */
export function assertAgentOverrideAllowed(
  envVar: string,
  env: NodeJS.ProcessEnv,
  allowOverride: boolean
): void {
  if (activeAgentCmdOverride(envVar, env) !== undefined && !allowOverride) {
    throw new AgentOverrideRefusedError(agentOverrideNotAllowedMessage(envVar));
  }
}

/**
 * Build an agent spawn request through the ONE shared override gate. Every spawn
 * seam (the batch engine, the eval judge, the mutation harness) delegates here,
 * so the gate, the notice, and permission forwarding exist in exactly one place.
 *
 * - No active override → `buildAdapterRequest()` (called exactly once).
 * - Active override without `allowOverride` → {@link AgentOverrideRefusedError}.
 *   The opt-in is an explicit parameter, never read from the environment.
 * - Active override with a permission policy whose agent has no translator →
 *   refused, rather than silently spawning without any permission flags.
 * - Otherwise → `bash -c <override> <agentName> <permission flags...>`: the
 *   stand-in sees the agent as `$0` and the flags a real agent would have
 *   received as `$@`. The script exports {@link SPAWN_VIA_ENV} before running
 *   the override (provenance), and `notify` receives the override notice
 *   (stderr by default).
 *
 * Pure over its inputs apart from `notify`, so it is unit-testable directly.
 */
export function buildAgentSpawnRequest(args: {
  overrideEnvVar: string;
  env: NodeJS.ProcessEnv;
  allowOverride: boolean;
  instructions: string;
  cwd: string;
  /** Agent the spawn resolved to; names `$0` and selects the forwarded flags. */
  agentName?: string;
  /** Resolved permission policy to forward; absent → no flags to forward. */
  permissions?: ResolvedPermissionsPolicy;
  buildAdapterRequest: () => AgentSpawnRequest;
  notify?: (line: string) => void;
}): { request: AgentSpawnRequest; agentOverride: boolean } {
  const override = activeAgentCmdOverride(args.overrideEnvVar, args.env);
  if (override === undefined) {
    return { request: args.buildAdapterRequest(), agentOverride: false };
  }
  if (!args.allowOverride) {
    throw new AgentOverrideRefusedError(agentOverrideNotAllowedMessage(args.overrideEnvVar));
  }
  const agentName = args.agentName ?? DEFAULT_AGENT;
  let flags: string[] = [];
  if (args.permissions) {
    if (!canTranslatePermissions(agentName, args.permissions)) {
      throw new AgentOverrideRefusedError(
        `${args.overrideEnvVar} override refused: the '${args.permissions.posture}' permission ` +
          `policy cannot be translated for agent '${agentName}', so it could not be forwarded ` +
          `to the override command.`
      );
    }
    flags = resolvePermissionFlags(agentName, args.permissions, args.cwd);
  }
  const notify = args.notify ?? ((line: string) => process.stderr.write(line + '\n'));
  notify(agentOverrideNotice(args.overrideEnvVar));
  return {
    request: {
      command: 'bash',
      args: ['-c', overrideScript(override), agentName, ...flags],
      instructions: args.instructions,
      cwd: args.cwd,
      env: args.env,
    },
    agentOverride: true,
  };
}

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
   * The flag this adapter uses to name a model on its spawn argv
   * (`--model` for claude/opencode/cursor, `-m` for codex/gemini). Required on
   * `CommandAgentAdapter` so every spawnable agent declares its flag and the
   * drift guard can assert non-empty; optional on the interface so a non-command
   * (synthetic) adapter still satisfies it. `buildRequest` appends
   * `[modelFlag, model]` only when `context.model` is set — a bare agent name
   * emits no flag so the agent uses its harness-configured default model.
   */
  readonly modelFlag?: string;
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
    readonly emitsStreamJson: boolean = false,
    /**
     * The flag this adapter uses to name a model on its spawn argv. Required so
     * every spawnable agent declares its flag — the registry drift guard asserts
     * non-empty — and so `buildRequest` has the exact string to emit. Lives next
     * to the base argv the adapter already owns, not in a separate model-flag
     * registry, so `AI_TOOLS` stays about init/binaries.
     */
    readonly modelFlag: string
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
    // The model pair sits BETWEEN the base argv and the permission flags so the
    // base argv shape is preserved for parsers of leading flags and the
    // permission flags remain the trailing block they are today. Appended only
    // when `context.model` is set — a bare agent name touches nothing, keeping
    // today's argv byte-for-byte (the success criterion).
    const modelFlags = context.model ? [this.modelFlag, context.model] : [];
    return {
      command: this.command,
      args: [...this.argv(instructions), ...modelFlags, ...permissionFlags],
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
  // `--model` is claude's model flag, appended only when a model is named.
  claude: new CommandAgentAdapter(
    'claude',
    agentBinaryFor('claude'),
    () => ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    true,
    true,
    '--model'
  ),
  // codex uses `-m` to name a model.
  codex: new CommandAgentAdapter('codex', agentBinaryFor('codex'), () => ['exec', '-'], true, false, '-m'),
  // gemini uses `-m` to name a model.
  gemini: new CommandAgentAdapter('gemini', agentBinaryFor('gemini'), () => ['-p'], true, false, '-m'),
  // cursor uses `--model` to name a model.
  cursor: new CommandAgentAdapter('cursor', agentBinaryFor('cursor'), () => ['-p'], true, false, '--model'),
  // opencode emits structured stream-json NDJSON (one event per line) with
  // `run --format json`, reading the prompt from stdin. Its event schema
  // (step_start/text/step_finish) differs from claude's, so the renderer parses
  // both — gated on `emitsStreamJson`, never the agent name. `--model` is
  // opencode's model flag.
  opencode: new CommandAgentAdapter(
    'opencode',
    agentBinaryFor('opencode'),
    () => ['run', '--format', 'json'],
    true,
    true,
    '--model'
  ),
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
 * github-copilot) are config targets, not spawnable agents, so they are
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
