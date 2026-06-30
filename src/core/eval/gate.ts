/**
 * Contributor-gate resolver.
 *
 * One pure function turns the project's `eval.gate` config plus the parsed CLI
 * flags into the **enabled contributor set** the run executes and gates over.
 * Precedence is `default(all-enabled) ◁ config ◁ CLI`: every contributor is on
 * by default, `eval.gate` booleans toggle that baseline, and CLI flags override
 * the config. No filesystem, no spawn — the resolver operates on in-memory
 * inputs only, so it sits at the bottom of the test pyramid.
 *
 * The contributor ids are the same `ContributorId` vocabulary the aggregation
 * core already names (`deterministic | llm-judge | invariants | regression`):
 * the gate selects *which* of those contributors run; the AND core decides the
 * pass over exactly the ones left enabled. This is the single generalization of
 * the old `--judge auto|deterministic|llm-judge` flag, which is now a deprecated
 * legacy alias mapped onto the gate.
 *
 * Contributor selection is ecosystem-neutral: ids name verdict tiers, never a
 * package manager, test runner, build tool, or command string (`generalizable-defaults`).
 */

import { DEFAULT_CONTRIBUTORS, type ContributorId } from './aggregate.js';

/**
 * The built-in contributor ids, in display order. Derived from the aggregation
 * core's contributor set so there is a single source of truth — no duplicated
 * vocabulary.
 */
export const ALL_CONTRIBUTOR_IDS: ContributorId[] = DEFAULT_CONTRIBUTORS.map((c) => c.id);

/** `eval.gate` config shape: contributor id → enabled boolean (any subset). */
export type GateConfig = Partial<Record<ContributorId, boolean>>;

/**
 * Parsed CLI selectors that override the config. `gate` and `only` carry
 * comma-separated id lists; `llmJudge` is `false` only when `--no-llm-judge` was
 * passed; `judge` is the deprecated legacy `--judge <mode>` alias.
 */
export interface GateFlags {
  /** `--gate <ids>`: set the enabled set outright. */
  gate?: string;
  /** `--only <ids>`: restrict the enabled set to the listed ids. */
  only?: string;
  /** `--no-llm-judge`: clear the llm-judge contributor (commander default `true`). */
  llmJudge?: boolean;
  /** Legacy `--judge auto|deterministic|llm-judge`, mapped onto the gate. */
  judge?: string;
}

export interface ResolveGateInput {
  /** The `eval.gate` record from project config, if any. */
  config?: GateConfig;
  /** The parsed CLI selectors, if any. */
  flags?: GateFlags;
}

/** Parse a comma-separated id list, rejecting any unknown id with the valid ids listed. */
function parseIdList(raw: string, flag: string): ContributorId[] {
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const id of ids) {
    if (!ALL_CONTRIBUTOR_IDS.includes(id as ContributorId)) {
      throw new Error(
        `Unknown contributor id '${id}' for ${flag}. Valid ids: ${ALL_CONTRIBUTOR_IDS.join(', ')}.`
      );
    }
  }
  return ids as ContributorId[];
}

/**
 * Map the deprecated `--judge <mode>` flag onto the gate, preserving the old
 * judge-mode behavior: `deterministic` turns llm-judge off, `llm-judge` turns
 * deterministic off, `auto` turns both on. An unknown mode is rejected with the
 * same message the legacy flag used.
 */
function applyJudgeAlias(mode: string, enabled: Set<ContributorId>): void {
  switch (mode) {
    case 'auto':
      enabled.add('deterministic');
      enabled.add('llm-judge');
      return;
    case 'deterministic':
      enabled.delete('llm-judge');
      return;
    case 'llm-judge':
      enabled.delete('deterministic');
      return;
    default:
      throw new Error(`Invalid --judge '${mode}'. Use auto | deterministic | llm-judge.`);
  }
}

/**
 * Resolve the enabled contributor set from config overlaid by CLI flags.
 *
 * Order: start all-enabled, apply `eval.gate` booleans, then the CLI layer —
 * `--gate` sets the set outright, `--only` intersects to the listed ids, the
 * legacy `--judge` maps to its kind toggle, and `--no-llm-judge` clears
 * llm-judge. Unknown ids in `--gate`/`--only` throw with the valid ids listed.
 */
export function resolveGate({ config, flags }: ResolveGateInput): Set<ContributorId> {
  // Default: every contributor enabled.
  const enabled = new Set<ContributorId>(ALL_CONTRIBUTOR_IDS);

  // Config layer: apply eval.gate booleans over the default.
  if (config) {
    for (const id of ALL_CONTRIBUTOR_IDS) {
      const value = config[id];
      if (value === false) enabled.delete(id);
      else if (value === true) enabled.add(id);
    }
  }

  if (!flags) return enabled;

  // CLI layer (overrides config). `--gate` sets the set explicitly.
  if (flags.gate !== undefined) {
    const ids = parseIdList(flags.gate, '--gate');
    enabled.clear();
    for (const id of ids) enabled.add(id);
  }

  // `--only` restricts to the listed ids (intersection with the current set).
  if (flags.only !== undefined) {
    const only = new Set(parseIdList(flags.only, '--only'));
    for (const id of [...enabled]) {
      if (!only.has(id)) enabled.delete(id);
    }
  }

  // Legacy `--judge` maps onto the gate.
  if (flags.judge !== undefined) applyJudgeAlias(flags.judge, enabled);

  // `--no-llm-judge` clears the llm-judge contributor.
  if (flags.llmJudge === false) enabled.delete('llm-judge');

  return enabled;
}
