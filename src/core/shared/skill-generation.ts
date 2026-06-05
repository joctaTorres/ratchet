/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import {
  getApplyChangeSkillTemplate,
  getArchiveChangeSkillTemplate,
  getVerifyChangeSkillTemplate,
  getRctProposeSkillTemplate,
  getRctApplyCommandTemplate,
  getRctArchiveCommandTemplate,
  getRctVerifyCommandTemplate,
  getRctProposeCommandTemplate,
  type SkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';

/**
 * Skill template with directory name and workflow ID mapping.
 */
export interface SkillTemplateEntry {
  template: SkillTemplate;
  dirName: string;
  workflowId: string;
}

/**
 * Command template with ID mapping.
 */
export interface CommandTemplateEntry {
  template: ReturnType<typeof getRctProposeCommandTemplate>;
  id: string;
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  // explore is internal-only: its prose is reused by propose, but it is never
  // emitted as a generated skill or command.
  const all: SkillTemplateEntry[] = [
    { template: getApplyChangeSkillTemplate(), dirName: 'ratchet-apply-change', workflowId: 'apply' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'ratchet-archive-change', workflowId: 'archive' },
    { template: getVerifyChangeSkillTemplate(), dirName: 'ratchet-verify-change', workflowId: 'verify' },
    { template: getRctProposeSkillTemplate(), dirName: 'ratchet-propose', workflowId: 'propose' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.workflowId));
}

/**
 * Gets command templates with their IDs, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose id is in this array
 */
export function getCommandTemplates(workflowFilter?: readonly string[]): CommandTemplateEntry[] {
  // explore is internal-only and is never emitted as a command.
  const all: CommandTemplateEntry[] = [
    { template: getRctApplyCommandTemplate(), id: 'apply' },
    { template: getRctArchiveCommandTemplate(), id: 'archive' },
    { template: getRctVerifyCommandTemplate(), id: 'verify' },
    { template: getRctProposeCommandTemplate(), id: 'propose' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.id));
}

/**
 * Converts command templates to CommandContent array, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return contents whose id is in this array
 */
export function getCommandContents(workflowFilter?: readonly string[]): CommandContent[] {
  const commandTemplates = getCommandTemplates(workflowFilter);
  return commandTemplates.map(({ template, id }) => ({
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    body: template.content,
  }));
}

/**
 * Generates skill file content with YAML frontmatter.
 *
 * @param template - The skill template
 * @param generatedByVersion - The Ratchet version to embed in the file
 * @param transformInstructions - Optional callback to transform the instructions content
 */
export function generateSkillContent(
  template: SkillTemplate,
  generatedByVersion: string,
  transformInstructions?: (instructions: string) => string
): string {
  const instructions = transformInstructions
    ? transformInstructions(template.instructions)
    : template.instructions;

  return `---
name: ${template.name}
description: ${template.description}
license: ${template.license || 'MIT'}
compatibility: ${template.compatibility || 'Requires ratchet CLI.'}
metadata:
  author: ${template.metadata?.author || 'ratchet'}
  version: "${template.metadata?.version || '1.0'}"
  generatedBy: "${generatedByVersion}"
---

${instructions}
`;
}
