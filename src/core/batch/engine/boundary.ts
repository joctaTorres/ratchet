/**
 * PR group boundary detection.
 *
 * The single, authoritative home for "where are the PR groups and what
 * identifies each one?" Given the batch's ordered phases/changes and the
 * resolved `prGrouping` mode, `detectPrGroupBoundaries` returns the ordered list
 * of `PrGroupBoundary` objects that every Phase 3 consumer reads instead of
 * re-deriving boundary rules inline — the same single-home discipline that
 * `isChangeDone`/`hasJournaledPr` already enforce in `transition.ts`.
 *
 * This is a purely *structural* mapping over the batch's plan: the boundary set
 * is fixed by the phases/changes, not by how far the run has progressed. Runtime
 * completion is what a later consumer folds in to decide *when* a boundary fires
 * (matching `boundary.triggerChange`). Keeping this function structural is what
 * makes it pure — no filesystem, no journal, no agent spawn — and exhaustively
 * unit-testable over tiny in-memory inputs.
 */

import type { PrGrouping } from '../config.js';

export interface BoundaryPhase {
  name: string;
  /** Ordered change names within the phase. */
  changes: string[];
}

export interface BoundaryBatchState {
  /** The batch's stable name — the group identity for a whole-batch group. */
  name: string;
  /** Ordered phases, each with its ordered change names. */
  phases: BoundaryPhase[];
}

export type PrGroupKind = 'batch' | 'phase' | 'change';

export interface PrGroupBoundary {
  /** 0-based position in the ordered list — "group N" for stacked base. */
  index: number;
  kind: PrGroupKind;
  /** Stable identity: batch name, phase name, or change name. */
  groupId: string;
  /** Ordered change names whose combined diff this group's PR contains. */
  changes: string[];
  /** The group's last change — the completion the engine matches to fire it. */
  triggerChange: string;
}

/**
 * Map the batch's ordered phases/changes and the resolved grouping `mode` to the
 * ordered list of PR group boundaries, each carrying a stable group identity and
 * a contiguous 0-based index:
 *
 * - `off` → `[]` (no boundaries, no PR ever).
 * - `whole-batch` → exactly one `batch` boundary spanning every change in order,
 *   identity = batch name, trigger = the last change overall.
 * - `per-phase` → one `phase` boundary per phase that has ≥1 change, identity =
 *   phase name, members = the phase's changes, trigger = the phase's last change;
 *   empty phases are skipped.
 * - `per-change` → one `change` boundary per change across all phases in order,
 *   identity = change name, members = `[change]`, trigger = that change.
 *
 * An empty batch (no changes in any phase) yields `[]` under every mode. Indices
 * are assigned sequentially over the produced boundaries (after empty phases are
 * skipped), so they stay contiguous with no gap — precisely the "group N /
 * group N-1" ordering stacked-base selection consumes.
 *
 * Pure over its plain-data input: no filesystem access and no agent spawn.
 */
export function detectPrGroupBoundaries(
  batch: BoundaryBatchState,
  mode: PrGrouping
): PrGroupBoundary[] {
  if (mode === 'off') return [];

  const allChanges = batch.phases.flatMap((p) => p.changes);
  // Nothing to open a PR for: an empty batch yields no boundary under any mode.
  if (allChanges.length === 0) return [];

  switch (mode) {
    case 'whole-batch':
      return [
        {
          index: 0,
          kind: 'batch',
          groupId: batch.name,
          changes: allChanges,
          triggerChange: allChanges[allChanges.length - 1],
        },
      ];
    case 'per-phase': {
      const boundaries: PrGroupBoundary[] = [];
      for (const phase of batch.phases) {
        if (phase.changes.length === 0) continue; // skip empty phases
        boundaries.push({
          index: boundaries.length,
          kind: 'phase',
          groupId: phase.name,
          changes: phase.changes,
          triggerChange: phase.changes[phase.changes.length - 1],
        });
      }
      return boundaries;
    }
    case 'per-change':
      return allChanges.map((change, index) => ({
        index,
        kind: 'change',
        groupId: change,
        changes: [change],
        triggerChange: change,
      }));
  }
}
