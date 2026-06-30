import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for searchable-multi-select keybinding behavior.
 *
 * We mock @inquirer/core to intercept the prompt's render function and
 * keypress handler, then simulate key events to verify:
 *   - Space toggles selection (add/remove)
 *   - Enter confirms and submits
 *   - Tab does NOT confirm (removed)
 *   - Hint text is updated
 */

// State store for the mock hook system
const state: Record<number, unknown> = {};
let stateIndex = 0;
let keypressHandler: ((key: Record<string, unknown>) => void) | null = null;
let renderOutput = '';

function resetState() {
  for (const k of Object.keys(state)) delete state[k as unknown as number];
  stateIndex = 0;
  keypressHandler = null;
  renderOutput = '';
  currentRenderFn = null;
  currentConfig = null;
  currentDone = null;
}

// Re-render: reset hook index, re-invoke the render function
let currentRenderFn: ((config: Record<string, unknown>, done: (v: string[]) => void) => string) | null = null;
let currentConfig: Record<string, unknown> | null = null;
let currentDone: ((v: string[]) => void) | null = null;

function rerender() {
  if (!currentRenderFn || !currentConfig || !currentDone) return;
  stateIndex = 0;
  renderOutput = currentRenderFn(currentConfig, currentDone);
}

vi.mock('@inquirer/core', () => {
  return {
    createPrompt: (fn: (config: Record<string, unknown>, done: (v: string[]) => void) => string) => {
      currentRenderFn = fn;
      return (config: Record<string, unknown>) => {
        return new Promise<string[]>((resolve) => {
          currentConfig = config;
          currentDone = resolve;
          stateIndex = 0;
          renderOutput = fn(config, resolve);
        });
      };
    },
    useState: (initial: unknown) => {
      const idx = stateIndex++;
      if (!(idx in state)) {
        state[idx] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const setter = (value: unknown) => {
        state[idx] = value;
        // Re-render after state change
        rerender();
      };
      return [state[idx], setter];
    },
    useKeypress: (handler: (key: Record<string, unknown>) => void) => {
      keypressHandler = handler;
    },
    useMemo: (fn: () => unknown, _deps: unknown[]) => fn(),
    usePrefix: () => '?',
    isEnterKey: (key: Record<string, unknown>) => key.name === 'return' || key.name === 'enter',
    isBackspaceKey: (key: Record<string, unknown>) => key.name === 'backspace',
    isUpKey: (key: Record<string, unknown>) => key.name === 'up',
    isDownKey: (key: Record<string, unknown>) => key.name === 'down',
  };
});

function pressKey(name: string) {
  if (!keypressHandler) throw new Error('No keypress handler registered');
  keypressHandler({ name, ctrl: false });
}

function getSelectedValues(): string[] {
  return (state[1] as string[]) ?? [];
}

function getStatus(): string {
  return (state[3] as string) ?? 'idle';
}

function getError(): string | null {
  return (state[4] as string | null) ?? null;
}

function getSearchText(): string {
  return (state[0] as string) ?? '';
}

function getCursor(): number {
  return (state[2] as number) ?? 0;
}

// Type a printable character (single-char key name, no ctrl) into the search box.
function typeChar(char: string) {
  if (!keypressHandler) throw new Error('No keypress handler registered');
  keypressHandler({ name: char, ctrl: false });
}

const testChoices = [
  { name: 'Tool A', value: 'tool-a' },
  { name: 'Tool B', value: 'tool-b' },
  { name: 'Tool C', value: 'tool-c' },
];

async function setup(choices = testChoices, validate?: (selected: string[]) => boolean | string) {
  resetState();

  const mod = await import('../../src/prompts/searchable-multi-select.js');

  // Fire and forget - the promise resolves only when done() is called via Enter
  // We just need the side effect of registering the keypress handler
  mod.searchableMultiSelect({
    message: 'Select tools',
    choices,
    validate,
  });

  // The async chain in searchableMultiSelect involves:
  //   1. await createSearchableMultiSelect() -> await import('@inquirer/core')
  //   2. prompt(config) which registers the keypress handler synchronously
  // Flush enough microtask ticks for the full chain to settle.
  await vi.waitFor(() => {
    if (!keypressHandler) throw new Error('Keypress handler not yet registered');
  }, { timeout: 500 });
}

describe('searchable-multi-select keybindings', () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  describe('Space to toggle', () => {
    it('should select highlighted item when Space is pressed', async () => {
      await setup();
      pressKey('space');
      expect(getSelectedValues()).toContain('tool-a');
    });

    it('should deselect highlighted item when Space is pressed on already-selected item', async () => {
      await setup();
      pressKey('space');
      expect(getSelectedValues()).toContain('tool-a');

      pressKey('space');
      expect(getSelectedValues()).not.toContain('tool-a');
    });

    it('should toggle multiple items independently', async () => {
      await setup();

      // Select Tool A
      pressKey('space');
      expect(getSelectedValues()).toEqual(['tool-a']);

      // Move down to Tool B, select it
      pressKey('down');
      pressKey('space');
      expect(getSelectedValues()).toContain('tool-a');
      expect(getSelectedValues()).toContain('tool-b');

      // Move back up to Tool A, deselect it
      pressKey('up');
      pressKey('space');
      expect(getSelectedValues()).not.toContain('tool-a');
      expect(getSelectedValues()).toContain('tool-b');
    });
  });

  describe('Enter to confirm', () => {
    it('should set status to done when Enter is pressed', async () => {
      await setup();
      pressKey('space');
      pressKey('return');
      expect(getStatus()).toBe('done');
    });

    it('should confirm with empty selection', async () => {
      await setup();
      pressKey('return');
      expect(getStatus()).toBe('done');
    });

    it('should show validation error when validation fails', async () => {
      const validate = (selected: string[]) =>
        selected.length > 0 ? true : 'Select at least one';
      await setup(testChoices, validate);

      pressKey('return');
      expect(getStatus()).toBe('idle');
      expect(getError()).toBe('Select at least one');
    });

    it('should confirm when validation passes', async () => {
      const validate = (selected: string[]) =>
        selected.length > 0 ? true : 'Select at least one';
      await setup(testChoices, validate);

      pressKey('space');
      pressKey('return');
      expect(getStatus()).toBe('done');
    });
  });

  describe('Tab does not confirm', () => {
    it('should not change status when Tab is pressed', async () => {
      await setup();
      pressKey('space');
      pressKey('tab');
      expect(getStatus()).toBe('idle');
    });
  });

  describe('hint text', () => {
    it('should include Space toggle and Enter confirm in rendered output', async () => {
      await setup();
      expect(renderOutput).toContain('Space');
      expect(renderOutput).toContain('toggle');
      expect(renderOutput).toContain('Enter');
      expect(renderOutput).toContain('confirm');
      expect(renderOutput).not.toMatch(/Tab.*confirm/);
    });
  });

  // Implements features/ui-telemetry/searchable-multi-select-search.feature:
  // search filtering, the no-matches notice, backspace semantics, cursor
  // clamping, pagination, status suffixes, the selected-chips row, and the
  // done-state render.

  describe('typed search filtering', () => {
    it('filters the list to choices matching the typed term by name or value', async () => {
      await setup();
      typeChar('b'); // matches only "Tool B" / "tool-b"
      expect(getSearchText()).toBe('b');
      expect(renderOutput).toContain('Tool B');
      expect(renderOutput).not.toContain('Tool A');
      expect(renderOutput).not.toContain('Tool C');
    });

    it('renders the no-matches notice when the term matches nothing', async () => {
      await setup();
      typeChar('z');
      expect(renderOutput).toContain('No matches');
    });
  });

  describe('Backspace semantics', () => {
    it('deletes the trailing search character before touching selections', async () => {
      await setup();
      pressKey('space'); // select Tool A
      typeChar('b'); // search term typed
      expect(getSearchText()).toBe('b');

      pressKey('backspace');
      expect(getSearchText()).toBe('');
      // Selections untouched while the search box still had content to clear.
      expect(getSelectedValues()).toEqual(['tool-a']);
    });

    it('removes the most recently selected item when the search box is empty', async () => {
      await setup();
      pressKey('space'); // select Tool A
      pressKey('down');
      pressKey('space'); // select Tool B
      expect(getSelectedValues()).toEqual(['tool-a', 'tool-b']);

      pressKey('backspace');
      expect(getSelectedValues()).toEqual(['tool-a']);
    });
  });

  describe('cursor clamping', () => {
    it('never moves the cursor outside the list bounds', async () => {
      await setup();
      // Up at the first item stays at 0.
      pressKey('up');
      expect(getCursor()).toBe(0);

      // Down past the last item clamps at length - 1.
      for (let i = 0; i < 10; i++) pressKey('down');
      expect(getCursor()).toBe(testChoices.length - 1);
    });
  });

  describe('pagination indicator', () => {
    it('shows a (current/total) indicator when choices exceed the page size', async () => {
      const manyChoices = Array.from({ length: 20 }, (_, i) => ({
        name: `Item ${i}`,
        value: `item-${i}`,
      }));
      await setup(manyChoices);
      // pageSize defaults to 15; 20 choices => 2 pages, on page 1.
      expect(renderOutput).toContain('(1/2)');
    });
  });

  describe('status suffixes', () => {
    it('renders configured, detected, refresh, and selected suffixes', async () => {
      const flagged = [
        { name: 'ConfA', value: 'confa', configured: true },
        { name: 'ConfB', value: 'confb', configured: true },
        { name: 'Det', value: 'det', detected: true },
        { name: 'Plain', value: 'plain' },
      ];
      await setup(flagged);

      // Toggle the first configured choice on -> it becomes a "refresh".
      pressKey('space'); // ConfA
      // Move to Plain and toggle it on -> a plain "selected".
      pressKey('down');
      pressKey('down');
      pressKey('down');
      pressKey('space'); // Plain

      expect(renderOutput).toContain('(refresh)'); // selected + configured (ConfA)
      expect(renderOutput).toContain('(configured)'); // unselected configured (ConfB)
      expect(renderOutput).toContain('(detected)'); // unselected detected (Det)
      expect(renderOutput).toContain('(selected)'); // selected, not configured (Plain)
    });
  });

  describe('selected-chips row', () => {
    it('lists the toggled item and drops the (none selected) placeholder', async () => {
      await setup();
      // Before any selection the placeholder is shown.
      expect(renderOutput).toContain('(none selected)');

      pressKey('space'); // select Tool A
      expect(renderOutput).toContain('Selected:');
      expect(renderOutput).toContain('Tool A');
      expect(renderOutput).not.toContain('(none selected)');
    });
  });

  describe('done-state render', () => {
    it('shows (none) when confirmed with no selection', async () => {
      await setup();
      pressKey('return');
      expect(getStatus()).toBe('done');
      expect(renderOutput).toContain('(none)');
    });

    it('joins the selected names when confirmed with a selection', async () => {
      await setup();
      pressKey('space'); // Tool A
      pressKey('down');
      pressKey('space'); // Tool B
      pressKey('return');
      expect(getStatus()).toBe('done');
      expect(renderOutput).toContain('Tool A, Tool B');
    });
  });
});
