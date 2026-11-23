import { describe, it, expect } from 'vitest';
import {
  getSkillTemplates,
  getCommandContents,
  generateSkillContent,
} from '../../../src/core/shared/skill-generation.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';

/**
 * Scenario-safe archive accept flow: the rendered archive skill and command
 * bodies, for every registered agent, run `ratchet archive` so the scenario
 * guard engages (first attempt without `-y`, never with
 * `--accept-removed-scenarios`), surface a scenario-loss refusal to the user
 * naming each lost scenario and its store file as listed, ask whether the
 * removal is intentional in the capability-plus-fallback form, retry with
 * `--accept-removed-scenarios` only on explicit user approval (never on the
 * agent's own initiative), and present the `features/.deleted` tombstone as
 * the intentional whole-file-removal route with a plain re-run.
 *
 * Store-seeded feature authoring: the rendered propose skill and command
 * bodies, for every registered agent, read the capability's existing store
 * files under `.ratchet/features/<capability>/` before authoring each feature
 * file (never adding a scenario that already exists in another store file of
 * the capability), start each feature file from the existing store file at
 * its store-relative path (copy and edit, never from scratch) so store
 * scenarios are preserved by construction, and author new only when the store
 * has no file at that path.
 *
 * Batch-archive guard halt: the rendered archive-batch skill and command
 * bodies, for every registered agent, state that a scenario-loss refusal halts
 * the cascade at the offending member change, direct the agent to report the
 * trip to the user and stop (naming the member change and each lost scenario
 * and its store file exactly as the refusal lists them), state the batch
 * directory stays in place and the cascade is re-runnable skipping
 * already-archived members, ask the user how to resolve the offending member
 * (accept-flag archive or `features/.deleted` tombstone) in the
 * capability-plus-fallback form, route intentional removal through the
 * member's own archive flow, and forbid passing `--accept-removed-scenarios`
 * on the agent's own initiative.
 *
 * This is the phase's shared rendered-output test: each scenario-safe-archive
 * phase change appends its own assertions here.
 *
 * Mirrors:
 * - features/archive-change/skill-accept-flow.feature
 * - features/propose/store-seeded-features.feature
 * - features/batch-archive/guard-halt.feature
 */

/**
 * Split a rendered body into prose windows: blank-line-separated paragraphs
 * with internal newlines collapsed to single spaces, so a line-wrapped
 * sentence reads as one window.
 */
function proseWindows(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * Accept-flow predicate over a rendered archive body. Returns a list of
 * violation descriptions; an empty list means the body carries every element
 * of the scenario-loss accept flow.
 *
 * A body in the pre-change shape — the first (and only) archive attempt
 * `ratchet archive "<name>" -y`, the "inform and confirm, then pass `-y`"
 * guardrail, and no scenario-loss refusal handling — fails here on every
 * dimension.
 */
function findAcceptFlowViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');
  const windows = proseWindows(body);

  // 1. The first archive attempt runs plain: no `-y`, never
  //    `--accept-removed-scenarios`, so the CLI's confirmations and the
  //    scenario-loss guard surface instead of being pre-approved.
  const cmdLines = body
    .split('\n')
    .filter((l) => l.includes('ratchet archive "<name>"'));
  if (cmdLines.length === 0) {
    violations.push(
      'first-attempt: no `ratchet archive "<name>"` command line in the body',
    );
  } else {
    const first = cmdLines[0];
    if (/(^|\s)-y(\s|$)/.test(first)) {
      violations.push(
        'first-attempt: the first `ratchet archive "<name>"` command line passes `-y`',
      );
    }
    if (first.includes('--accept-removed-scenarios')) {
      violations.push(
        'first-attempt: the first `ratchet archive "<name>"` command line passes `--accept-removed-scenarios`',
      );
    }
  }
  if (/then pass `-y`/i.test(flat)) {
    violations.push(
      'first-attempt: the "inform and confirm, then pass `-y`" guardrail keeps `-y` as the default posture (pre-change shape)',
    );
  }

  // 2. The refusal is recognized by its output shape and each lost scenario
  //    and its store file is named back exactly as listed.
  if (!/Refusing to apply features:.*store scenario\(s\) would be lost/i.test(flat)) {
    violations.push(
      'refusal-shape: the guard refusal output shape ("Refusing to apply features: N store scenario(s) would be lost." plus the per-file list) is not shown',
    );
  }
  if (!/name each lost scenario and its store file/i.test(flat)) {
    violations.push(
      'name-lost: the body does not direct the agent to name each lost scenario and its store file',
    );
  }
  if (!/exactly as (the refusal|it) lists/i.test(flat)) {
    violations.push(
      'name-lost: the naming is not pinned to the refusal listing ("exactly as the refusal lists")',
    );
  }

  // 3. The user is asked whether the removal is intentional, in the
  //    capability-plus-fallback form.
  const askWindow = windows.find((w) =>
    /whether the removal is intentional/i.test(w),
  );
  if (!askWindow) {
    violations.push(
      'ask-user: the body does not ask the user whether the removal is intentional',
    );
  } else {
    if (!/if your agent has one/i.test(askWindow)) {
      violations.push(
        'ask-user: the ask lacks the optional-capability qualifier ("if your agent has one")',
      );
    }
    if (!/otherwise\b/i.test(askWindow)) {
      violations.push(
        'ask-user: the ask lacks the plain-prose fallback ("otherwise …")',
      );
    }
  }

  // 4. The `--accept-removed-scenarios` retry exists and is gated on explicit
  //    user approval — never on the agent's own initiative.
  if (!body.includes('ratchet archive "<name>" --accept-removed-scenarios')) {
    violations.push(
      'gated-retry: no `ratchet archive "<name>" --accept-removed-scenarios` retry command in the body',
    );
  }
  if (!/only after the user explicitly confirms/i.test(flat)) {
    violations.push(
      'gated-retry: the `--accept-removed-scenarios` retry is not gated on explicit user confirmation',
    );
  }
  if (!/never\b[^.]{0,80}\bown initiative/i.test(flat)) {
    violations.push(
      'gated-retry: the body does not forbid passing `--accept-removed-scenarios` on the agent\'s own initiative',
    );
  }

  // 5. The `features/.deleted` tombstone is presented as the intentional
  //    whole-file-removal route: store-relative path, plain re-run, no flag.
  const tombstoneWindow = windows.find(
    (w) =>
      /features\/\.deleted/.test(w) &&
      /store-relative path/i.test(w) &&
      /re-run plain/i.test(w) &&
      /no flag/i.test(w),
  );
  if (!tombstoneWindow) {
    violations.push(
      'tombstone: the `features/.deleted` tombstone route (store-relative path, plain re-run, no flag) is missing',
    );
  }

  return violations;
}

describe('scenario-safe archive accept flow', () => {
  describe('the accept-flow predicate', () => {
    it('rejects the pre-change body shape (archiving with -y, no scenario-loss handling)', () => {
      // The pre-change ARCHIVE_BODY shape: the only archive attempt carries
      // `-y`, the guardrail makes `-y` the default posture, and no
      // scenario-loss refusal flow exists.
      const preChangeBody = [
        '4. **Run the archive command**',
        '',
        '   ```bash',
        '   ratchet archive "<name>" -y',
        '   ```',
        '',
        '   This single command:',
        '   - Validates the plan (informative) and the feature files (blocking on ERROR)',
        '   - Copies each `features/<rel>.feature` into `.ratchet/features/<rel>` (add or overwrite by relative path), and applies `features/.deleted` removals',
        '',
        '**Guardrails**',
        "- Don't block archive on warnings - inform and confirm, then pass `-y`",
      ].join('\n');
      const violations = findAcceptFlowViolations(preChangeBody);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => v.startsWith('first-attempt:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('refusal-shape:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('name-lost:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('ask-user:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('gated-retry:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('tombstone:'))).toBe(true);
    });

    it('rejects a plain first attempt with no refusal handling', () => {
      const body = [
        '4. **Run the archive command**',
        '',
        '   ```bash',
        '   ratchet archive "<name>"',
        '   ```',
      ].join('\n');
      const violations = findAcceptFlowViolations(body);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => v.startsWith('first-attempt:'))).toBe(false);
      expect(violations.some((v) => v.startsWith('refusal-shape:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('gated-retry:'))).toBe(true);
    });

    it('rejects a refusal flow whose flag retry is not approval-gated', () => {
      const body = [
        '```bash',
        'ratchet archive "<name>"',
        '```',
        '',
        'On a refusal output of the shape "Refusing to apply features: 1 store scenario(s) would be lost.", name each lost scenario and its store file exactly as the refusal lists them.',
        '',
        'Ask the user whether the removal is intentional — use a structured-question capability such as AskUserQuestion if your agent has one, otherwise ask in plain prose.',
        '',
        '```bash',
        'ratchet archive "<name>" --accept-removed-scenarios',
        '```',
        '',
        'For a whole-file removal, list the store-relative path in `features/.deleted` and re-run plain `ratchet archive "<name>"` — no flag needed.',
      ].join('\n');
      const violations = findAcceptFlowViolations(body);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => v.startsWith('gated-retry:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('first-attempt:'))).toBe(false);
      expect(violations.some((v) => v.startsWith('ask-user:'))).toBe(false);
    });

    it('accepts a well-formed accept-flow body', () => {
      const body = [
        '```bash',
        'ratchet archive "<name>"',
        '```',
        '',
        'The refusal output has this shape: "Refusing to apply features: N store scenario(s) would be lost." followed by each store file and its lost scenario names.',
        '',
        'When you see this refusal: name each lost scenario and its store file back to the user exactly as the refusal lists them. Ask the user whether the removal is intentional — use a structured-question capability such as AskUserQuestion if your agent has one, otherwise ask in plain prose.',
        '',
        'Only after the user explicitly confirms the removal is intentional, retry once with the flag:',
        '',
        '```bash',
        'ratchet archive "<name>" --accept-removed-scenarios',
        '```',
        '',
        'Never pass `--accept-removed-scenarios` on your own initiative, and never on the first attempt. If the intent is to remove a whole feature file from the store, list the store-relative path in the change\'s `features/.deleted` file and re-run plain `ratchet archive "<name>"` — no flag needed.',
      ].join('\n');
      expect(findAcceptFlowViolations(body)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the archive skill template for every registered agent with the full accept flow', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const archiveSkills = getSkillTemplates(['archive']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(archiveSkills.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of archiveSkills) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findAcceptFlowViolations(content),
            `skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the archive command template through every registered adapter with the full accept flow', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const archiveCommands = getCommandContents(['archive']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(archiveCommands.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of archiveCommands) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findAcceptFlowViolations(fileContent),
            `command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});

/**
 * Store-seeding predicate over a rendered propose body. Returns a list of
 * violation descriptions; an empty list means the body carries every element
 * of the store-seeded feature-authoring instruction.
 *
 * A body in the pre-change shape — step 5a authors each feature file from the
 * template with no store read and no store-file seeding — fails here on every
 * dimension.
 */
function findStoreSeedingViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. The capability's existing store files are read before authoring each
  //    feature file.
  if (
    !/before authoring each feature file:\s*read the capability's existing store files under `\.ratchet\/features\/<capability>\/`/i.test(
      flat,
    )
  ) {
    violations.push(
      'store-read: the body does not direct reading the capability\'s existing store files under `.ratchet/features/<capability>/` before authoring each feature file',
    );
  }

  // 2. A scenario that already exists in another store file of the capability
  //    is never added again.
  if (
    !/never add a scenario that already exists in another store file of the capability/i.test(
      flat,
    )
  ) {
    violations.push(
      'no-duplicate: the body does not forbid adding a scenario that already exists in another store file of the capability',
    );
  }

  // 3. When a store file exists at the file's store-relative path, the feature
  //    file starts from it: copy it into the change and edit the copy.
  if (!/store file already exists at the file's store-relative path/i.test(flat)) {
    violations.push(
      'copy-edit-start: the store-file-exists condition (at the file\'s store-relative path) is missing',
    );
  }
  if (
    !/start the feature file from that store file/i.test(flat) ||
    !/copy it into the change and edit the copy/i.test(flat)
  ) {
    violations.push(
      'copy-edit-start: the body does not direct starting the feature file from the store file by copying it into the change and editing the copy',
    );
  }

  // 4. Authoring from scratch when a store file exists is forbidden.
  if (!/never author it from scratch/i.test(flat)) {
    violations.push(
      'never-from-scratch: the body does not forbid authoring the file from scratch',
    );
  }

  // 5. The stated purpose: existing store scenarios are preserved by
  //    construction.
  if (!/existing store scenarios are preserved by construction/i.test(flat)) {
    violations.push(
      'preserved-by-construction: the preserved-by-construction purpose is missing',
    );
  }

  // 6. A feature file is authored new only when the store has no file at that
  //    path.
  if (!/author a feature file new only when the store has no file at that path/i.test(flat)) {
    violations.push(
      'author-new-only-when-absent: the author-new-only-when-absent allowance is missing',
    );
  }

  return violations;
}

/** The store-seeding bullet as it renders in the propose body (step 5a). */
const WELL_FORMED_SEEDING_BODY = [
  '   a. **For each artifact that is `ready` (dependencies satisfied)**:',
  '      - Read any completed dependency files for context',
  '      - For a `features` artifact, before authoring each feature file: read the',
  "        capability's existing store files under `.ratchet/features/<capability>/`",
  '        — never add a scenario that already exists in another store file of the',
  "        capability. When a store file already exists at the file's store-relative",
  '        path, start the feature file from that store file — copy it into the',
  '        change and edit the copy, never author it from scratch — so existing',
  '        store scenarios are preserved by construction. Author a feature file new',
  '        only when the store has no file at that path.',
  '      - Create the artifact file using `template` as the structure and write it to `resolvedOutputPath`',
].join('\n');

describe('store-seeded feature authoring in the propose body', () => {
  describe('the store-seeding predicate', () => {
    it('rejects the pre-change body shape (feature files authored from the template, no store read)', () => {
      // The pre-change step 5a shape: read dependencies, then author the file
      // from the template — no store read, no seeding.
      const preChangeBody = [
        '   a. **For each artifact that is `ready` (dependencies satisfied)**:',
        '      - Read any completed dependency files for context',
        '      - Create the artifact file using `template` as the structure and write it to `resolvedOutputPath`',
      ].join('\n');
      const violations = findStoreSeedingViolations(preChangeBody);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => v.startsWith('store-read:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('no-duplicate:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('copy-edit-start:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('never-from-scratch:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('preserved-by-construction:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('author-new-only-when-absent:'))).toBe(true);
    });

    it('rejects a seeding body that drops only the no-duplicate-scenario prohibition', () => {
      const body = WELL_FORMED_SEEDING_BODY.replace(
        ' — never add a scenario that already exists in another store file of the\n        capability.',
        '.',
      );
      const violations = findStoreSeedingViolations(body);
      expect(violations.some((v) => v.startsWith('no-duplicate:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('store-read:'))).toBe(false);
      expect(violations.some((v) => v.startsWith('copy-edit-start:'))).toBe(false);
    });

    it('accepts a well-formed store-seeding body', () => {
      expect(findStoreSeedingViolations(WELL_FORMED_SEEDING_BODY)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the propose skill template for every registered agent with the store-seeding instruction', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const proposeSkills = getSkillTemplates(['propose']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(proposeSkills.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of proposeSkills) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findStoreSeedingViolations(content),
            `skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the propose command template through every registered adapter with the store-seeding instruction', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const proposeCommands = getCommandContents(['propose']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(proposeCommands.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of proposeCommands) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findStoreSeedingViolations(fileContent),
            `command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});

/**
 * Batch-halt predicate over a rendered archive-batch body. Returns a list of
 * violation descriptions; an empty list means the body carries every element
 * of the scenario-loss halt guidance.
 *
 * A body in the pre-change shape — the cascade step invokes
 * `ratchet batch archive "<name>"` with no scenario-loss halt handling at all
 * — fails here on every dimension.
 */
function findBatchGuardHaltViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');
  const windows = proseWindows(body);

  // 1. The halt is stated: a scenario-loss refusal halts the cascade at the
  //    offending member change.
  if (!/halts the cascade at the offending member/i.test(flat)) {
    violations.push(
      'halt-stated: the body does not state that a scenario-loss refusal halts the cascade at the offending member change',
    );
  }

  // 2. The agent is directed to report the trip to the user and stop.
  if (!/report the trip to the user and stop/i.test(flat)) {
    violations.push(
      'report-stop: the body does not direct the agent to report the trip to the user and stop',
    );
  }

  // 3. The report names the member change and each lost scenario and its
  //    store file exactly as the refusal lists them.
  if (
    !/name the offending member change and each lost scenario and its store file exactly as the refusal lists/i.test(
      flat,
    )
  ) {
    violations.push(
      'name-exactly: the body does not pin the report to naming the member change and each lost scenario and its store file exactly as the refusal lists them',
    );
  }

  // 4. The batch directory stays in place and the cascade is re-runnable,
  //    skipping already-archived members.
  if (!/batch directory stays in place/i.test(flat)) {
    violations.push(
      'batch-in-place: the body does not state the batch directory stays in place',
    );
  }
  if (!/re-runnable/i.test(flat) || !/skips? already-archived members/i.test(flat)) {
    violations.push(
      'batch-in-place: the re-runnable-with-archived-members-skipped fact is missing',
    );
  }

  // 5. The user is asked how to resolve the offending member — the
  //    accept-flag archive or a `features/.deleted` tombstone — in the
  //    capability-plus-fallback form.
  const askWindow = windows.find((w) =>
    /ask the user how to resolve/i.test(w),
  );
  if (!askWindow) {
    violations.push(
      'ask-user: the body does not ask the user how to resolve the offending member',
    );
  } else {
    if (!askWindow.includes('--accept-removed-scenarios')) {
      violations.push(
        'ask-user: the ask does not offer archiving the member individually with `--accept-removed-scenarios`',
      );
    }
    if (!/features\/\.deleted/.test(askWindow)) {
      violations.push(
        'ask-user: the ask does not offer the `features/.deleted` tombstone route',
      );
    }
    if (!/if your agent has one/i.test(askWindow)) {
      violations.push(
        'ask-user: the ask lacks the optional-capability qualifier ("if your agent has one")',
      );
    }
    if (!/otherwise\b/i.test(askWindow)) {
      violations.push(
        'ask-user: the ask lacks the plain-prose fallback ("otherwise …")',
      );
    }
  }

  // 6. Intentional removal is routed through the offending member's own
  //    archive flow (`/rct:archive`), then the batch archive is re-run.
  if (!/through the offending member's own archive flow/i.test(flat)) {
    violations.push(
      'member-route: intentional removal is not routed through the offending member\'s own archive flow',
    );
  }
  // The canonical form `/rct:archive` is authored in the shared body; adapters
  // with hyphen-form invocation (opencode, gemini) render it as `/rct-archive`.
  if (!/\/rct[:-]archive(?!-batch)/.test(body)) {
    violations.push(
      'member-route: the canonical `/rct:archive` invocation for the member is missing',
    );
  }

  // 7. The agent never passes `--accept-removed-scenarios` on its own
  //    initiative.
  if (!/never\b[^.]{0,120}\bown initiative/i.test(flat)) {
    violations.push(
      'never-own-initiative: the body does not forbid passing `--accept-removed-scenarios` on the agent\'s own initiative',
    );
  }

  return violations;
}

describe('batch archive scenario-guard halt guidance', () => {
  describe('the batch-halt predicate', () => {
    it('rejects the pre-change body shape (no scenario-loss halt guidance) on every dimension', () => {
      // The pre-change ARCHIVE_BATCH_BODY cascade step: the command is invoked
      // and the cascade + skip semantics are described, but nothing covers a
      // scenario-loss refusal.
      const preChangeBody = [
        '4. **Invoke the cascading archive command**',
        '',
        '   ```bash',
        '   ratchet batch archive "<name>"',
        '   ```',
        '',
        '   Add `--yes` to skip the incomplete-batch confirmation prompt when archiving a',
        '   not-yet-done batch non-interactively (e.g. you already confirmed with the user).',
        '   This single command:',
        '   - Runs the change-archive flow for each member change in phase order',
        '     (feature-store materialization + standard-link materialization + move to',
        '     `changes/archive/`). Already-archived and never-created (pending) intents are',
        '     skipped without error.',
        '   - Moves the batch directory to',
        '     `.ratchet/batches/archive/<YYYY-MM-DD>-<name>/`.',
        '',
        '   Let the command do the cascade and the move — do **not** `mv` anything yourself.',
        '',
        '**Guardrails**',
        '- The cascade is idempotent — re-running skips already-archived changes.',
      ].join('\n');
      const violations = findBatchGuardHaltViolations(preChangeBody);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => v.startsWith('halt-stated:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('report-stop:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('name-exactly:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('batch-in-place:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('ask-user:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('member-route:'))).toBe(true);
      expect(violations.some((v) => v.startsWith('never-own-initiative:'))).toBe(true);
    });

    it('accepts a well-formed halt-guidance body', () => {
      const body = [
        '```bash',
        'ratchet batch archive "<name>"',
        '```',
        '',
        'A scenario-loss refusal halts the cascade at the offending member change: earlier members stay archived, the batch directory stays in place (it is NOT moved), and the cascade is re-runnable — a re-run skips already-archived members. When you see this refusal:',
        '',
        '- Report the trip to the user and stop. Name the offending member change and each lost scenario and its store file exactly as the refusal lists them — do not paraphrase, do not retry the batch archive.',
        '',
        '- Ask the user how to resolve the offending member: archive it individually with `--accept-removed-scenarios` (accepting the scenario removal) or remove the file intentionally by listing its store-relative path in the member change\'s `features/.deleted` tombstone — use a structured-question tool such as AskUserQuestion if your agent has one, otherwise ask in plain prose.',
        '',
        '- Route the user\'s choice through the offending member\'s own archive flow: invoke `/rct:archive` for that member change, then re-run `/rct:archive-batch` once the member is archived. Never retry the batch cascade with scenario losses accepted on your own initiative, and never pass `--accept-removed-scenarios` without explicit user approval.',
      ].join('\n');
      expect(findBatchGuardHaltViolations(body)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the archive-batch skill template for every registered agent with the full halt guidance', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const archiveBatchSkills = getSkillTemplates(['archive-batch']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(archiveBatchSkills.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of archiveBatchSkills) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findBatchGuardHaltViolations(content),
            `skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the archive-batch command template through every registered adapter with the full halt guidance', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const archiveBatchCommands = getCommandContents(['archive-batch']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(archiveBatchCommands.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of archiveBatchCommands) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findBatchGuardHaltViolations(fileContent),
            `command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});
