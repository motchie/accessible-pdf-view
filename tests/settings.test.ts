// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  applySettings,
  cssVariablesFor,
  preferredAiLanguage,
  withDefaults,
  type ReaderSettings,
} from '../lib/reader/settings';

/**
 * The display settings, checked where they are decidable: the mapping from a
 * named step to the CSS it produces. Storage and the side-panel page need a
 * browser to say anything about, but this part is the part that can be wrong in
 * a way nobody notices — a size in `px` would silently break browser zoom, and
 * a font stack without the system fallback would leave a reader with nothing.
 */
function settings(overrides: Partial<ReaderSettings> = {}): ReaderSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('display settings → CSS', () => {
  it('defaults to what the stylesheet already declares', () => {
    const vars = cssVariablesFor(DEFAULT_SETTINGS);
    expect(vars).toEqual({
      fontScale: '100%',
      lineHeight: '1.75',
      measure: '78ch',
      colorScheme: 'light dark',
      fontFamily: expect.stringContaining('system-ui'),
    });
  });

  /**
   * The root size is a percentage on purpose. `100%` is whatever the reader set
   * as their browser's default text size, so a scale multiplies that rather
   * than overriding it. A `px` value here would throw their setting away — and
   * every `rem` in the stylesheet hangs off this one declaration.
   */
  it('scales text as a percentage of the browser default, never a fixed size', () => {
    for (const scale of ['small', 'normal', 'large', 'xlarge'] as const) {
      const value = cssVariablesFor(settings({ fontScale: scale })).fontScale;
      expect(value, scale).toMatch(/^\d+(\.\d+)?%$/);
    }
    expect(cssVariablesFor(settings({ fontScale: 'xlarge' })).fontScale).toBe('150%');
  });

  /** `ch` ties the column to the font, so enlarging the text widens the measure
   * instead of squeezing more words into the same ribbon. */
  it('measures the column in ch, not pixels or viewport units', () => {
    for (const measure of ['narrow', 'normal', 'wide'] as const) {
      expect(cssVariablesFor(settings({ measure })).measure, measure).toMatch(/^\d+ch$/);
    }
  });

  /**
   * Nothing is downloaded — the CSP forbids a font host and the privacy promise
   * forbids the request. So every stack has to end somewhere the reader
   * certainly has, or choosing a face they lack would leave them with the
   * browser's default serif rather than the Reader's own.
   */
  it('always falls through to the system stack', () => {
    for (const typeface of ['system', 'ud', 'hyperlegible'] as const) {
      const stack = cssVariablesFor(settings({ typeface })).fontFamily;
      expect(stack, typeface).toContain('system-ui');
      expect(stack, typeface).toMatch(/sans-serif$/);
    }
    expect(cssVariablesFor(settings({ typeface: 'ud' })).fontFamily).toContain('BIZ UDPGothic');
  });

  /** Forcing a theme is one `color-scheme` declaration, because every colour in
   * the stylesheet comes from `light-dark()`. */
  it('forces a theme through color-scheme rather than a second palette', () => {
    expect(cssVariablesFor(settings({ theme: 'system' })).colorScheme).toBe('light dark');
    expect(cssVariablesFor(settings({ theme: 'light' })).colorScheme).toBe('light');
    expect(cssVariablesFor(settings({ theme: 'dark' })).colorScheme).toBe('dark');
  });
});

describe('applying them to a document', () => {
  it('writes custom properties rather than restyling elements', () => {
    const root = document.createElement('div');
    applySettings(root, settings({ fontScale: 'large', theme: 'dark' }));

    expect(root.style.getPropertyValue('--apv-font-scale')).toBe('125%');
    expect(root.style.getPropertyValue('--apv-measure')).toBe('78ch');
    expect(root.style.getPropertyValue('color-scheme')).toBe('dark');
    // Custom properties only: a user stylesheet still wins, which is the rule
    // the whole stylesheet is written to keep.
    expect(root.style.getPropertyValue('font-size')).toBe('');
  });
});

describe('reading a stored value', () => {
  it('fills in anything a stored object is missing', () => {
    expect(withDefaults({ fontScale: 'large' })).toEqual({
      ...DEFAULT_SETTINGS,
      fontScale: 'large',
    });
  });

  it('falls back completely when nothing is stored', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('the initial structure source', () => {
  it('defaults to the author’s own answer with its missing headings filled in', () => {
    expect(DEFAULT_SETTINGS.structureSource).toBe('combined');
  });

  /**
   * The setting shipped after the first release, so every stored value in
   * existence predates it. A missing field must not become `undefined` on the
   * way into the Reader — that is a document opening with no reading chosen.
   */
  it('is filled in for settings stored before it existed', () => {
    const old = { fontScale: 'large', theme: 'dark' } as Partial<ReaderSettings>;
    expect(withDefaults(old).structureSource).toBe('combined');
    // And the rest of the stored value survives.
    expect(withDefaults(old).fontScale).toBe('large');
  });

  it('is not a CSS variable — it changes the document, not its appearance', () => {
    const variables = cssVariablesFor({ ...DEFAULT_SETTINGS, structureSource: 'pdf-inspector' });
    expect(JSON.stringify(variables)).not.toContain('pdf-inspector');
  });
});

describe('forcing a theme', () => {
  /**
   * The original design set `color-scheme` and let every `light-dark()` in the
   * stylesheet follow. It did not work: with `color-scheme: light` computed on
   * `<html>` over a dark OS setting, Chrome still resolved `light-dark()` to
   * its dark branch — `getComputedStyle(document.documentElement).colorScheme`
   * read back `"light"` while `body`'s background stayed `rgb(22, 24, 28)`.
   * The palette is now selected by this attribute, which is a plain selector
   * match and depends on nothing subtle.
   */
  it('writes the theme where the stylesheet can select on it', () => {
    const root = document.createElement('div');

    applySettings(root, settings({ theme: 'light' }));
    expect(root.dataset.apvTheme).toBe('light');

    applySettings(root, settings({ theme: 'dark' }));
    expect(root.dataset.apvTheme).toBe('dark');
  });

  /**
   * `system` must leave no attribute at all. An attribute saying "system"
   * would have to be excluded by every rule that reads this one, and the
   * `prefers-color-scheme` query already answers that case.
   */
  it('removes the attribute again when the reader goes back to the OS setting', () => {
    const root = document.createElement('div');

    applySettings(root, settings({ theme: 'dark' }));
    applySettings(root, settings({ theme: 'system' }));

    expect(root.dataset.apvTheme).toBeUndefined();
    expect(root.hasAttribute('data-apv-theme')).toBe(false);
  });

  it('still sets color-scheme, which paints the scrollbars and controls', () => {
    const root = document.createElement('div');

    applySettings(root, settings({ theme: 'light' }));
    expect(root.style.getPropertyValue('color-scheme')).toBe('light');

    applySettings(root, settings({ theme: 'system' }));
    expect(root.style.getPropertyValue('color-scheme')).toBe('light dark');
  });
});

/**
 * Which language the on-device model writes in.
 *
 * The default has to be "whatever the document says", because that answer is
 * about the document in front of the reader rather than about the reader — and
 * it is right for nearly every file. The override exists for the one thing no
 * amount of parsing can detect: a PDF that declares a language it is not
 * written in.
 */
describe('the language generated text is written in', () => {
  it('leaves the choice to the document unless the reader says otherwise', () => {
    expect(DEFAULT_SETTINGS.aiLanguage).toBe('document');
    // `undefined` is the answer "ask the document", which is what the panels
    // pass on to `chooseOutputLanguage`.
    expect(preferredAiLanguage(DEFAULT_SETTINGS)).toBeUndefined();
  });

  it('uses the interface language when the reader asks for it', () => {
    expect(preferredAiLanguage(settings({ aiLanguage: 'interface', uiLanguage: 'ja' }))).toBe('ja');
    expect(preferredAiLanguage(settings({ aiLanguage: 'interface', uiLanguage: 'en' }))).toBe('en');
  });

  /** `auto` is a setting, not a language. Handing it to a model as though it
   * were one is a malformed request, so it has to be resolved first. */
  it('resolves “follow the browser” before handing it on', () => {
    const chosen = preferredAiLanguage(settings({ aiLanguage: 'interface', uiLanguage: 'auto' }));
    expect(chosen).toMatch(/^(en|ja)$/);
  });

  /** The same hazard as the structure source above: this setting shipped after
   * the first release, so every stored value predates it. */
  it('is filled in for settings stored before it existed', () => {
    const old = { theme: 'dark' } as Partial<ReaderSettings>;
    expect(withDefaults(old).aiLanguage).toBe('document');
  });
});
