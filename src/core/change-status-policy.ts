import type { ChangeMetadata } from './change-metadata/index.js';
import type { PlanningHome } from './planning-home.js';

export interface PlanningHomeSummary {
  kind: 'repo' | 'workspace';
  root: string;
  changesDir: string;
  defaultSchema: string;
  workspaceName?: string;
}

export interface AffectedAreasSummary {
  known: string[];
  unresolved: boolean;
  invalid: string[];
}

export interface ActionContext {
  mode: 'repo-local' | 'workspace-planning';
  sourceOfTruth: 'repo' | 'workspace-local';
  planningArtifacts: string[];
  linkedContext: Array<{ name: string }>;
  allowedEditRoots: string[];
  requiresAffectedAreaSelection: boolean;
  constraints: string[];
}

export interface ChangeStatusPolicyArtifact {
  id: string;
  status: 'done' | 'ready' | 'blocked';
}

export interface AffectedAreasInput {
  planningHome?: PlanningHome;
  metadata?: ChangeMetadata;
}

export interface ChangeNextStepsInput {
  changeName: string;
  planningHome?: PlanningHome;
  artifactStatuses: ChangeStatusPolicyArtifact[];
  affectedAreas?: AffectedAreasSummary;
  allArtifactsComplete: boolean;
}

export interface ActionContextInput {
  planningHome?: PlanningHome;
  projectRoot: string;
  artifactIds: string[];
}

export function summarizePlanningHome(
  planningHome: PlanningHome | undefined
): PlanningHomeSummary | undefined {
  if (!planningHome) {
    return undefined;
  }

  return {
    kind: planningHome.kind,
    root: planningHome.root,
    changesDir: planningHome.changesDir,
    defaultSchema: planningHome.defaultSchema,
  };
}

export function summarizeAffectedAreas(_input: AffectedAreasInput): AffectedAreasSummary | undefined {
  // Repo-local planning has no affected-area concept.
  return undefined;
}

export function buildActionContext(input: ActionContextInput): ActionContext {
  return {
    mode: 'repo-local',
    sourceOfTruth: 'repo',
    planningArtifacts: input.artifactIds,
    linkedContext: [],
    allowedEditRoots: [input.projectRoot],
    requiresAffectedAreaSelection: false,
    constraints: ['Repo-local change artifacts and implementation edits are scoped to this project.'],
  };
}

export function buildNextSteps(input: ChangeNextStepsInput): string[] {
  const readyArtifact = input.artifactStatuses.find((artifact) => artifact.status === 'ready');
  const steps: string[] = [];

  if (readyArtifact) {
    steps.push(
      `Run openspec instructions ${readyArtifact.id} --change "${input.changeName}" --json before writing that artifact.`
    );
  } else if (input.allArtifactsComplete) {
    steps.push('All planning artifacts are complete; review tasks before implementation.');
  }

  return steps;
}
