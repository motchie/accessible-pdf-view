/**
 * Which language the Reader's own interface is in.
 *
 * Separate from `index.ts`, and with no imports of its own, because the
 * settings module has to name this type and that module promises to import
 * nothing — it is pure types, defaults and a mapping onto CSS, so that the
 * tests covering it need no extension APIs. One definition in a file neither
 * side has to apologise for is better than the same union written twice.
 */
export type Locale = 'en' | 'ja';

/** What the reader chose. `auto` follows the browser. */
export type UiLanguage = 'auto' | Locale;

/**
 * The locale to render in.
 *
 * `auto` asks the browser, and asks it for the *list* rather than one value:
 * someone whose browser is `en-GB, ja` has said something about Japanese that
 * `navigator.language` alone would hide. Anything that is not Japanese is
 * English — the base language rather than a fallback of last resort, since
 * there is no third locale to be wrong about yet.
 */
export function resolveLocale(
  setting: UiLanguage,
  preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Locale {
  if (setting !== 'auto') return setting;
  for (const tag of preferred) {
    if (tag.toLowerCase().split('-')[0] === 'ja') return 'ja';
  }
  return 'en';
}

/**
 * The choices the settings panel offers, each written in its own language.
 *
 * Not in the message catalogue on purpose: a language picker that renders
 * 「日本語」 as "Japanese" when the interface happens to be English is a picker
 * you cannot use to escape a language you do not read. `auto` is the exception
 * and is labelled from the catalogue by the caller.
 */
export const UI_LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
};
