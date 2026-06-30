/**
 * Shared helpers for the `ratchet eval` command group.
 */

import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { readProjectConfig } from '../../core/project-config.js';
import { resolveGate } from '../../core/eval/index.js';
import type { EvalScope, GateFlags, ContributorId } from '../../core/eval/index.js';

export function projectRoot(): string {
  return resolveCurrentPlanningHomeSync().root;
}

export interface ScopeFlags {
  changes?: boolean;
  change?: string;
  path?: string;
}

/** Resolve scope flags into a single scope; flags are mutually exclusive. */
export function resolveScope(flags: ScopeFlags): EvalScope {
  const set = [flags.changes ? 'changes' : null, flags.change ? 'change' : null, flags.path ? 'path' : null].filter(
    Boolean
  );
  if (set.length > 1) {
    throw new Error('Use at most one of --changes, --change <name>, or --path <dir-or-file>.');
  }
  if (flags.change) return { kind: 'change', target: flags.change };
  if (flags.path) return { kind: 'path', target: flags.path };
  if (flags.changes) return { kind: 'changes' };
  return { kind: 'store' };
}

/**
 * Resolve the enabled contributor set for a run: the project's `eval.gate`
 * config overlaid by the CLI selectors (`--gate`/`--only`/`--no-llm-judge` and
 * the legacy `--judge`). The pure precedence/validation logic lives in the core
 * `resolveGate`; this wrapper only supplies the config layer from disk.
 */
export function resolveContributorGate(root: string, flags: GateFlags): Set<ContributorId> {
  const config = readProjectConfig(root);
  return resolveGate({ config: config?.eval?.gate, flags });
}
