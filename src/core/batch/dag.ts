/**
 * Batch DAG
 *
 * The `after` edges on change intents form a dependency graph per phase. This
 * module reuses the same Kahn's-algorithm topological-sort and ready/blocked
 * logic as `ArtifactGraph` (`src/core/artifact-graph/graph.ts`), adapted to
 * change intents, and adds cycle / unknown-reference detection.
 *
 * Note on terminology: "done" here means a change intent the caller already
 * considers complete (derived on disk in `status.ts`). A node is `ready` when
 * all of its `after` dependencies are done; `blocked` when some are not.
 */

import type { ChangeIntent } from './manifest.js';

export class BatchDagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchDagError';
  }
}

export interface BatchDagResult {
  /** Topological order of change names (only meaningful when acyclic). */
  buildOrder: string[];
  /** Names with all dependencies done and not themselves done. */
  ready: string[];
  /** Map of blocked name -> unmet dependency names. */
  blocked: Record<string, string[]>;
}

/**
 * Build a per-phase DAG over change intents.
 *
 * @throws BatchDagError naming the offending entries on cycle or unknown
 *   reference.
 */
export class BatchDag {
  private readonly intents: Map<string, ChangeIntent>;

  constructor(intents: ChangeIntent[]) {
    this.intents = new Map();
    for (const intent of intents) {
      if (this.intents.has(intent.name)) {
        throw new BatchDagError(`Duplicate change intent: '${intent.name}'`);
      }
      this.intents.set(intent.name, intent);
    }
    this.validateReferences();
    // Eagerly compute build order so a cycle is reported even before any query.
    this.getBuildOrder();
  }

  static fromIntents(intents: ChangeIntent[]): BatchDag {
    return new BatchDag(intents);
  }

  /** Reject `after` edges that reference a name not in this batch. */
  private validateReferences(): void {
    for (const intent of this.intents.values()) {
      for (const dep of intent.after) {
        if (!this.intents.has(dep)) {
          throw new BatchDagError(
            `Change '${intent.name}' has an after edge to '${dep}', ` +
              `which is not a batch entry (unknown reference)`
          );
        }
      }
    }
  }

  /**
   * Kahn's-algorithm topological order. Throws naming the cycle members when
   * the graph is cyclic.
   */
  getBuildOrder(): string[] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const intent of this.intents.values()) {
      inDegree.set(intent.name, intent.after.length);
      dependents.set(intent.name, []);
    }

    for (const intent of this.intents.values()) {
      for (const dep of intent.after) {
        dependents.get(dep)!.push(intent.name);
      }
    }

    const queue = [...this.intents.keys()]
      .filter((name) => inDegree.get(name) === 0)
      .sort();

    const result: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const newlyReady: string[] = [];
      for (const dep of dependents.get(current)!) {
        const newDegree = inDegree.get(dep)! - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          newlyReady.push(dep);
        }
      }
      queue.push(...newlyReady.sort());
    }

    if (result.length !== this.intents.size) {
      const cycleMembers = [...this.intents.keys()]
        .filter((name) => !result.includes(name))
        .sort();
      throw new BatchDagError(
        `Cycle detected in after edges involving: ${cycleMembers.join(', ')}`
      );
    }

    return result;
  }

  /** Names whose dependencies are all done, excluding done names themselves. */
  getReady(done: ReadonlySet<string>): string[] {
    const ready: string[] = [];
    for (const intent of this.intents.values()) {
      if (done.has(intent.name)) continue;
      if (intent.after.every((dep) => done.has(dep))) {
        ready.push(intent.name);
      }
    }
    return ready.sort();
  }

  /** Map of blocked name -> unmet (not-done) dependency names. */
  getBlocked(done: ReadonlySet<string>): Record<string, string[]> {
    const blocked: Record<string, string[]> = {};
    for (const intent of this.intents.values()) {
      if (done.has(intent.name)) continue;
      const unmet = intent.after.filter((dep) => !done.has(dep));
      if (unmet.length > 0) {
        blocked[intent.name] = unmet.sort();
      }
    }
    return blocked;
  }

  compute(done: ReadonlySet<string>): BatchDagResult {
    return {
      buildOrder: this.getBuildOrder(),
      ready: this.getReady(done),
      blocked: this.getBlocked(done),
    };
  }
}
