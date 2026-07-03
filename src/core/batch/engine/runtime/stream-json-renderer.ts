/**
 * `makeStreamJsonRenderer` — a GENERIC stream-json (NDJSON) terminal renderer.
 *
 * The claude adapter (and any future stream-json-capable adapter) emits one JSON
 * event per stdout line via `--output-format stream-json`. Raw-printing that JSON
 * would dump braces at the user; this renderer consumes those lines and emits
 * polished output instead — streamed assistant text, labeled tool calls, concise
 * tool results, and a closing summary. It is NOT claude-special-cased: the engine
 * gates it on the adapter's `emitsStreamJson` capability, never on the agent name.
 *
 * Output sink: the renderer writes ONLY through the injected `LinePrinter` (the
 * engine's existing single sink — `engine.ts:45`), so it is decoupled from the
 * engine and unit-testable with a fake printer. It never writes to stdout itself
 * and never mutates the accumulated `AgentSpawnResult.stdout` — rendering is a
 * pure display concern (the transcript that `mapSessionToOutcome` reads stays the
 * raw NDJSON, byte-identical with or without rendering).
 *
 * Graceful degradation is mandatory: a line that is not valid JSON, has an
 * unknown top-level `type`, or is missing `type` degrades to printing the RAW
 * line; any handler throw is caught and the raw line printed. A line buffer holds
 * a trailing partial (no trailing newline) until `flush()`, which emits any held
 * partial as a final (raw if it does not parse). The renderer NEVER throws.
 *
 * Event shapes are grounded in a real `claude -p --output-format stream-json
 * --verbose --include-partial-messages` capture:
 *   - `system` (init/status)              → recognized control noise, not printed
 *   - `stream_event`                      → partial deltas; we stream
 *       `event.event.type === 'content_block_delta'` text deltas from
 *       `event.delta.text` (delta.type 'text_delta'); other sub-events ignored
 *   - `assistant` → message.content[]     → {type:'text',text} prose;
 *                                            {type:'tool_use',name,input} call line
 *   - `user`      → message.content[]     → {type:'tool_result',content,is_error?}
 *   - `result` (success/error)            → closing summary + usage/cost
 *   - anything else                       → raw fallback
 */

import chalk from 'chalk';
import type { LinePrinter } from '../engine.js';

export interface StreamJsonRenderer {
  /** Feed one chunk of agent stdout (normally a whole NDJSON line). Never throws. */
  handleLine(chunk: string): void;
  /** Stream end: emit any buffered partial line (raw if it does not parse). */
  flush(): void;
}

/** Max characters of a tool-result line before truncation. */
const RESULT_MAX_CHARS = 200;
/** Max lines of a multi-line tool result before truncation. */
const RESULT_MAX_LINES = 3;

/**
 * Recognized control event sub-shapes that carry no user-facing prose and should
 * NOT be raw-dumped (they are benign structure, not "unknown output"). Only a
 * genuinely unknown top-level `type` degrades to raw.
 */
const CONTROL_TYPES = new Set(['system', 'rate_limit_event']);

interface ContentItem {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
}

/** Per-tool target extraction: which input field best names what the tool acts on. */
const TOOL_TARGET_FIELDS: Record<string, string[]> = {
  Edit: ['file_path'],
  Write: ['file_path'],
  MultiEdit: ['file_path'],
  Read: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path'],
  Bash: ['command'],
  Grep: ['pattern'],
  Glob: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Task: ['description'],
};

/** Per-tool glyph; an unfamiliar tool falls back to a generic bullet. */
function glyphFor(tool: string): string {
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return '✎';
    case 'Read':
      return '◉';
    case 'Bash':
      return '⚙';
    case 'Grep':
    case 'Glob':
      return '🔍';
    case 'WebFetch':
    case 'WebSearch':
      return '🌐';
    default:
      return '•';
  }
}

/**
 * Best-effort target for a tool call: a known field for known tools, else the
 * first string-valued input field, so an unknown tool still renders a target.
 */
function extractTarget(tool: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  const fields = TOOL_TARGET_FIELDS[tool];
  if (fields) {
    for (const f of fields) {
      const v = input[f];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/** Collapse whitespace and clip a single string to a bounded length. */
function clip(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

/** Flatten a tool_result `content` (string OR an array of `{type,text}` parts). */
function flattenResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as ContentItem).text === 'string'
          ? (part as ContentItem).text
          : typeof part === 'string'
            ? part
            : ''
      )
      .join('');
  }
  if (content == null) return '';
  return String(content);
}

export function makeStreamJsonRenderer(print: LinePrinter): StreamJsonRenderer {
  let buffer = '';
  // Assistant prose is streamed incrementally via partial deltas; we accumulate
  // the streamed text so the closing `assistant` message is not re-printed when
  // it merely repeats what the deltas already showed.
  let streamedText = '';
  let streamedThisMessage = false;

  /** Emit accumulated streamed assistant text as one prose line, then reset. */
  const flushStreamedText = (): void => {
    if (streamedText.trim().length > 0) {
      print(streamedText.trimEnd());
    }
    streamedText = '';
    streamedThisMessage = false;
  };

  const renderToolUse = (item: ContentItem): void => {
    const tool = typeof item.name === 'string' ? item.name : 'tool';
    const target = extractTarget(tool, item.input);
    const head = `${glyphFor(tool)} ${chalk.bold(tool)}`;
    print(target ? `${head} ${chalk.dim(clip(target, RESULT_MAX_CHARS))}` : head);
  };

  const renderAssistant = (obj: { message?: { content?: unknown } }): void => {
    const content = obj.message?.content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const item = raw as ContentItem;
      if (item?.type === 'text') {
        // If deltas already streamed this same text, don't double-print it.
        if (streamedThisMessage && typeof item.text === 'string' && streamedText.trim() === item.text.trim()) {
          flushStreamedText();
          continue;
        }
        flushStreamedText();
        if (typeof item.text === 'string' && item.text.trim().length > 0) {
          print(item.text.trimEnd());
        }
      } else if (item?.type === 'tool_use') {
        flushStreamedText();
        renderToolUse(item);
      }
    }
  };

  const renderUser = (obj: { message?: { content?: unknown } }): void => {
    const content = obj.message?.content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const item = raw as ContentItem;
      if (item?.type !== 'tool_result') continue;
      const text = flattenResultContent(item.content);
      const lines = text.split('\n');
      let body = lines.slice(0, RESULT_MAX_LINES).join(' ');
      body = clip(body, RESULT_MAX_CHARS);
      const extra = lines.length - RESULT_MAX_LINES;
      if (extra > 0) body += chalk.dim(` … (+${extra} more)`);
      if (item.is_error) {
        print(chalk.red(`  ↳ error: ${body || 'tool error'}`));
      } else {
        print(chalk.dim(`  ↳ ${body}`));
      }
    }
  };

  const renderStreamEvent = (obj: { event?: { type?: string; delta?: { type?: string; text?: string } } }): void => {
    const ev = obj.event;
    if (!ev || ev.type !== 'content_block_delta') return;
    const delta = ev.delta;
    // Real claude shape: event.delta = {type:'text_delta', text:'…'}.
    if (delta && (delta.type === 'text_delta' || delta.type === undefined) && typeof delta.text === 'string') {
      streamedText += delta.text;
      streamedThisMessage = true;
    }
  };

  const renderResult = (obj: {
    subtype?: string;
    is_error?: boolean;
    result?: unknown;
    total_cost_usd?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  }): void => {
    flushStreamedText();
    const ok = obj.subtype === 'success' && obj.is_error !== true;
    const summary = typeof obj.result === 'string' ? clip(obj.result, RESULT_MAX_CHARS) : '';
    const meta: string[] = [];
    const inTok = obj.usage?.input_tokens;
    const outTok = obj.usage?.output_tokens;
    if (typeof inTok === 'number' || typeof outTok === 'number') {
      meta.push(`${typeof inTok === 'number' ? inTok : '?'} in / ${typeof outTok === 'number' ? outTok : '?'} out tok`);
    }
    if (typeof obj.total_cost_usd === 'number') {
      meta.push(`$${obj.total_cost_usd.toFixed(4)}`);
    }
    const metaStr = meta.length ? chalk.dim(`  (${meta.join(', ')})`) : '';
    print(chalk.dim('─'.repeat(40)));
    if (ok) {
      print(chalk.green(`✔ success${summary ? ` — ${summary}` : ''}`) + metaStr);
    } else {
      print(chalk.red(`✘ error${summary ? ` — ${summary}` : ''}`) + metaStr);
    }
  };

  /**
   * opencode `text` event: read `part.text` and stream the prose live. Mirrors
   * how claude's `stream_event` `text_delta` accumulates `streamedText` so
   * consecutive `text` events stream incrementally and a closing summary flushes
   * the joined text exactly once.
   */
  const renderOpencodeText = (part: { text?: unknown } | undefined): void => {
    if (!part || typeof part.text !== 'string') return;
    streamedText += part.text;
    streamedThisMessage = true;
  };

  /**
   * opencode `step_finish` event: read `part.reason`, `part.tokens`, and
   * `part.cost`; render a closing usage summary mirroring the claude `result`
   * summary. A `reason` other than `"stop"` is treated as an error. Missing
   * fields degrade gracefully — print what we have, never crash.
   */
  const renderOpencodeStepFinish = (
    part:
      | {
          reason?: unknown;
          tokens?: { total?: unknown; input?: unknown; output?: unknown };
          cost?: unknown;
        }
      | undefined
  ): void => {
    flushStreamedText();
    const reason = part && typeof part.reason === 'string' ? part.reason : '';
    const ok = reason === 'stop' || reason === '' || reason === 'success';
    const meta: string[] = [];
    const inTok = part?.tokens?.input;
    const outTok = part?.tokens?.output;
    const totalTok = part?.tokens?.total;
    if (typeof inTok === 'number' || typeof outTok === 'number') {
      meta.push(`${typeof inTok === 'number' ? inTok : '?'} in / ${typeof outTok === 'number' ? outTok : '?'} out tok`);
    }
    if (typeof totalTok === 'number') {
      meta.push(`${totalTok} total tok`);
    }
    if (part && typeof part.cost === 'number') {
      meta.push(`$${part.cost.toFixed(4)}`);
    }
    const metaStr = meta.length ? chalk.dim(`  (${meta.join(', ')})`) : '';
    print(chalk.dim('─'.repeat(40)));
    if (ok) {
      print(chalk.green(`✔ success${reason ? ` — ${reason}` : ''}`) + metaStr);
    } else {
      print(chalk.red(`✘ error${reason ? ` — ${reason}` : ''}`) + metaStr);
    }
  };

  /**
   * opencode event envelope: top-level `type` of `step_start` (control noise,
   * dropped), `text` (stream `part.text` prose), `step_finish` (closing summary
   * from `part.reason`/`part.tokens`/`part.cost`). An unknown `part.type` (or a
   * recognized top-level type whose `part` is missing/unrecognized) falls through
   * to the raw-line contract via the caller's `default` branch.
   */
  const dispatchOpencode = (obj: Record<string, unknown>): boolean => {
    const part = obj.part as Record<string, unknown> | undefined;
    const partType = part && typeof part === 'object' ? (part.type as string | undefined) : undefined;
    switch (obj.type) {
      case 'step_start':
        return true; // recognized control noise, intentionally silent
      case 'text':
        if (partType !== undefined && partType !== 'text') return false; // unknown part.type → raw
        renderOpencodeText(part as { text?: unknown });
        return true;
      case 'step_finish':
        if (partType !== undefined && partType !== 'step_finish') return false;
        renderOpencodeStepFinish(
          part as Parameters<typeof renderOpencodeStepFinish>[0]
        );
        return true;
      default:
        return false;
    }
  };

  /** Dispatch one parsed JSON event. Returns false if the type is unknown → raw. */
  const dispatch = (obj: Record<string, unknown>): boolean => {
    const type = obj.type;
    if (typeof type !== 'string') return false;
    if (CONTROL_TYPES.has(type)) return true; // recognized, intentionally silent
    switch (type) {
      case 'stream_event':
        renderStreamEvent(obj as Parameters<typeof renderStreamEvent>[0]);
        return true;
      case 'assistant':
        renderAssistant(obj as Parameters<typeof renderAssistant>[0]);
        return true;
      case 'user':
        renderUser(obj as Parameters<typeof renderUser>[0]);
        return true;
      case 'result':
        renderResult(obj as Parameters<typeof renderResult>[0]);
        return true;
      case 'step_start':
      case 'text':
      case 'step_finish':
        // opencode event schema. Returns false for an unknown part.type so the
        // caller raw-dumps the line — multi-schema, never agent-named.
        return dispatchOpencode(obj);
      default:
        return false;
    }
  };

  /** Handle one complete NDJSON line; degrade to raw on any failure. */
  const handleOne = (line: string): void => {
    if (line.length === 0) return; // skip blank separators
    try {
      const obj = JSON.parse(line) as unknown;
      if (!obj || typeof obj !== 'object') {
        print(line);
        return;
      }
      if (!dispatch(obj as Record<string, unknown>)) {
        // Unknown/missing type → raw fallback (never silently dropped).
        print(line);
      }
    } catch {
      // Not valid JSON → raw fallback.
      print(line);
    }
  };

  return {
    handleLine(chunk: string): void {
      try {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          handleOne(line);
        }
      } catch {
        // A failure in the buffering itself must never crash the run; emit the
        // raw chunk as a last resort.
        try {
          print(chunk);
        } catch {
          /* sink itself threw; nothing more we can do */
        }
      }
    },
    flush(): void {
      try {
        const partial = buffer;
        buffer = '';
        if (partial.length > 0) handleOne(partial);
        // Emit any assistant prose streamed via deltas that never got a closing
        // `assistant`/`result` event (e.g. a truncated stream).
        flushStreamedText();
      } catch {
        /* flush must never throw */
      }
    },
  };
}
