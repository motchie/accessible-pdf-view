import { resolveLocale, type UiLanguage } from './locale';

/**
 * The page's `lang`, decided before the page has finished loading.
 *
 * A screen reader keeps the language a page had when it loaded. Measured in
 * Windows Firefox with NVDA (#40): a page that loads as `lang="en"` and is
 * switched to `ja` afterwards goes on being announced as English, even when
 * read again after the change; switched while it is still loading, it is not.
 * The Reader used to switch in an effect after React's first render, which is
 * asynchronous and so too late, and its Japanese interface was read as English.
 *
 * So `main.tsx` calls `setDocumentLanguage` before React starts. The setting
 * itself is read asynchronously from `storage.sync` and cannot wait for that,
 * so the interface language is also kept here, in `localStorage`, which can be
 * read at once. It is a copy: the stored setting stays the source, and
 * `rememberUiLanguage` is called whenever that is known.
 *
 * `localStorage` belongs to the extension's own origin, so the Reader and the
 * settings panel share it. It holds this one value and nothing about any
 * document. Any failure to read or write it falls back to following the
 * browser, which is the default setting anyway.
 */
const KEY = 'apv-ui-language';

const VALUES: ReadonlySet<string> = new Set<UiLanguage>(['auto', 'en', 'ja']);

/** The interface language last known from the stored setting; `auto` when unknown. */
export function rememberedUiLanguage(storage: Storage | undefined = globalStorage()): UiLanguage {
  try {
    const value = storage?.getItem(KEY);
    return value && VALUES.has(value) ? (value as UiLanguage) : 'auto';
  } catch {
    return 'auto';
  }
}

/** Keeps a copy of the stored setting for the next page to start in. */
export function rememberUiLanguage(value: UiLanguage, storage: Storage | undefined = globalStorage()): void {
  try {
    storage?.setItem(KEY, value);
  } catch {
    // A page that cannot keep the copy starts in the browser's language next
    // time, and corrects itself as before once the setting is read.
  }
}

/** Sets the document's `lang` from the remembered setting. For `main.tsx`, before React. */
export function setDocumentLanguage(doc: Document = document, storage?: Storage): void {
  doc.documentElement.lang = resolveLocale(rememberedUiLanguage(storage ?? globalStorage()));
}

function globalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
