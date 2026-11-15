import type { UiLanguage } from './locale';

/**
 * A copy of the interface language, readable before the page has a body.
 *
 * Firefox keeps the language an element had when it was created: a `lang`
 * changed on <html> once the body is being built is not passed on to screen
 * readers, and the Reader's Japanese interface was read as English (#40). So
 * `public/document-language.js`, a plain script at the top of <head>, sets
 * `lang` before there is a body — and it cannot wait for the setting, which
 * is read asynchronously from `storage.sync`. It reads this copy instead,
 * kept in `localStorage`, which can be read at once. The stored setting stays
 * the source; `useReaderSettings` writes the copy whenever it is known.
 *
 * `localStorage` belongs to the extension's own origin, so the Reader and the
 * settings panel share it. It holds this one value and nothing about any
 * document. A failure to read or write it falls back to following the
 * browser, which is the default setting anyway.
 */
/** Also written out in `public/document-language.js`; a test keeps the two equal. */
export const UI_LANGUAGE_KEY = 'apv-ui-language';

const VALUES: ReadonlySet<string> = new Set<UiLanguage>(['auto', 'en', 'ja']);

/** The interface language last known from the stored setting; `auto` when unknown. */
export function rememberedUiLanguage(storage: Storage | undefined = globalStorage()): UiLanguage {
  try {
    const value = storage?.getItem(UI_LANGUAGE_KEY);
    return value && VALUES.has(value) ? (value as UiLanguage) : 'auto';
  } catch {
    return 'auto';
  }
}

/** Keeps a copy of the stored setting for the next page to start in. */
export function rememberUiLanguage(value: UiLanguage, storage: Storage | undefined = globalStorage()): void {
  try {
    storage?.setItem(UI_LANGUAGE_KEY, value);
  } catch {
    // A page that cannot keep the copy starts in the browser's language next
    // time, and corrects itself as before once the setting is read.
  }
}

function globalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
