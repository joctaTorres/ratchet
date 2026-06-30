/**
 * Shared tmpdir fixture for the `test/commands/eval/` integration tests.
 *
 * Mirrors the `prepareProject` helper in `test/cli-e2e/eval.test.ts` but at the
 * command-verb layer: each test builds an isolated repo under
 * `fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree it
 * exercises (a feature-store `.feature`, an eval `specs/*.yaml` binding, a
 * project `config.yaml`, and/or a run persisted via the core `persistRun`
 * helper), and removes it in `afterEach` so nothing is left behind (see the
 * `testing` standard: fixture isolation, no real-repo dependence, order
 * independence). The eval verbs are pointed at the fixture by mocking
 * `resolveCurrentPlanningHomeSync` to return `{ root }`.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/** A feature-store file with one check-bindable scenario and one left unbound. */
export const TWO_CASE_FEATURE = `Feature: Status
  Scenario: Status as JSON
    Given a project
    When I run status
    Then it prints JSON

  Scenario: Status as text
    Given a project
    Then it prints text
`;

/** Case ids derived from {@link TWO_CASE_FEATURE} at `features/cli/status.feature`. */
export const CASE_JSON = 'features/cli/status#status-as-json';
export const CASE_TEXT = 'features/cli/status#status-as-text';

/** A spec binding the `status-as-json` case to a deterministic check. */
export const CHECK_SPEC = `${CASE_JSON}:
  fixture: status-ok
  kind: check
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
`;

export class EvalFixture {
  constructor(readonly root: string) {}

  /** Write a file (creating parent dirs) at a path relative to the repo root. */
  async write(rel: string, content: string): Promise<void> {
    const file = path.join(this.root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');
  }

  /** Write a `.feature` under the permanent feature store. */
  writeFeature(rel: string, content: string): Promise<void> {
    return this.write(path.join('.ratchet', 'features', rel), content);
  }

  /** Write an eval spec file under `.ratchet/evals/specs/`. */
  writeSpec(name: string, yaml: string): Promise<void> {
    return this.write(path.join('.ratchet', 'evals', 'specs', name), yaml);
  }

  /** Write the project `config.yaml`. */
  writeConfig(yaml: string): Promise<void> {
    return this.write(path.join('.ratchet', 'config.yaml'), yaml);
  }

  async cleanup(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

/** Build an isolated fixture repo with an empty `.ratchet/` tree. */
export async function makeEvalFixture(prefix = 'ratchet-eval-cmd-'): Promise<EvalFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, '.ratchet'), { recursive: true });
  return new EvalFixture(root);
}
