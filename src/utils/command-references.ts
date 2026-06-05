/**
 * Command Reference Utilities
 *
 * Utilities for transforming command references to tool-specific formats.
 */

/**
 * Transforms colon-based command references to hyphen-based format.
 * Converts `/rct:` patterns to `/rct-` for tools that use hyphen syntax.
 *
 * @param text - The text containing command references
 * @returns Text with command references transformed to hyphen format
 *
 * @example
 * transformToHyphenCommands('/rct:propose') // returns '/rct-propose'
 * transformToHyphenCommands('Use /rct:apply to implement') // returns 'Use /rct-apply to implement'
 */
export function transformToHyphenCommands(text: string): string {
  return text.replace(/\/rct:/g, '/rct-');
}
