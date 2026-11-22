import type { AccessibleDocument, DocumentOrigin, PdfFileInfo } from './document-model';
import {
  declaresPartLanguages,
  sameLanguage,
  settleDeclaredLanguages,
  unanimousDeclaredLanguage,
} from './declared-language';

/**
 * Where the language a document is read in came from. Shown in the document
 * information panel, because the "Language" row there is the catalog's own
 * value and a reader hearing another one needs to know why (#50, #57).
 *
 *   `catalog`   The PDF's `/Lang`.
 *   `detected`  The PDF declares none; found from the text.
 *   `tags`      Every passage the structure tags cover declares it (#50).
 *   `usual`     The reader's usual document language, applied because the
 *               file gives no evidence beyond its catalog (#57).
 *   `chosen`    The reader chose it for this document (#57).
 */
export type LanguageSource = 'catalog' | 'detected' | 'tags' | 'usual' | 'chosen';

export interface DocumentLanguages {
  language: string | undefined;
  /** Set only where the title's language differs from `language`. */
  titleLanguage?: string;
  /** Undefined when there is no language at all. */
  source?: LanguageSource;
}

export interface LanguageEvidence {
  raw: ReadonlyMap<DocumentOrigin, AccessibleDocument>;
  info: PdfFileInfo;
  /** What `documentLanguage` found: the catalog's `/Lang`, or detection's. */
  found: string | undefined;
  /** The tagged reading carries most of the page text (`coversPageText`). */
  taggedCoversText: boolean;
  /** Some of the document's text, to check a language's writing system against. */
  sample: string;
}

export interface LanguagePreferences {
  /** The reader's choice for this document, if any. */
  chosen?: string;
  /** The reader's usual document language, if set. */
  usual?: string;
}

/**
 * The language a document is read in, and its title's, for every reading.
 *
 * In order:
 *
 *   1. The reader's choice for this document, always.
 *   2. What the file shows: the catalog's `/Lang` (or detection's answer where
 *      there is none), unless every passage the structure tags cover declares
 *      one other language and the tags carry most of the page text (#50).
 *   3. The reader's usual document language, in place of 2, only where the
 *      file shows nothing beyond its catalog — no part of it declares a
 *      language of its own — and only where the text is written in that
 *      language's writing system. A Romanian reader's Romanian then reaches the
 *      Word exports whose catalog says `en-US` over Romanian text, and not a
 *      Japanese document, nor one whose runs declare English.
 *
 * Where the file's language is written in the same alphabet as the usual
 * one — `en-US` declared over what may be Romanian — the alphabet cannot tell
 * them apart, so the text must also show letters the usual language has and
 * English does not (`fitsUsualLanguage`). Measured on this project's fixtures,
 * without it a usual language of Romanian took five of the six English
 * documents; with it, none.
 * The panel says which rule applied, so the choice for one document is one
 * step away either way.
 */
export function chooseDocumentLanguages(
  evidence: LanguageEvidence,
  preferences: LanguagePreferences = {},
): DocumentLanguages {
  if (preferences.chosen) return { language: preferences.chosen, source: 'chosen' };

  const fromFile = fileLanguages(evidence);
  const usual = preferences.usual;
  if (
    usual &&
    fromFile.source !== 'tags' &&
    !sameLanguage(usual, fromFile.language) &&
    !partsDeclareLanguages(evidence.raw) &&
    fitsUsualLanguage(evidence.sample, usual, fromFile.language)
  ) {
    return { language: usual, source: 'usual' };
  }
  return fromFile;
}

/** Step 2 of `chooseDocumentLanguages`: what the file itself shows. */
function fileLanguages(evidence: LanguageEvidence): DocumentLanguages {
  const { raw, info, found, taggedCoversText } = evidence;
  const foundSource: LanguageSource | undefined = !found
    ? undefined
    : info.language && sameLanguage(found, info.language)
      ? 'catalog'
      : 'detected';
  const tagged = raw.get('tagged-pdf');
  if (!tagged) return { language: found, ...(foundSource ? { source: foundSource } : {}) };

  const title = info.title ?? tagged.metadata.title;
  const settled = settleDeclaredLanguages(tagged, found, {
    ...(title ? { title } : {}),
    tagsCoverText: taggedCoversText,
  });
  // Only tags that carry most of the page text may speak for the document. A
  // declared Tagged PDF is read from its tags however little they cover, and a
  // tree holding one English logo line would otherwise make a Japanese body
  // English in every reading.
  const content = taggedCoversText ? unanimousDeclaredLanguage(settled, found) : undefined;
  if (!content) {
    const titleLanguage = settled.metadata.titleLanguage;
    return {
      language: found,
      ...(titleLanguage ? { titleLanguage } : {}),
      ...(foundSource ? { source: foundSource } : {}),
    };
  }
  // The corrections depend on the document's language, so the title is worked
  // out again against the new one.
  const titleLanguage = title
    ? settleDeclaredLanguages(tagged, content, { title, tagsCoverText: true }).metadata
        .titleLanguage
    : undefined;
  return { language: content, ...(titleLanguage ? { titleLanguage } : {}), source: 'tags' };
}

function partsDeclareLanguages(raw: ReadonlyMap<DocumentOrigin, AccessibleDocument>): boolean {
  const tagged = raw.get('tagged-pdf');
  return tagged !== undefined && declaresPartLanguages(tagged);
}

/**
 * Whether `sample` is written mostly in the writing system `language` uses.
 *
 * The language's script comes from the platform (`Intl.Locale#maximize`):
 * `ro` is `Latn`, `ja` is `Jpan`, `ru` is `Cyrl`. Japanese needs kana, Korean
 * hangul, and Chinese Han with neither; every other script is counted by its
 * Unicode script property. A sample with no letters fits nothing.
 */
export function writtenIn(sample: string, language: string): boolean {
  const script = scriptOf(language);
  if (!script) return false;

  const letters = countMatches(sample, /\p{L}/gu);
  if (letters === 0) return false;
  const kana = countMatches(sample, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = countMatches(sample, /\p{Script=Hangul}/gu);
  const han = countMatches(sample, /\p{Script=Han}/gu);

  switch (script) {
    case 'Jpan':
      return kana > 0 && (kana + han) * 2 > letters;
    case 'Kore':
      return hangul > 0 && (hangul + han) * 2 > letters;
    case 'Hans':
    case 'Hant':
      return kana === 0 && hangul === 0 && han * 2 > letters;
    default: {
      let inScript: number;
      try {
        inScript = countMatches(sample, new RegExp(`\\p{Script=${script}}`, 'gu'));
      } catch {
        return false;
      }
      return inScript * 2 > letters;
    }
  }
}

/**
 * Letters a language writes and English does not, for the languages written in
 * the Latin alphabet that have them. Not a way to tell these languages from
 * one another — ä is German, Swedish and Finnish alike — only from text with
 * none of them, which is what a document declared `en-US` would be if it
 * really were English.
 *
 * A language without such letters (Dutch, Indonesian, English itself) is not
 * in the list, and a usual language of one of them cannot overrule a catalog
 * in the same alphabet: nothing in the text could show it was right to.
 */
const DISTINCTIVE_LETTERS: Readonly<Record<string, RegExp>> = {
  cs: /[ěščřžůĚŠČŘŽŮ]/gu,
  da: /[æøåÆØÅ]/gu,
  de: /[äöüßÄÖÜ]/gu,
  es: /[ñáéíóú¿¡ÑÁÉÍÓÚ]/gu,
  et: /[õäöüšžÕÄÖÜŠŽ]/gu,
  fi: /[äöÄÖ]/gu,
  fr: /[éèêàçùûôœëïÉÈÊÀÇÙÛÔŒ]/gu,
  ga: /[áéíóúÁÉÍÓÚ]/gu,
  hr: /[čćšžđČĆŠŽĐ]/gu,
  hu: /[őűáéíóöúüŐŰÁÉÍÓÖÚÜ]/gu,
  it: /[àèéìòùÀÈÉÌÒÙ]/gu,
  lt: /[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/gu,
  lv: /[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/gu,
  mt: /[ċġħżĊĠĦŻ]/gu,
  no: /[æøåÆØÅ]/gu,
  pl: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/gu,
  pt: /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/gu,
  // ă, ș and ț are Romanian's own; ş and ţ are the cedilla forms older fonts
  // and documents use for the last two. â and î are shared with French.
  ro: /[ăâîșțşţĂÂÎȘȚŞŢ]/gu,
  sk: /[ľščťžýáíéäôňĽŠČŤŽÝÁÍÉÄÔŇ]/gu,
  sl: /[čšžČŠŽ]/gu,
  sv: /[åäöÅÄÖ]/gu,
  tr: /[ğışçöüİĞŞÇÖÜ]/gu,
  vi: /[ăâđêôơưĂÂĐÊÔƠƯ]/gu,
};

/** At least this share of the letters, and this many, must be distinctive. */
const DISTINCTIVE_SHARE = 0.01;
const DISTINCTIVE_MINIMUM = 3;

/**
 * Whether a text could be in the reader's usual language rather than in the
 * one the file gives (`fileLanguage`).
 *
 * It must be written in the usual language's writing system (`writtenIn`).
 * Where the file's language uses the same one, the text must also carry the
 * usual language's distinctive letters (`DISTINCTIVE_LETTERS`): a catalog of
 * `ja` over Latin text is plainly wrong, but one of `en-US` over Latin text
 * may be right. A file that gives no language counts as the Latin alphabet: an
 * English document that declares nothing is as likely as a Romanian one, while
 * a Russian or Chinese text that declares nothing can only be what it looks
 * like.
 */
export function fitsUsualLanguage(
  sample: string,
  usual: string,
  fileLanguage: string | undefined,
): boolean {
  if (!writtenIn(sample, usual)) return false;
  const usualScript = scriptOf(usual);
  const fileScript = fileLanguage ? scriptOf(fileLanguage) : undefined;
  if (fileScript && usualScript && fileScript !== usualScript) return true;
  // With no language from the file, the doubt is only whether the text is
  // English, and English text is not in Cyrillic, Greek or Han: the writing
  // system is evidence enough outside the Latin alphabet.
  if (!fileScript && usualScript && usualScript !== 'Latn') return true;

  const distinctive = DISTINCTIVE_LETTERS[usual.split('-')[0]!.toLowerCase()];
  if (!distinctive) return false;
  const letters = countMatches(sample, /\p{L}/gu);
  const found = countMatches(sample, distinctive);
  return found >= DISTINCTIVE_MINIMUM && found >= letters * DISTINCTIVE_SHARE;
}

function scriptOf(language: string): string | undefined {
  try {
    return new Intl.Locale(language).maximize().script;
  } catch {
    return undefined;
  }
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
