/**
 * Jury configuration and resolution.
 *
 * A `jury` block (`votes`, `quorum`) decides how many independent rubric votes
 * the `llm-judge` contributor casts for a case and what agreement among those
 * votes is required to land a definitive verdict. `JurySchema` is the single
 * shape both the project-level default (`eval.jury` in `.ratchet/config.yaml`)
 * and a per-binding override (`LlmJudgeBinding.jury`) validate against, mirroring
 * how `gate.ts` shapes the project-default/per-call-override pattern for
 * `eval.gate`. `resolveJury` is a pure, field-by-field layering of binding over
 * config over the built-in default — no filesystem, no spawn.
 *
 * `panel` is a reserved, validated-but-inert slot for a future cross-family
 * panel (a jury whose votes come from more than one contributor family). It
 * round-trips through `JurySchema` for validation only; `resolveJury` and vote
 * resolution never read it.
 */

import { z } from 'zod';

export const QuorumSchema = z.enum(['majority', 'unanimous']);
export type Quorum = z.infer<typeof QuorumSchema>;

/** Reserved, validated-but-inert slot for a future cross-family panel. */
const PanelSchema = z.object({
  families: z.array(z.string().min(1)).min(1),
});

export const JurySchema = z.object({
  /** Number of repeat votes to cast. */
  votes: z.number().int().positive().optional(),
  /** Agreement required among cast votes to land a definitive verdict. */
  quorum: QuorumSchema.optional(),
  panel: PanelSchema.optional(),
});

export type Jury = z.infer<typeof JurySchema>;

/** The fully-resolved jury settings a case is judged under. */
export interface ResolvedJury {
  votes: number;
  quorum: Quorum;
}

const DEFAULT_VOTES = 1;
const DEFAULT_QUORUM: Quorum = 'majority';

/**
 * Resolve effective jury settings: a per-binding override layered over a
 * project-level default layered over the built-in default (`votes: 1, quorum:
 * 'majority'`), each field resolved independently so a binding may override
 * just one field while still inheriting the other from the project default.
 */
export function resolveJury({ config, binding }: { config?: Jury; binding?: Jury }): ResolvedJury {
  return {
    votes: binding?.votes ?? config?.votes ?? DEFAULT_VOTES,
    quorum: binding?.quorum ?? config?.quorum ?? DEFAULT_QUORUM,
  };
}
