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

/**
 * The narrow slice of step context an adapter may read when building a spawn
 * request. `ResolvedStepContext` is assignable to this, so the engine passes its
 * full context unchanged; callers without a transition (e.g. the eval judge) can
 * build a minimal, fully-typed value instead of casting.
 */
export interface AgentRequestContext {
  batch: string;
  change: string;
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
    private readonly passOnStdin: boolean
  ) {}

  buildRequest(
    _context: AgentRequestContext,
    instructions: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): AgentSpawnRequest {
    return {
      command: this.command,
      args: this.argv(instructions),
      instructions: this.passOnStdin ? instructions : '',
      cwd,
      env,
    };
  }
}

/**
 * Built-in adapters for the coding agents ratchet supports. The argv shape is
 * the documented non-interactive ("print"/headless) invocation for each agent;
 * instructions go on stdin where the agent reads a prompt there.
 */
const BUILTIN_ADAPTERS: Record<string, AgentAdapter> = {
  claude: new CommandAgentAdapter('claude', 'claude', () => ['-p'], true),
  codex: new CommandAgentAdapter('codex', 'codex', () => ['exec', '-'], true),
  gemini: new CommandAgentAdapter('gemini', 'gemini', () => ['-p'], true),
  cursor: new CommandAgentAdapter('cursor', 'cursor-agent', () => ['-p'], true),
};

/** The default agent when the resolved settings name none. */
export const DEFAULT_AGENT = 'claude';

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
