/**
 * `ratchet eval set [scope] [--json]`
 *
 * Enumerate eval cases (one per Scenario) from `.feature` files. Default scope
 * is the permanent feature store; `--changes` / `--change <name>` / `--path`
 * adjust it. Archive is never a source. Each case reports its binding status.
 */

import chalk from 'chalk';
import { enumerateEvalSet, loadEvalSpecs, resolveBinding } from '../../core/eval/index.js';
import { projectRoot, resolveScope, type ScopeFlags } from './shared.js';

export interface EvalSetOptions extends ScopeFlags {
  json?: boolean;
}

interface SetCaseView {
  id: string;
  feature: string;
  scenario: string;
  source: string;
  steps: { keyword: string; text: string }[];
  binding: 'check' | 'agent' | 'unbound';
}

export async function evalSetCommand(options: EvalSetOptions = {}): Promise<void> {
  const root = projectRoot();
  const scope = resolveScope(options);
  const cases = enumerateEvalSet(root, scope);
  const specs = loadEvalSpecs(root);

  const views: SetCaseView[] = cases.map((c) => {
    const bound = resolveBinding(specs, c.id);
    return {
      id: c.id,
      feature: c.feature,
      scenario: c.scenario,
      source: c.source,
      steps: c.steps.map((s) => ({ keyword: s.keyword, text: s.text })),
      binding: bound ? bound.binding.kind : 'unbound',
    };
  });

  if (options.json) {
    console.log(JSON.stringify({ scope, count: views.length, cases: views }, null, 2));
    return;
  }
  renderSet(views, scope.kind);
}

function renderSet(views: SetCaseView[], scopeKind: string): void {
  console.log(chalk.bold(`Eval set (${scopeKind}): ${views.length} case(s)`));
  for (const v of views) {
    const tag =
      v.binding === 'unbound'
        ? chalk.yellow('[unbound]')
        : chalk.green(`[${v.binding}]`);
    console.log(`  ${tag} ${v.id}`);
    console.log(chalk.dim(`         ${v.feature} › ${v.scenario}`));
  }
}
