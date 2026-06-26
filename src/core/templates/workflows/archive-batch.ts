/**
 * Archive-batch guided workflow skill + command templates.
 *
 * `/rct:archive-batch` closes a batch's lifecycle: it reports the derived batch
 * status to the user and invokes `ratchet batch archive <name>`, which cascades
 * the change-archive flow over every member change (feature-store + standard-link
 * materialization) and then moves the batch directory under
 * `.ratchet/batches/archive/`. The workflow itself NEVER moves directories by
 * hand — the cascade and the move belong to the CLI.
 *
 * The body is authored once here and shared by both the skill and the command
 * templates, agent-neutral ("your agent") so it renders for every registered
 * adapter, with a plain-prose fallback for any structured-question step.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const ARCHIVE_BATCH_BODY = `Archive a completed Ratchet batch — the terminal lifecycle step that closes a
batch so it stops cluttering the active batch list. \`ratchet batch archive\`
cascades the change-archive flow over every member change (materializing each
change's features into the permanent store and its standard links), then moves
the batch directory (manifest + run journal) to
\`.ratchet/batches/archive/<YYYY-MM-DD>-<name>/\`.

**Your role:** report status and run the CLI. The cascade and the directory move
are the CLI's job — you (the coding agent) never move directories by hand and
never hand-edit \`.ratchet\` artifacts. Your only actions are \`ratchet\` CLI
commands and messages to the user.

**Input**: Optionally specify a batch name (e.g., \`/rct:archive-batch q3-auth\`).
If omitted, infer from context or, if a single batch exists, use it. If ambiguous,
run \`ratchet batch list --json\` and ask which batch to archive.

**Steps**

1. **Select the batch**
   - If a name is given, use it. Otherwise infer from context or auto-select the
     sole batch.
   - If more than one batch exists and none is named, run
     \`ratchet batch list --json\` and ask the user which batch to archive — use a
     structured-question tool such as AskUserQuestion if your agent has one,
     otherwise ask in plain prose.
   - Announce: "Archiving batch: <name>" and how to override
     (\`/rct:archive-batch <other>\`).

2. **Report the derived batch status to the user**
   \`\`\`bash
   ratchet batch status "<name>" --json
   \`\`\`
   Parse the phases and change statuses and translate them into a brief
   human-readable summary: how many changes are done, and which (if any) are not
   yet done. A batch is ready to archive when every change is \`done\`.

3. **Gate on completeness**
   - **All changes done** → proceed; archiving is safe.
   - **Not all done** (any change in-progress, blocked, or parked) → tell the user
     exactly which changes are incomplete and confirm they still want to archive
     (this shelves an unfinished batch). Use a structured-question tool such as
     AskUserQuestion if your agent has one, otherwise ask in plain prose:
     > "This batch has incomplete changes (<names>). Archive it anyway?"
     Proceed only if the user confirms.

4. **Invoke the cascading archive command**
   \`\`\`bash
   ratchet batch archive "<name>"
   \`\`\`
   Add \`--yes\` to skip the incomplete-batch confirmation prompt when archiving a
   not-yet-done batch non-interactively (e.g. you already confirmed with the user).
   This single command:
   - Runs the change-archive flow for each member change in phase order
     (feature-store materialization + standard-link materialization + move to
     \`changes/archive/\`). Already-archived and never-created (pending) intents are
     skipped without error.
   - Moves the batch directory to
     \`.ratchet/batches/archive/<YYYY-MM-DD>-<name>/\`.

   Let the command do the cascade and the move — do **not** \`mv\` anything yourself.

5. **Summarize**
   Report: which member changes were archived (and any skipped), and the batch's
   archive location.

**Output On Success**

\`\`\`
## Batch Archive Complete

**Batch:** <name>
**Member changes archived:** <list>
**Archived to:** batches/archive/<YYYY-MM-DD>-<name>/
\`\`\`

**Guardrails**
- You never move directories by hand and never hand-edit \`.ratchet\` artifacts —
  only \`ratchet\` CLI commands and user communication.
- Report the derived batch status before archiving.
- Archiving a not-yet-done batch is gated: confirm first, then pass \`--yes\`.
- The cascade is idempotent — re-running skips already-archived changes.`;

export function getArchiveBatchSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-archive-batch',
    description:
      'Archive a completed Ratchet batch: report the derived batch status, then run `ratchet batch archive` to cascade the change-archive flow over every member change and move the batch under the archive. Use when a batch is done (or the user wants to shelve one) — the workflow drives the CLI and never moves directories by hand.',
    instructions: ARCHIVE_BATCH_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; pairs with the batch workflow.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctArchiveBatchCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Archive Batch',
    description: 'Archive a completed batch: cascade change-archive over its members and move it (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'archive-batch', 'experimental'],
    content: ARCHIVE_BATCH_BODY,
  };
}
