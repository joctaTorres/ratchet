/**
 * The starter invariant manifest `ratchet init` scaffolds at
 * `.ratchet/evals/invariants.yaml` for a project that has none yet.
 *
 * `buildDefaultInvariantManifestYaml` is a pure function (project root in,
 * manifest text out) composed of four blocks:
 *
 *   - `spec-not-weakened` (monotonic, `scenario-count`) — always present and
 *     **active**. It is the one invariant ratchet can evaluate on every
 *     project unconditionally: the measure comes from ratchet's own run
 *     state, not anything stack-specific.
 *   - `tests-still-exist` (deterministic) — always **inert**. Emitted as live,
 *     uncommented YAML (ready to flip to `active: true`) when
 *     `detectTestDirectory` finds a conventional test directory; emitted as a
 *     commented placeholder otherwise.
 *   - `mutants-are-killed` (mutation) — always **inert**, gated on the same
 *     `detectedDir` signal as `tests-still-exist`. Emitted as live,
 *     uncommented YAML with placeholder `test`/`budget`/`threshold` values
 *     when a conventional test directory is detected (a detected suite is
 *     evidence there is an oracle for the harness to run); emitted as a
 *     commented placeholder otherwise.
 *   - `public-api-unchanged` (snapshot) — always **inert** and always a
 *     commented placeholder. No `produce.run` ratchet could pick is
 *     generalizable across stacks, so this entry is never live YAML.
 *
 * The manifest mixes live YAML with commented placeholder blocks for the same
 * logical invariant, which a typed-object YAML serializer cannot produce, so
 * the builder composes the file as a template string instead of
 * round-tripping `Invariant` objects.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/** Conventional test-directory names, checked in this order; first match wins. */
const CONVENTIONAL_TEST_DIRS = ['test', 'tests', 'spec', '__tests__'];

/**
 * The only "stack detection" this slice does: directory-existence under the
 * project root, not language or tool sniffing. Returns the first conventional
 * name found, or `null` if none exist.
 */
export function detectTestDirectory(projectRoot: string): string | null {
  return CONVENTIONAL_TEST_DIRS.find((dir) => existsSync(path.join(projectRoot, dir))) ?? null;
}

function testsStillExistBlock(detectedDir: string | null): string {
  if (detectedDir) {
    return `  - id: tests-still-exist
    kind: deterministic
    active: false
    description: A conventional test directory was detected. Flip active to true once you are ready to gate on it.
    check:
      run: "test -d ${detectedDir}"
      pass: exit-zero
`;
  }
  return `  # No conventional test directory (test, tests, spec, __tests__) was found.
  # Once your project has one, uncomment and adjust the directory below, then
  # flip active to true when you are ready to gate on it.
  # - id: tests-still-exist
  #   kind: deterministic
  #   active: false
  #   check:
  #     run: "test -d <your-test-directory>"
  #     pass: exit-zero
`;
}

function mutationScaffoldBlock(detectedDir: string | null): string {
  if (detectedDir) {
    return `  - id: mutants-are-killed
    kind: mutation
    active: false
    description: A conventional test directory was detected. Fill in the test command below, then flip active to true once you are ready to gate on it.
    test: "<command that runs your test suite>"
    budget: 5
    threshold: 3
`;
  }
  return `  # No conventional test directory (test, tests, spec, __tests__) was found.
  # Once your project has a test suite, uncomment and fill in the command below,
  # then flip active to true when you are ready to gate on it.
  # - id: mutants-are-killed
  #   kind: mutation
  #   active: false
  #   test: "<command that runs your test suite>"
  #   budget: 5
  #   threshold: 3
`;
}

function publicApiUnchangedBlock(): string {
  return `  # public-api-unchanged needs a command that emits your project's current
  # public API surface, to diff against a checked-in golden. Ratchet cannot
  # pick one without assuming a stack, so this is always a placeholder for you
  # to author and turn on — pick the shape that fits your stack, for example a
  # TypeScript declaration diff, a Rust public-API diff, a Go API dump, or a
  # Python stub diff:
  # - id: public-api-unchanged
  #   kind: snapshot
  #   active: false
  #   golden: .ratchet/evals/golden/public-api.txt
  #   produce:
  #     run: "<command that prints your project's current public API surface>"
`;
}

/**
 * Compose the starter `invariants.yaml` text for `projectRoot`. Pure: no
 * filesystem write happens here (the caller, `InitCommand`, decides whether
 * to write).
 */
export function buildDefaultInvariantManifestYaml(projectRoot: string): string {
  const detectedDir = detectTestDirectory(projectRoot);
  return `# Anti-gaming invariant manifest, scaffolded by \`ratchet init\`.
#
# Each invariant is one of four kinds:
#   deterministic — an absolute predicate (a command that must pass)
#   monotonic     — a named measure that must not decrease vs. the baseline run
#   snapshot      — current output diffed against a checked-in golden
#   mutation      — a seeded fault that must be killed by your own test suite
#
# Only invariants with \`active: true\` gate a run. See docs/eval-invariants.md
# for the full schema and the run-level gate this manifest feeds.
invariants:
  - id: spec-not-weakened
    kind: monotonic
    active: true
    description: The eval set must never shrink; scenario count must stay non-decreasing vs. the baseline run.
    measure: scenario-count

${testsStillExistBlock(detectedDir)}
${mutationScaffoldBlock(detectedDir)}
${publicApiUnchangedBlock()}`;
}
