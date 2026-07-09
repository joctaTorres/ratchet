/**
 * Approval gate policy — the single source of truth for which transitions each
 * `gate` value parks for human approval.
 *
 * `parksForApproval(gate, transition)` is a PURE, deterministic function over
 * in-memory inputs: it answers "should a completed `transition` park as
 * `awaiting-approval` under this `gate`?" with no filesystem, no spawn, and no
 * engine context. The engine threads it (see `shouldParkForApproval` and the
 * decompose/PR call sites in `engine.ts`) so the gate×transition decision has
 * exactly one author (`delegated-lifecycle`: gating is mechanical
 * orchestration, not lifecycle semantics — this module owns the boolean
 * matrix, the engine owns WHEN to call it).
 *
 * Matrix (the documented behavior `docs/engine/overview.md`,
 * `docs/commands/batch.md`, and `docs/configuration/config-yaml.md` state):
 *
 *   - `voluntary`      → never parks a completed transition.
 *   - `after-propose`  → parks a completed `propose` only.
 *   - `every-phase`    → parks every completed change transition
 *                        (`propose`, `apply`, `verify`).
 *   - `autonomous`     → never parks a completed transition (agent blockers
 *                        still park, handled in the outcome mapper).
 *
 * `decompose` and `pr` step kinds NEVER park for approval under any gate: a
 * decomposition's output (`batch.yaml` change intents) is reviewed when each
 * authored change's propose parks, and a PR is itself the human checkpoint
 * (review happens on the PR). An `undefined` gate defaults to `voluntary`
 * (the config default), so a manifest/config that omits the key parks nothing.
 */

import type { Gate } from '../config.js';
import type { StepKind } from './contract.js';

/** The per-change transitions the `every-phase` gate parks. */
const EVERY_PHASE_PARKED: ReadonlySet<StepKind> = new Set([
  'propose',
  'apply',
  'verify',
]);

/**
 * Should a completed `transition` park as `awaiting-approval` under `gate`?
 *
 * Pure over its inputs. `undefined` gate defaults to `voluntary` (parks
 * nothing). Only `propose`/`apply`/`verify` can ever park; `decompose` and
 * `pr` step kinds always return `false` under every gate (see module docs).
 */
export function parksForApproval(
  gate: Gate | undefined,
  transition: StepKind
): boolean {
  const resolved = gate ?? 'voluntary';
  if (resolved === 'voluntary' || resolved === 'autonomous') return false;
  if (resolved === 'after-propose') return transition === 'propose';
  // every-phase parks every completed change transition; decompose/pr never park.
  return EVERY_PHASE_PARKED.has(transition);
}
