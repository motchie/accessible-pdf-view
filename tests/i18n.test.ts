import { describe, expect, it } from 'vitest';
import { en } from '../lib/i18n/en';
import { ja } from '../lib/i18n/ja';
import { resolveLocale } from '../lib/i18n/locale';
import { rich } from '../lib/i18n';

/**
 * The catalogue's guarantees.
 *
 * A missing key is already a compile error — `ja` is typed as `en`'s shape —
 * so what is left to check at runtime is what a type cannot say: that nothing
 * was silenced with an empty string to make the compiler happy, that a message
 * taking a page number uses it, and that choosing a locale does what it claims.
 *
 * The English is the base language and is checked as such. It is also the
 * newer half of the catalogue: the Reader was written in Japanese first, so
 * every English string here is a translation of a sentence someone had already
 * thought about, and the shape check is what stops one going missing.
 */
type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ''): Leaf[] {
  if (typeof value !== 'object' || value === null) return [{ path, value }];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

const enLeaves = leaves(en);
const jaByPath = new Map(leaves(ja).map((leaf) => [leaf.path, leaf.value]));

describe('the message catalogue', () => {
  it('has every English message in Japanese too', () => {
    expect([...jaByPath.keys()].sort()).toEqual(enLeaves.map((leaf) => leaf.path).sort());
  });

  it('never fills a message with an empty string to satisfy the type', () => {
    // `explanation` is allowed to be empty: some errors have a title and
    // nothing useful to add. Everything else has to say something.
    const empty = enLeaves
      .filter((leaf) => typeof leaf.value === 'string' && leaf.value.trim() === '')
      .map((leaf) => leaf.path)
      .filter((path) => !path.endsWith('.explanation'));
    expect(empty).toEqual([]);

    const emptyJa = [...jaByPath.entries()]
      .filter(([path, value]) => typeof value === 'string' && value.trim() === '')
      .map(([path]) => path)
      .filter((path) => !path.endsWith('.explanation'));
    expect(emptyJa).toEqual([]);
  });

  it('uses the arguments it takes, in both languages', () => {
    // A message that ignores its page number renders a sentence about no page
    // in particular, which type-checks and reads as a bug.
    expect(en.notices.pageLabel(7)).toContain('7');
    expect(ja.notices.pageLabel(7)).toContain('7');
    expect(en.status.ready(3)).toContain('3');
    expect(ja.status.ready(3)).toContain('3');
    expect(en.figures.withGeneratedAlt('a bar chart')).toContain('a bar chart');
    expect(ja.figures.withGeneratedAlt('棒グラフ')).toContain('棒グラフ');
  });

  it('counts in English and does not pretend to in Japanese', () => {
    expect(en.documentInfo.pages(1)).toBe('1 page');
    expect(en.documentInfo.pages(2)).toBe('2 pages');
    // Japanese has no plural; the counter is the noun.
    expect(ja.documentInfo.pages(1)).toBe('1 ページ');
    expect(ja.documentInfo.pages(2)).toBe('2 ページ');
  });

  it('keeps saying who wrote a description, in both languages', () => {
    // The one class of message that cannot be allowed to lose its meaning in
    // translation: if the prefix goes, a machine's guess reads as the
    // author's own words.
    expect(en.figures.withGeneratedAlt('x')).toMatch(/AI/);
    expect(ja.figures.withGeneratedAlt('x')).toContain('AIによる自動生成');
    expect(en.figures.withDocumentAiAlt('x')).toMatch(/word processor/);
    expect(ja.figures.withDocumentAiAlt('x')).toContain('文書作成ソフト');
    expect(en.notices.ocrPage).toMatch(/OCR/);
    expect(ja.notices.ocrPage).toContain('OCR');
  });
});

describe('choosing the locale', () => {
  it('honours an explicit choice over the browser', () => {
    expect(resolveLocale('ja', ['en-US'])).toBe('ja');
    expect(resolveLocale('en', ['ja-JP'])).toBe('en');
  });

  it('reads the whole preference list, not just the first entry', () => {
    // A browser set to `en-GB, ja` has said something about Japanese that
    // `navigator.language` alone would hide.
    expect(resolveLocale('auto', ['en-GB', 'ja'])).toBe('ja');
    expect(resolveLocale('auto', ['ja-JP'])).toBe('ja');
    expect(resolveLocale('auto', ['JA'])).toBe('ja');
  });

  it('falls to English, which is the base language rather than a last resort', () => {
    expect(resolveLocale('auto', ['de', 'fr'])).toBe('en');
    expect(resolveLocale('auto', [])).toBe('en');
  });
});

describe('emphasis inside a message', () => {
  it('turns **marked** text into an element and leaves the rest alone', () => {
    const parts = rich('OCR read this **by machine** and may be wrong');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('OCR read this ');
    expect(parts[2]).toBe(' and may be wrong');
  });

  it('leaves a message with no emphasis as one piece of text', () => {
    expect(rich('nothing to emphasise')).toEqual(['nothing to emphasise']);
  });
});

/**
 * Sentences next to each other are joined by the catalogue, because the space
 * between them is the language's: "…wrote. 6 headings." in English,
 * 「…含みます。見出し 6 件。」 in Japanese. Both had been wrong in one language,
 * each the mirror of the other.
 */
describe('joinSentences', () => {
  it('joins with a space in English and with nothing in Japanese', () => {
    expect(en.joinSentences('One.', 'Two.')).toBe('One. Two.');
    expect(ja.joinSentences('一つ目。', '二つ目。')).toBe('一つ目。二つ目。');
  });

  /**
   * It only works if each part is a whole sentence with its own punctuation;
   * otherwise English runs words together across the join and Japanese runs
   * clauses together. So every message that is joined this way is checked.
   */
  it.each([
    ['en', en],
    ['ja', ja],
  ] as const)('is given whole sentences in %s', (_, m) => {
    const ends = /[.。!！?？)）]$/;
    const joined = [
      ...Object.values(m.structure.sources).map((source) => source.detail),
      m.structure.headingCount(1),
      m.structure.headingCount(6),
      m.settings.modelUnavailable,
      ...Object.values(m.settings.modelUnavailableReason),
      m.notices.ocrRequired.wholeDocument,
      m.notices.ocrRequired.onePage(3),
      m.notices.ocrRequired.pages('3, 4'),
      m.notices.ocrRequired.mayHelp,
      m.markdown.sameAsReaderDetail('PDF の構造タグ'),
      m.markdown.sameAsReaderDetailPlain,
      m.markdown.generatedAreMarked,
    ];
    for (const sentence of joined) expect(sentence, sentence).toMatch(ends);
  });
});

describe('the ready status in English', () => {
  // "the PDF. 3 pages." read as "the PDF 3 pages" in faces that tuck a full
  // stop under the F, and "3 pages." is not a sentence.
  it('gives the page count in brackets, not as a sentence after "PDF."', () => {
    expect(en.status.ready(3)).toBe('Finished analysing the PDF (3 pages).');
    expect(en.status.ready(1)).toBe('Finished analysing the PDF (1 page).');
    expect(en.status.readyNeedsOcr(2)).toMatch(/^Finished analysing the PDF \(2 pages\)\. Some pages/);
  });
});
