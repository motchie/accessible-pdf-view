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
