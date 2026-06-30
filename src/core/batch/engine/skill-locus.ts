/**
 * Skill-in-spawn-locus guarantee.
 *
 * Before the engine spawns a change-verb agent and (in the later changes of this
 * phase) tells it to invoke `/rct:<transition> <change>`, we must guarantee the
 * canonical rct command for that transition is ACTUALLY present in the locus
 * where the agent runs — otherwise we would instruct a headless agent to invoke
 * a skill that does not exist in its working tree (the risk the
 * `delegated-lifecycle` standard and the `rex-agent-runtime` batch flagged).
 *
 * This is the render-or-fail precondition only. Given the forced transition, the
 * configured spawn agent, and the spawn locus (the project root for
 * `local`/`docker`), it:
 *  - resolves the canonical rct command id (propose/apply/verify),
 *  - resolves the PER-AGENT command adapter from the command-generation registry
 *    (never hard-coding a single agent's path),
 *  - computes the command file path via `adapter.getFilePath(<id>)` under the
 *    locus,
 *  - if present → verifies and leaves the file untouched,
 *  - if absent → renders it from the SHARED command content
 *    (`getCommandContents` → `adapter.formatFile`) and writes it,
 *  - if the locus is one the engine cannot place files into (e.g. `remote`), or
 *    the render/write fails → throws an actionable {@link SkillLocusError}.
 *
 * Side effects (exists/write) go through an injectable {@link SkillLocusDeps}
 * seam so the logic is unit-testable without touching disk, mirroring
 * `rex-bootstrap.ts`.
 */

import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { CommandAdapterRegistry } from '../../command-generation/index.js';
import { getCommandContents } from '../../shared/skill-generation.js';
import { DEFAULT_AGENT } from './agent.js';
import type { ChangeStepContext, Transition } from './contract.js';
import type { BatchSettings, Locus } from '../config.js';

/**
 * The canonical rct command id for each forced transition, kept in ONE place so
 * propose → `/rct:propose`, apply → `/rct:apply`, verify → `/rct:verify` stay
 * aligned with the later prompt-delegation change. The mapping is identity today
 * (the command ids equal the transition names), but it is named explicitly so a
 * future rename of either side has a single edit point and cannot drift.
 */
const TRANSITION_COMMAND_ID: Readonly<Record<Transition, string>> = Object.freeze({
  propose: 'propose',
  apply: 'apply',
  verify: 'verify',
});

/** Resolve the canonical rct command id for a forced transition. */
export function rctCommandIdForTransition(transition: Transition): string {
  return TRANSITION_COMMAND_ID[transition];
}

/**
 * The canonical rct command id for the phase-decomposition step, kept in the SAME
 * single-source map style as {@link TRANSITION_COMMAND_ID} so the spawn-locus
 * guarantee and the agent invocation token (`/rct:decompose-phase`) resolve from
 * one place and cannot drift. Authoring a phase's concrete change intents from the
 * prior phase's shipped results is a distinct lifecycle operation, so it gets its
 * own command id rather than reusing a per-change transition's.
 */
export const DECOMPOSE_COMMAND_ID = 'decompose-phase';

/**
 * An actionable bootstrap failure: the engine could not guarantee the rct
 * command in the spawn locus. The message NAMES the missing command, the locus,
 * and the remedy, and NEVER instructs the agent to invoke a skill it cannot run.
 */
export class SkillLocusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillLocusError';
  }
}

/**
 * Injectable side-effect seam. Tests provide fakes so the guarantee can be
 * exercised without touching disk. The default impl creates parent directories
 * for the command file before writing it.
 */
export interface SkillLocusDeps {
  exists(p: string): boolean;
  writeText(p: string, content: string): void;
}

export const defaultSkillLocusDeps: SkillLocusDeps = {
  exists: (p) => existsSync(p),
  writeText: (p, content) => {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  },
};

/**
 * Loci the engine controls on disk from here, so it can render the command file
 * into the spawn cwd: `local` spawns directly in the project root; `docker` runs
 * in a container with the project root bind-mounted, so a file rendered into the
 * project root is visible to the agent. `remote` runs the agent in a remote
 * workdir over the REST API that the engine does NOT control on disk — it cannot
 * write the command there from here, so it cannot guarantee the skill.
 */
function engineControlsLocus(locus: Locus): boolean {
  return locus === 'local' || locus === 'docker';
}

/**
 * Resolve the absolute path of the rct command file under the spawn locus.
 * `getFilePath` is relative to the project root for repo-scoped agents and may be
 * absolute for global-scoped agents (e.g. Codex prompts under `~/.codex`), so an
 * absolute path is used verbatim and a relative one is joined under the root.
 */
function commandFilePath(adapterPath: string, projectRoot: string): string {
  return path.isAbsolute(adapterPath) ? adapterPath : path.join(projectRoot, adapterPath);
}

/**
 * Guarantee the rct command for `ctx.transition` is present in the spawn locus
 * for the configured spawn agent, rendering it from the shared command
 * definition when absent and verifying it when present. Throws
 * {@link SkillLocusError} — with an actionable message — when the locus is one
 * the engine cannot render into (e.g. `remote`) or when the render/write fails,
 * so the engine never spawns a delegation the agent cannot run.
 *
 * Pure except through `deps`: no spawn, no transition derivation. Thin wrapper
 * over {@link ensureCommandInSpawnLocus}: it resolves the per-change transition's
 * command id, then defers to the shared command-id guarantee so the change-scoped
 * propose/apply/verify path and the phase-scoped decomposition path share ONE
 * render-or-fail implementation.
 */
export function ensureSkillInSpawnLocus(
  ctx: ChangeStepContext,
  projectRoot: string,
  deps: SkillLocusDeps = defaultSkillLocusDeps
): void {
  ensureCommandInSpawnLocus(
    rctCommandIdForTransition(ctx.transition),
    ctx.settings,
    projectRoot,
    deps
  );
}

/**
 * Guarantee an arbitrary canonical rct command (`commandId`) is present in the
 * spawn locus for the configured spawn agent, rendering it from the shared
 * command definition when absent and verifying it when present. This is the
 * single render-or-fail implementation both the change-scoped transition
 * guarantee ({@link ensureSkillInSpawnLocus}) and the phase-scoped decomposition
 * spawn ({@link DECOMPOSE_COMMAND_ID}) route through, so no consumer hard-codes a
 * single agent's path or carries its own copy of the guarantee.
 *
 * Throws {@link SkillLocusError} — with an actionable message — when the locus is
 * one the engine cannot render into (e.g. `remote`) or when the render/write
 * fails, so the engine never spawns a delegation the agent cannot run. Pure
 * except through `deps`.
 */
export function ensureCommandInSpawnLocus(
  commandId: string,
  settings: BatchSettings,
  projectRoot: string,
  deps: SkillLocusDeps = defaultSkillLocusDeps
): void {
  const agentId = settings.agent ?? DEFAULT_AGENT;
  const locus: Locus = settings.locus ?? 'local';

  // Resolve the PER-AGENT command adapter from the command-generation registry.
  // Every batch-engine SPAWNABLE agent (BUILTIN_ADAPTERS: claude/codex/cursor/
  // gemini) has a matching command adapter here (the spawnable set ⊆ the
  // command-generation registry, enforced by the drift-guard invariant), so a
  // real spawn agent always resolves one. A missing adapter therefore only arises
  // for a SYNTHETIC agent injected solely as a spawn stand-in (e.g. a test fake or
  // a `RATCHET_BATCH_AGENT_CMD` override) that has no real command surface to
  // render — there is nothing to guarantee, so skip rather than fabricate a
  // command for an agent that has no command-adapter contract.
  const adapter = CommandAdapterRegistry.get(agentId);
  if (!adapter) {
    return;
  }

  // Render the invocation token the SAME way the spawn instructions do — through
  // the resolved adapter — so the operator message names the actual agent's
  // syntax (claude `/rct:<id>`, others `/rct-<id>`) rather than a hard-coded
  // `/rct:<id>` that misleads for a non-claude spawn agent.
  const invocation = adapter.getInvocation(commandId);

  const targetPath = commandFilePath(adapter.getFilePath(commandId), projectRoot);

  // A locus the engine does not control on disk (remote) cannot be guaranteed:
  // refuse here rather than spawn an agent that would be told to run a command
  // its working tree does not and cannot contain.
  if (!engineControlsLocus(locus)) {
    throw new SkillLocusError(
      `Cannot guarantee the rct '${commandId}' command (${invocation}) in the spawn ` +
        `locus: locus '${locus}' runs the agent in a remote workdir this engine does not ` +
        `control on disk, so the command file '${targetPath}' cannot be rendered there. ` +
        `Render the rct commands into the remote workspace before running, or set locus to ` +
        `'local' or 'docker' so the engine can render it. The agent is NOT spawned.`
    );
  }

  // Present → verify and leave untouched (do not re-render).
  if (deps.exists(targetPath)) {
    return;
  }

  // Absent → render from the SHARED command definition (one author of lifecycle
  // instructions), never a hand-authored engine-local copy.
  const content = getCommandContents([commandId]).find((c) => c.id === commandId);
  if (!content) {
    throw new SkillLocusError(
      `Cannot guarantee the rct '${commandId}' command (${invocation}) in the spawn ` +
        `locus '${locus}': no shared command definition exists for id '${commandId}'. This ` +
        `is an internal bootstrap error — the engine will not spawn an agent told to invoke ` +
        `a command it cannot render.`
    );
  }

  try {
    deps.writeText(targetPath, adapter.formatFile(content));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SkillLocusError(
      `Cannot guarantee the rct '${commandId}' command (${invocation}) in the spawn ` +
        `locus '${locus}': failed to render it to '${targetPath}'. Ensure the path is ` +
        `writable, then retry. The agent is NOT spawned. Detail: ${detail}`
    );
  }
}
