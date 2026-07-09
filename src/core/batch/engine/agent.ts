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

/**
 * Provenance marker stamped on journal entries and eval run records produced
 * under an active agent-cmd override, so synthetic runs are distinguishable from
 * real agent work after the fact. A string-literal union left open to widen
 * later; today `via` is only ever this value (or absent).
 */
export type EnvOverrideProvenance = 'env-override';
export const ENV_OVERRIDE_PROVENANCE: EnvOverrideProvenance = 'env-override';

/**
 * The env var that overrides the batch engine's coding-agent spawn. Declared
 * once here so the engine, the override notice, and the report-time provenance
 * stamp all reference the same literal.
 */
export const BATCH_AGENT_CMD_ENV = 'RATCHET_BATCH_AGENT_CMD';

/**
 * Return the active agent-cmd override for `envVar` read from `env`, or
 * `undefined` when unset / whitespace-only. The single gate every spawn seam
 * delegates to: a whitespace-only value is treated as inactive so a leftover
 * blank (e.g. an empty `.envrc` line) can never silently replace the configured
 * agent.
 */
export function activeAgentCmdOverride(
  envVar: string,
  env: NodeJS.ProcessEnv
): string | undefined {
  const raw = env[envVar];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The one-line override notice printed (text output) when a spawn ran under an
 * active agent-cmd override. Mirrors the `RATCHET_EVAL_AGENT_CMD` notice on the
 * eval side.
 */
export function agentOverrideNotice(envVar: string): string {
  return `⚠ agent overridden by ${envVar}`;
}

/**
 * Build an override-aware agent spawn request through the single shared gate.
 *
 * When `activeAgentCmdOverride(overrideEnvVar, env)` is active, the override
 * command stands in for the coding-agent binary as `bash -c <override>`
 * (instructions on stdin, NOT stream-json-capable) and `agentOverride` is
 * `true`. Otherwise the supplied `buildAdapterRequest` closure builds the
 * configured-adapter request and `agentOverride` is `false`. The closure owns
 * site-specific adapter resolution (the engine's stage-map/spec logic, the eval
 * side's bare `resolveAdapter`), so this helper owns ONLY the shared override
 * semantics (trim check, `bash -c` request shape, flag) — the gate exists in
 * exactly one place without flattening genuinely different adapter paths.
 *
 * Coordinates with the #67 triplication: the batch engine's `buildSpawnRequest`,
 * the eval judge's `buildVoteRequest`, and the mutation harness's
 * `buildSeedRequest` all delegate their override branch here.
 */
export function buildAgentSpawnRequest(args: {
  overrideEnvVar: string;
  instructions: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  buildAdapterRequest: () => AgentSpawnRequest;
}): { request: AgentSpawnRequest; agentOverride: boolean } {
  const override = activeAgentCmdOverride(args.overrideEnvVar, args.env);
  if (override !== undefined) {
    return {
      request: {
        command: 'bash',
        args: ['-c', override],
        instructions: args.instructions,
        cwd: args.cwd,
        env: args.env,
      },
      agentOverride: true,
    };
  }
  return { request: args.buildAdapterRequest(), agentOverride: false };
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
  /**
   * Environment variable names (or `PREFIX_*` glob patterns) this adapter needs
   * from the host environment to function (API keys, config dirs, etc.). The
   * engine's env allowlist passes these through alongside the baseline process
   * vars and `RATCHET_*` control vars. A `PREFIX_*` entry matches any var whose
   * name starts with `PREFIX_` (the trailing `_*` is the glob). Required on
   * every built-in adapter so the registry drift guard can assert one exists
   * per agent — a newly added agent cannot silently ship without a declaration.
   */
  readonly envPassthrough: readonly string[];
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
    readonly modelFlag: string,
    /**
     * Environment variable names (or `PREFIX_*` glob patterns) this adapter
     * needs from the host env. Threaded to the env allowlist so the agent's
     * own secrets reach it without leaking everything else in `process.env`.
     */
    readonly envPassthrough: readonly string[]
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
    '--model',
    ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_*']
  ),
  // codex uses `-m` to name a model.
  codex: new CommandAgentAdapter(
    'codex',
    agentBinaryFor('codex'),
    () => ['exec', '-'],
    true,
    false,
    '-m',
    ['OPENAI_API_KEY', 'CODEX_HOME']
  ),
  // gemini uses `-m` to name a model.
  gemini: new CommandAgentAdapter(
    'gemini',
    agentBinaryFor('gemini'),
    () => ['-p'],
    true,
    false,
    '-m',
    ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
  ),
  // cursor uses `--model` to name a model.
  cursor: new CommandAgentAdapter(
    'cursor',
    agentBinaryFor('cursor'),
    () => ['-p'],
    true,
    false,
    '--model',
    ['CURSOR_API_KEY', 'CURSOR_*']
  ),
  // opencode emits structured stream-json NDJSON (one event per line) with
  // `run --format json`, reading the prompt from stdin. Its event schema
  // (step_start/text/step_finish) differs from claude's, so the renderer parses
  // both — gated on `emitsStreamJson`, never the agent name. `--model` is
  // opencode's model flag. opencode is multi-provider: it can drive any of the
  // other agents' provider keys, but those are covered by the UNION of all
  // adapter declarations (claude/codex/gemini/cursor), so opencode only
  // declares its own namespaced config vars here.
  opencode: new CommandAgentAdapter(
    'opencode',
    agentBinaryFor('opencode'),
    () => ['run', '--format', 'json'],
    true,
    true,
    '--model',
    ['OPENCODE_*']
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
 *
 * On POSIX the child is spawned `detached: true` so it leads its own process
 * group (pgid == pid); a hung agent is reaped by escalating TERM → grace → KILL
 * on the whole group (so grandchildren like `cat prompt | agent` are reaped
 * too, not just the recorded pid), resolving with a timeout message in stderr
 * instead of hanging forever. On Windows process groups aren't a thing — it
 * falls back to a bare `child.kill(sig)`.
 *
 * Use {@link makeRealSpawner} to tune `timeoutMs`/`killGraceMs`; the exported
 * `realSpawner` is built from the factory with defaults so the eval judge and
 * mutation harness inherit the timeout/kill semantics unchanged.
 */
export function makeRealSpawner(
  opts: { timeoutMs?: number; killGraceMs?: number } = {}
): Spawner {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const killGraceMs = opts.killGraceMs ?? 2000;
  const isPosix = process.platform !== 'win32';

  return (request: AgentSpawnRequest) =>
    new Promise<AgentSpawnResult>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: isPosix, // own process group on POSIX; harmless on Windows
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const reapGroup = (signal: NodeJS.Signals) => {
        const pid = child.pid;
        if (pid !== undefined && isPosix) {
          try {
            process.kill(-pid, signal);
            return;
          } catch {
            /* group gone — fall through */
          }
        }
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      };

      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      const overall = setTimeout(() => {
        if (settled) return;
        const msg = `Agent timed out after ${timeoutMs}ms`;
        stderr += (stderr ? '\n' : '') + msg;
        onTimeout();
      }, timeoutMs);

      const onTimeout = () => {
        // TERM the whole group, short grace, then KILL; resolve with a timeout
        // result (non-zero exit) instead of hanging.
        reapGroup('SIGTERM');
        killTimer = setTimeout(() => reapGroup('SIGKILL'), killGraceMs);
      };

      const finish = (result: AgentSpawnResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(overall);
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };

      child.on('error', (err) => {
        if (settled) return;
        clearTimeout(overall);
        reject(err);
      });
      child.on('close', (exitCode, signal) => {
        finish({ exitCode, signal, stdout, stderr });
      });

      if (request.instructions && child.stdin) {
        child.stdin.write(request.instructions);
        child.stdin.end();
      }
    });
}

export const realSpawner: Spawner = makeRealSpawner();
