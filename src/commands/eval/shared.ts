/**
 * Shared helpers for the `ratchet eval` command group.
 */

import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { readProjectConfig } from '../../core/project-config.js';
import type { EvalScope } from '../../core/eval/index.js';
import type { JudgeMode } from '../../core/eval/index.js';

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

const VALID_MODES: JudgeMode[] = ['auto', 'check', 'agent'];

/** Resolve the judge mode: explicit flag wins, else the project config default,
 * else `auto`. */
export function resolveJudgeMode(root: string, flag: string | undefined): JudgeMode {
  if (flag) {
    if (!VALID_MODES.includes(flag as JudgeMode)) {
      throw new Error(`Invalid --judge '${flag}'. Use auto | check | agent.`);
    }
    return flag as JudgeMode;
  }
  const config = readProjectConfig(root);
  const configured = config?.eval?.judge;
  return configured ?? 'auto';
}
