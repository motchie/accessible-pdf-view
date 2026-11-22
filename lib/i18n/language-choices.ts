/**
 * The languages offered where the reader chooses a document's language (#57).
 *
 * The browser's own languages first — the ones this reader has told the
 * browser they read — then a fixed list of widely used languages, then any
 * `extra` (the language in use now, so the control can always show it). Each
 * is named in the interface's language by the platform (`Intl.DisplayNames`),
 * with its tag, as the document information panel names languages: 「ルーマニア語
 * (ro)」, "Romanian (ro)".
 *
 * Primary language subtags only: a reader choosing Romanian does not need to
 * choose between `ro` and `ro-RO`, and a voice for one is a voice for the other.
 */
const COMMON = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'he', 'hr', 'hu',
  'id', 'it', 'ja', 'ko', 'lt', 'lv', 'mt', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl',
  'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

/**
 * A language's name in the interface's language, with its tag: 「ルーマニア語
 * (ro)」, "Romanian (ro)". The tag alone where the platform has no name.
 */
export function languageLabel(tag: string, locale: string): string {
  const name = displayNames(locale)?.of(tag);
  return name && name !== tag ? `${name} (${tag})` : tag;
}

export interface LanguageChoice {
  tag: string;
  label: string;
}

export function documentLanguageChoices(
  locale: string,
  browserLanguages: readonly string[],
  extra: readonly (string | undefined)[] = [],
): LanguageChoice[] {
  const label = (tag: string) => languageLabel(tag, locale);

  const browser = unique(browserLanguages.map(primaryTag).filter(isTag));
  const rest = unique([...COMMON, ...extra.filter(isTag).map(primaryTag)])
    .filter((tag) => !browser.includes(tag))
    .map((tag) => ({ tag, label: label(tag) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return [...browser.map((tag) => ({ tag, label: label(tag) })), ...rest];
}

function displayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' });
  } catch {
    return null;
  }
}

function primaryTag(tag: string): string {
  return tag.split(/[-_]/)[0]!.toLowerCase();
}

function isTag(tag: string | undefined): tag is string {
  return typeof tag === 'string' && /^[A-Za-z]{2,3}([-_].*)?$/.test(tag);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
