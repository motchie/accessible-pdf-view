import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReaderToolbar,
  type ViewMode,
  type ViewOption,
} from '../lib/reader/components/ReaderToolbar';
import { inLocale } from './helpers/messages';

/**
 * The bar is two things, and the seam between them is the design: a native
 * `<select>` with its own Tab stop, and next to it a `role="toolbar"` over the
 * actions, which brings the arrow keys — and, deliberately, not the roving
 * tabindex the APG pairs with them.
 *
 * The seam exists because a closed `<select>` answers Left and Right by
 * changing its own value, and the pattern says in as many words to keep such a
 * control out. So the tests that matter most here are the ones asserting what
 * the toolbar does *not* reach: the select is outside it, and its keys come
 * back untouched.
 *
 * A pattern whose whole substance is keyboard behaviour cannot be tested by
 * reading markup, so these render into jsdom and press keys.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIEWS: ReadonlyArray<ViewOption> = [
  { id: 'reader', label: 'Reader', description: '構造化された読みやすい HTML' },
  { id: 'original', label: 'Original', description: '元の PDF ページの見た目' },
  { id: 'markdown', label: 'Markdown', description: '解析結果の Markdown', disabled: true },
];

let container: HTMLDivElement;
let root: Root;
let chosen: ViewMode[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  chosen = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Japanese, because that is what these assertions were written against. */
function mount(
  overrides: Partial<Parameters<typeof ReaderToolbar>[0]> = {},
  locale: 'en' | 'ja' = 'ja',
): void {
  act(() => {
    root.render(
      inLocale(
        locale,
        <ReaderToolbar
          views={VIEWS}
          active="reader"
          onChange={(mode) => chosen.push(mode)}
          fileName="report.pdf"
          sourceUrl="https://example.com/report.pdf"
          {...overrides}
        />,
      ),
    );
  });
}

/** The toolbar's stops, in the order the arrow keys walk them. */
function stops(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-apv-toolbar-item]')];
}

/** Returns the event, so a test can ask whether anything claimed the key. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('the view switch', () => {
  it('is a native select, and stays out of the toolbar', () => {
    mount();
    const select = container.querySelector('select')!;
    const toolbar = container.querySelector('[role="toolbar"]')!;

    expect(select).not.toBeNull();
    // The whole point. Inside the toolbar it would have to give up Left and
    // Right, which is not something a native control can be asked to do
    // consistently across browsers.
    expect(toolbar.contains(select)).toBe(false);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  /**
   * The regression this guards is subtle and would be invisible: if the toolbar
   * ever grows to wrap the select, or a stray key handler is put on the bar,
   * the arrow keys stop selecting and start navigating. Nothing on screen would
   * show it.
   */
  it('keeps every arrow key the platform gave it', () => {
    mount();
    const select = container.querySelector('select')!;

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(press(select, key).defaultPrevented).toBe(false);
    }
  });

  it('has a real label, tied by id', () => {
    mount();
    const select = container.querySelector('select')!;
    const label = container.querySelector('label')!;

    expect(select.id).not.toBe('');
    expect(label.getAttribute('for')).toBe(select.id);
    expect(label.textContent).toBe('表示');
  });

  it('names every view in words, not just a label', () => {
    mount();
    const options = [...container.querySelectorAll('option')];

    expect(options.map((option) => option.value)).toEqual(['reader', 'original', 'markdown']);
    // "Original" alone says nothing to someone who cannot see the difference.
    expect(options[1]!.textContent).toContain('元の PDF ページの見た目');
  });

  it('marks the active view selected and an unavailable one disabled', () => {
    mount({ active: 'original' });
    const options = [...container.querySelectorAll('option')];

    expect(options[1]!.selected).toBe(true);
    expect(options[0]!.selected).toBe(false);
    expect(options[2]!.disabled).toBe(true);
  });

  it('reports a change as the view mode', () => {
    mount();
    const select = container.querySelector('select')!;
    act(() => {
      select.value = 'original';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(chosen).toEqual(['original']);
  });
});

describe('the actions toolbar', () => {
  it('is a toolbar, named for what it operates on rather than for itself', () => {
    mount();
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const name = toolbar.getAttribute('aria-label') ?? '';

    expect(name).not.toBe('');
    // The role already says "toolbar"; a label repeating it would be read twice.
    expect(name).not.toContain('ツールバー');
  });

  /**
   * No roving tabindex. The role brings the arrow keys and nothing else, so
   * Tab still reaches every control — which is the whole point of leaving it
   * out: someone with only Tab and Enter, which is what a two-switch setup
   * gives you, must not be left with controls they cannot get to.
   */
  it('keeps every control in the tab order', () => {
    mount();
    expect(stops().map((item) => item.getAttribute('data-apv-toolbar-item'))).toEqual([
      'print',
      'original',
    ]);
    for (const item of stops()) {
      expect(item.hasAttribute('tabindex')).toBe(false);
      expect(item.tabIndex).toBe(0);
    }
  });

  it('moves focus with the arrow keys', () => {
    mount();
    const items = stops();
    items[0]!.focus();

    press(items[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(items[1]);

    press(items[1]!, 'ArrowLeft');
    expect(document.activeElement).toBe(items[0]);
  });

  it('wraps at both ends', () => {
    mount();
    const items = stops();

    press(items[items.length - 1]!, 'ArrowRight');
    expect(document.activeElement).toBe(items[0]);

    press(items[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('jumps to the ends with Home and End', () => {
    mount();
    const items = stops();

    press(items[0]!, 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);

    press(items[items.length - 1]!, 'Home');
    expect(document.activeElement).toBe(items[0]);
  });

  it('leaves other keys to the control that has focus', () => {
    mount();
    expect(press(stops()[0]!, 'Enter').defaultPrevented).toBe(false);
  });

  it('drops the original link when there is no source URL', () => {
    mount({ sourceUrl: null });
    expect(container.querySelector('a')).toBeNull();
    // Print still works — it prints whatever view is showing.
    expect(stops().map((item) => item.getAttribute('data-apv-toolbar-item'))).toEqual(['print']);
  });

  /**
   * The Reader is a web-accessible resource, because the redirect that opens it
   * has to be allowed to land somewhere. That also means any page can open it
   * with an address of its own choosing, and this is where such an address
   * would become an `href` inside the extension's own origin.
   */
  it('drops an address that has no business being a link', () => {
    mount({ sourceUrl: 'javascript:alert(1)' });
    expect(container.querySelector('a')).toBeNull();
    expect(stops().map((item) => item.getAttribute('data-apv-toolbar-item'))).toEqual(['print']);
  });

  it('warns that the original opens in a new tab', () => {
    mount();
    const link = container.querySelector('a[href="https://example.com/report.pdf"]')!;

    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('.apv-visually-hidden')?.textContent).toContain('新しいタブ');
  });

  /**
   * While the "Opening PDFs" setting is on, this link opens the Reader again —
   * the redirect rule cannot tell who asked for a `.pdf` address. Seeing that
   * happen is how anyone else finds out; being told is the only way for the
   * person the new tab is not visible to, who would otherwise be left choosing
   * between "it opened something" and "nothing happened".
   */
  it('says where the original will open when the setting sends PDFs here', () => {
    mount({ opensInReader: true });
    const note = container.querySelector('a .apv-visually-hidden')!.textContent!;

    expect(note).toContain('新しいタブ');
    expect(note).toContain('リーダーで開きます');
  });

  it('says it in English too, which is the base language', () => {
    mount({ opensInReader: true }, 'en');
    const note = container.querySelector('a .apv-visually-hidden')!.textContent!;

    expect(note).toContain('new tab');
    expect(note).toContain('in this Reader');
  });

  /**
   * The settings button is left out where no side-panel API exists — which is
   * what this test environment is, and also what a browser without the API
   * would be. A control that does nothing is worse than no control: someone who
   * cannot see the screen cannot tell "nothing happened" from "it happened
   * somewhere I am not looking".
   */
  it('omits the settings button where no side panel API exists', () => {
    mount();
    expect(container.textContent).not.toContain('設定');
  });
});

describe('the bar as a whole', () => {
  /**
   * The point of the whole design: none of Chrome's page-image controls, which
   * do nothing once the document has been rebuilt as HTML.
   */
  it('carries no page-image controls', () => {
    mount();
    const text = container.textContent ?? '';

    for (const absent of ['ズーム', '回転', '幅に合わせる']) {
      expect(text).not.toContain(absent);
    }
    // A page-number box would be the remaining one. Checked as an element
    // rather than by its label, because the word for "page" legitimately
    // appears in the Original view's own description — in either language.
    expect(container.querySelector('input')).toBeNull();
  });

  it('shows the file name, which is not the document title', () => {
    mount();
    expect(container.querySelector('.apv-toolbar__file')?.textContent).toBe('report.pdf');
    mount({ fileName: null });
    expect(container.querySelector('.apv-toolbar__file')).toBeNull();
  });
});
