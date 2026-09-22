import { resolveLocale, type Locale, type UiLanguage } from '../i18n/locale';

/**
 * What the reader can change about how the Reader looks, and what language it
 * says it in.
 *
 * Pure: types, defaults, and the mapping onto CSS. The stored item lives in
 * `settings-storage.ts` because defining it reaches for `browser.runtime` at
 * import time, which is a crash anywhere outside an extension — including in
 * the tests that check this mapping.
 *
 * Everything it imports comes from `../i18n/locale`, which imports nothing
 * itself and touches no browser API, so this file stays testable without one.
 * The alternative was writing `'auto' | 'en' | 'ja'` down a second time, and
 * two copies of a union drift.
 *
 * Deliberately a small, closed set of named steps rather than free numbers.
 * A step is easier to confirm with a screen reader than a slider's value, and
 * every step is a value this stylesheet is known to survive — the layout has to
 * stay usable at 200% browser zoom *on top of* whatever is chosen here.
 *
 * These are stored, not applied as inline styles: they become CSS custom
 * properties on `:root`, which is what keeps the rule about `!important`
 * intact. A user stylesheet still wins over all of it.
 */
export type FontScale = 'small' | 'normal' | 'large' | 'xlarge';
export type LineHeight = 'normal' | 'relaxed' | 'loose';
export type Measure = 'narrow' | 'normal' | 'wide';
export type Typeface = 'system' | 'ud' | 'hyperlegible';
export type Theme = 'system' | 'light' | 'dark';
/**
 * Which reading of a tagged PDF the Reader opens with.
 *
 * A preference, not a guarantee: an untagged PDF has only the inferred reading,
 * and a tagged one whose tag tree yields nothing usable falls back to it too.
 * The Reader shows what exists and says which it is.
 *
 * A subset of `DocumentOrigin`, spelled out here rather than imported, so the
 * only module this one reaches for is still the locale above — `ocr` is a
 * producer of pages, never a reading of the whole document.
 *
 * `combined` is the tagged reading with the headings the inferred reading
 * could verify — offered only for a tagged document whose own tags carry no
 * headings, and only when at least one was placed. Where it does not exist the
 * preference falls to the author's own answer.
 */
export type StructureSource = 'combined' | 'tagged-pdf' | 'pdf-inspector';

/** Where the language of generated text comes from — see `aiLanguage`. */
export type AiLanguage = 'document' | 'interface';

export interface ReaderSettings {
  /**
   * The language of the Reader's own interface — not the document's, and not
   * the one generated text is written in unless `aiLanguage` says to use it.
   * `auto` follows the browser.
   *
   * It is a setting rather than `browser.i18n` because a Japanese-language
   * browser is not a statement that this reader wants a Japanese interface,
   * and `browser.i18n` offers no way to say otherwise.
   */
  uiLanguage: UiLanguage;
  /**
   * Which language the on-device model writes in — figure descriptions, and
   * the reading OCR makes of a page.
   *
   * `document` follows the PDF's own declaration, which is the right answer
   * whenever that declaration is. `interface` uses `uiLanguage` instead, and
   * exists for the one case nothing automatic can catch: a document that
   * states a language and states the wrong one. A Japanese deck exported with
   * `en` in its catalog is described in English and read as English, by a
   * model doing exactly as it was told — and the file offers no evidence of
   * the mistake, since the file is the mistake.
   */
  aiLanguage: AiLanguage;
  fontScale: FontScale;
  lineHeight: LineHeight;
  measure: Measure;
  typeface: Typeface;
  theme: Theme;
  structureSource: StructureSource;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  uiLanguage: 'auto',
  // The document's own declaration, because it is usually right and it is the
  // only answer that is about this document rather than about the reader.
  aiLanguage: 'document',
  fontScale: 'normal',
  lineHeight: 'normal',
  measure: 'normal',
  typeface: 'system',
  theme: 'system',
  // The author's own answer, plus the headings it can be shown to lack. Where
  // that reading does not exist, the author's answer alone.
  structureSource: 'combined',
};

/**
 * The root font size, as a multiplier of the browser's own default.
 *
 * A multiplier rather than a size: `100%` is whatever the reader set in their
 * browser, so scaling here respects that setting instead of overriding it. Every
 * `rem` in the stylesheet follows from this one value.
 */
const FONT_SCALE: Record<FontScale, string> = {
  small: '87.5%',
  normal: '100%',
  large: '125%',
  xlarge: '150%',
};

const LINE_HEIGHT: Record<LineHeight, string> = {
  normal: '1.75',
  relaxed: '2',
  loose: '2.3',
};

/** In `ch`, so the column tracks the font rather than the window. */
const MEASURE: Record<Measure, string> = {
  narrow: '60ch',
  normal: '78ch',
  wide: '96ch',
};

/**
 * Font stacks, every one of them ending in the system default.
 *
 * **Nothing is downloaded.** Opening a PDF must cause no network traffic, and
 * the extension CSP would block a font host anyway. One of these is packaged
 * with the extension instead and is read from disk — see the `@font-face` rules
 * in `reader.css` — and the rest name faces the reader may already have
 * installed, falling through when they do not. The settings panel says which is
 * which rather than presenting all of them as guaranteed.
 */
const SYSTEM_STACK =
  "system-ui, -apple-system, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', Meiryo, sans-serif";

const TYPEFACE: Record<Typeface, string> = {
  system: SYSTEM_STACK,
  // Morisawa's universal-design faces, the strongest option for Japanese.
  ud: `'BIZ UDPGothic', 'BIZ UDGothic', ${SYSTEM_STACK}`,
  // The Braille Institute's low-vision face, packaged with the extension: the
  // first name resolves to a `@font-face` whose file ships in `public/fonts/`,
  // so this one works whether or not the reader has anything installed. The
  // second name is the older release, for a reader who has that. Latin only, so
  // the Japanese fallback still has to be behind both.
  hyperlegible: `'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', ${SYSTEM_STACK}`,
};

/**
 * What `color-scheme` is set to. It is what tells the browser how to paint
 * scrollbars, form controls and the canvas behind the page.
 *
 * It is no longer what selects the palette. That was the original design — one
 * declaration driving every `light-dark()` in the stylesheet instead of a
 * second palette — and it did not work: with `color-scheme: light` computed on
 * `<html>` over a dark OS setting, Chrome still resolved `light-dark()` to its
 * dark branch. The stylesheet now selects colours from `data-apv-theme`, which
 * `applySettings` writes alongside this.
 */
const COLOR_SCHEME: Record<Theme, string> = {
  system: 'light dark',
  light: 'light',
  dark: 'dark',
};

export interface CssVariables {
  fontScale: string;
  lineHeight: string;
  measure: string;
  fontFamily: string;
  colorScheme: string;
}

export function cssVariablesFor(settings: ReaderSettings): CssVariables {
  return {
    fontScale: FONT_SCALE[settings.fontScale],
    lineHeight: LINE_HEIGHT[settings.lineHeight],
    measure: MEASURE[settings.measure],
    fontFamily: TYPEFACE[settings.typeface],
    colorScheme: COLOR_SCHEME[settings.theme],
  };
}

/** Writes the settings onto an element as custom properties. Separate from the
 * React tree because the side panel and the Reader are different documents and
 * both need it. */
export function applySettings(root: HTMLElement, settings: ReaderSettings): void {
  const vars = cssVariablesFor(settings);
  root.style.setProperty('--apv-font-scale', vars.fontScale);
  root.style.setProperty('--apv-line-height', vars.lineHeight);
  root.style.setProperty('--apv-measure', vars.measure);
  root.style.setProperty('--apv-font-family', vars.fontFamily);
  root.style.setProperty('color-scheme', vars.colorScheme);

  // What actually selects the palette. Absent for `system`, so the stylesheet's
  // `prefers-color-scheme` query is left to decide — an attribute saying
  // "system" would have to be excluded by every rule that reads this one.
  if (settings.theme === 'system') {
    delete root.dataset.apvTheme;
  } else {
    root.dataset.apvTheme = settings.theme;
  }
}

/** Merges a stored value over the defaults, so a settings object written by an
 * older version — or a partially-written one — still yields every field. */
export function withDefaults(stored: Partial<ReaderSettings> | null): ReaderSettings {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

/**
 * The language to generate in, or `undefined` to leave that to the document.
 *
 * Here rather than in the two panels that ask, so that "the interface
 * language" cannot come to mean one thing for image descriptions and another
 * for OCR. `undefined` is not a missing answer — it is the answer "whatever
 * the document says", which `chooseOutputLanguage` is the one to work out.
 */
export function preferredAiLanguage(settings: ReaderSettings): Locale | undefined {
  return settings.aiLanguage === 'interface' ? resolveLocale(settings.uiLanguage) : undefined;
}
