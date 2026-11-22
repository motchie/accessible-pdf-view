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
 * The usual language cannot tell a Romanian document from an English one when
 * both declare only `en-US`; the reader who sets it accepts that, and the
 * panel says which rule applied, so the choice for one document is one step
 * away.
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
    writtenIn(evidence.sample, usual)
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
  let script: string | undefined;
  try {
    script = new Intl.Locale(language).maximize().script;
  } catch {
    return false;
  }
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

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
