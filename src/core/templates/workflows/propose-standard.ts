/**
 * Propose Standard Workflow
 *
 * Authors a project-level standard into the standards library
 * (`.ratchet/standards/<name>.md`). Unlike the change workflows, this writes
 * directly to the library and never creates a change.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const PROPOSE_STANDARD_BODY = `Author a new standard for this project's standards library.

A standard is a reusable guideline — testing, security, architecture, design, or any
concern — kept at \`.ratchet/standards/<name>.md\`. Standards are loaded automatically
by propose (so every plan bakes them in) and by verify (so every change is checked
against them). Authoring a standard does NOT create a change.

---

**Input**: The request may include the standard's concern or a name. If it is unclear
what the standard should enforce, ask before writing.

**Steps**

1. **Understand the standard**

   If the concern or its rules are unclear, ask the user to clarify — use a structured-question tool such as AskUserQuestion if your agent has one, otherwise ask in plain prose:
   > "What should this standard enforce? Name the concern (testing, security,
   > architecture, design, …) and the concrete guidelines it should require."

   Ask follow-ups until you can name the standard and list at least one concrete,
   checkable guideline.

2. **Derive a name**

   From the concern, derive a kebab-case file name (e.g. "testing", "api-security",
   "frontend-architecture"). This becomes \`.ratchet/standards/<name>.md\`.

3. **Confirm the standards directory exists**

   Standards live at \`.ratchet/standards/\` (created by \`ratchet init\`, a sibling of
   \`.ratchet/features/\` and \`.ratchet/changes/\`). If the directory is missing, the
   project may need \`ratchet init\` re-run; create the directory if needed.

4. **Check for an existing standard with that name**

   If \`.ratchet/standards/<name>.md\` already exists, ask whether to update it or pick a
   different name. Do NOT silently overwrite an authored standard.

5. **Write the standard**

   Get the canonical template — do not hand-write its structure:
   \`\`\`bash
   ratchet template standard
   \`\`\`
   Create \`.ratchet/standards/<name>.md\` following exactly the structure it prints
   (the same templates dir the other artifacts use, so the standard stays in sync with
   the schema).

   Fill in the \`tag\` frontmatter field with the standard's stable identifier — pick a
   short, unique kebab-case tag (usually the same as the file name) that no other
   standard in \`.ratchet/standards/\` already uses. Changes reference a standard by this
   tag, so it must stay unique across the library.

   Keep guidelines concrete and checkable: propose and verify reason over this prose,
   so vague aspirations ("write good code") are far less useful than specific rules
   ("every public function has a unit test covering its error path").

6. **Confirm**

   Show the path written and a one-line summary of what the standard enforces.

**Output**

- The standard file path (\`.ratchet/standards/<name>.md\`)
- A one-line summary of what it enforces
- A note: "This standard is now loaded automatically by /rct:propose and /rct:verify."

**Guardrails**
- Write ONLY to \`.ratchet/standards/<name>.md\`. Do not create a change directory.
- Never overwrite an existing standard without confirmation.
- Prefer concrete, verifiable guidelines over generic advice.`;

export function getRctProposeStandardSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-propose-standard',
    description:
      'Author a new project standard (testing, security, architecture, design, …) into the standards library. Use when the user wants a reusable guideline that propose and verify apply to every change.',
    instructions: PROPOSE_STANDARD_BODY,
    license: 'MIT',
    compatibility: 'Requires ratchet CLI.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctProposeStandardCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Propose Standard',
    description: 'Author a new project standard into the standards library',
    category: 'Workflow',
    tags: ['workflow', 'standards', 'experimental'],
    content: PROPOSE_STANDARD_BODY,
  };
}
