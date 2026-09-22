import { describe, expect, it } from 'vitest';
import { nodeToPlainText } from '../lib/pdf/document-model';
import type { DocumentNode } from '../lib/pdf/document-model';
import { refineHeadings, shouldDemote } from '../lib/pdf/inspector/headings';

/**
 * These rules only ever take a heading away.
 *
 * The asymmetry is the design: a wrongly removed heading costs one misleading
 * navigation stop, while a wrongly invented one puts a claim about the
 * document's structure in front of someone who cannot check it.
 */
function heading(text: string): DocumentNode {
  return { type: 'heading', level: 2, content: [{ type: 'text', text }] };
}

describe('demoting headings that are not sections', () => {
  /**
   * The measured case, on three of five fixtures. A reader pressing `H` was
   * being told the document's structure, and being told "end".
   */
  it('demotes the closing marker of a Japanese business letter', () => {
    expect(shouldDemote('以上')).toBe(true);
    // Extraction routinely separates the two characters.
    expect(shouldDemote('以 上')).toBe(true);
    expect(shouldDemote(' 以　上 ')).toBe(true);
  });

  it('demotes a heading that is entirely a parenthetical', () => {
    expect(shouldDemote('（ロゴ画像 ※注記つき）')).toBe(true);
    expect(shouldDemote('(参考)')).toBe(true);
  });

  /**
   * One untagged prospectus produces fourteen headings from two pages whose
   * fonts carry no usable ToUnicode map. Fourteen destinations, no information — and
   * the pages are already reported as needing OCR.
   */
  it('demotes a heading made of undecodable characters', () => {
    expect(shouldDemote('\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD')).toBe(true);
    expect(shouldDemote('\uFFFD \uFFFD')).toBe(true);
    // Headings of the same shape as two that must survive: an ampersand and
    // a parenthesised abbreviation, and a source line with a halfwidth dot.
    expect(shouldDemote('サンプル格付会社（S&R)')).toBe(false);
    expect(shouldDemote('出所：サンプル調査･研究所')).toBe(false);
  });

  /** The rules have to stay narrow, or they start eating real headings. */
  it('leaves anything that could be a section alone', () => {
    for (const text of [
      '１. 見出し',
      '以上の理由により',
      '（参考）本 PJ の全体イメージ',
      'サンプル販売による V サービス事業の統合について',
      '【NEWS RELEASE】',
      '',
    ]) {
      expect(shouldDemote(text)).toBe(false);
    }
  });

  it('keeps the words and drops only the claim', () => {
    const [demoted] = refineHeadings([heading('以 上')]);

    expect(demoted?.type).toBe('paragraph');
    // Nothing vanishes from the document.
    expect(demoted && nodeToPlainText(demoted)).toBe('以 上');
  });

  it('leaves every other node exactly as it was', () => {
    const nodes: DocumentNode[] = [
      heading('第 1 章 はじめに'),
      { type: 'paragraph', content: [{ type: 'text', text: '以 上' }] },
    ];
    expect(refineHeadings(nodes)).toEqual(nodes);
  });
});
