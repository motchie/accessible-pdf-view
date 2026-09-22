import { describe, expect, it } from 'vitest';
import { alignLines } from '../lib/pdf/text-alignment';

/**
 * The strings here are **neutral stand-ins** for what the two producers
 * returned for the same lines of two real documents, after the Reader's own
 * spacing repair on the pdf-inspector side.
 *
 * The differences between the two columns are the real ones and are the whole
 * point: where PDF.js spaces a line and pdf-inspector does not, where one
 * reading carries a parenthetical the other dropped, where a footnote marker
 * is split across runs. The words around those differences were rewritten,
 * because the documents are third-party and are not published with this
 * repository — a test fixture is a poor reason to put someone's press release
 * in a public repository.
 */
const PDFJS_LINES = ['１. 見出し', 'SAMPLE 本文 の 一行目 が ここから 右端まで 続きます', '二行目はここで折り返し、三行目に続きます', '三行目はここで終わります'];

const MERGED =
  '１. 見出し SAMPLE本文の一行目がここから右端まで続きます二行目はここで折り返し、三行目に続きます三行目はここで終わります';

describe('finding line breaks inside merged text', () => {
  it('locates a merged block and reports where each line begins', () => {
    const hit = alignLines(PDFJS_LINES).locate(MERGED);

    expect(hit).not.toBeNull();
    expect(hit!.firstLine).toBe(0);
    expect(hit!.lastLine).toBe(3);
    expect(hit!.startsMidLine).toBe(false);
    expect(hit!.endsMidLine).toBe(false);

    const [first, second, third] = hit!.breaks;
    expect(MERGED.slice(0, first).trimEnd()).toBe('１. 見出し');
    expect(MERGED.slice(first, second).trim()).toBe('SAMPLE本文の一行目がここから右端まで続きます');
    expect(MERGED.slice(third)).toBe('三行目はここで終わります');
  });

  /**
   * 「（ ※1）」 against 「（※1）」: pdf-inspector's space survives the spacing
   * repair because 「※」 is not a CJK character. Whitespace is the one thing
   * the comparison ignores.
   */
  it('ignores whitespace that only one producer has', () => {
    const lines = ['「PDF の話 2026」（※', '1', '）において、'];
    const hit = alignLines(lines).locate('「PDF の話 2026」（ ※1）において、');

    expect(hit).not.toBeNull();
    expect(hit!.firstLine).toBe(0);
    expect(hit!.lastLine).toBe(2);
  });

  it('treats the ideographic space as whitespace too', () => {
    const hit = alignLines(['各　位']).locate('各 位');
    expect(hit?.firstLine).toBe(0);
  });

  /**
   * The measured case where pdf-inspector dropped a parenthetical. Nothing
   * looser than exact matching is offered, because a looser match would hide
   * exactly this — content one reading has and the other lacks.
   */
  it('returns null rather than a near miss', () => {
    const lines = ['一行目（括弧つき）', '二行目'];
    expect(alignLines(lines).locate('一行目二行目')).toBeNull();
  });

  it('returns null for empty or whitespace-only text', () => {
    const aligner = alignLines(['本文']);
    expect(aligner.locate('')).toBeNull();
    expect(aligner.locate('  　')).toBeNull();
  });

  it('says when the text begins or ends partway through a line', () => {
    const aligner = alignLines(['一行目 後半の語※3', '二行目 別の語']);

    const value = aligner.locate('後半の語※3');
    expect(value?.startsMidLine).toBe(true);
    expect(value?.endsMidLine).toBe(false);

    const label = aligner.locate('二行目');
    expect(label?.firstLine).toBe(1);
    expect(label?.startsMidLine).toBe(false);
    expect(label?.endsMidLine).toBe(true);
  });

  /** A short block can occur twice on a page; `from` keeps the search moving. */
  it('searches forward from a previous match when asked', () => {
    const aligner = alignLines(['以上', '本文がここに入ります。', '以上']);

    const first = aligner.locate('以上')!;
    expect(first.firstLine).toBe(0);

    const second = aligner.locate('以上', { from: first.end });
    expect(second?.firstLine).toBe(2);

    expect(aligner.locate('以上', { from: second!.end })).toBeNull();
  });

  it('does not count an empty line as a boundary', () => {
    const hit = alignLines(['一行目', '', '二行目']).locate('一行目二行目');
    expect(hit?.breaks).toEqual([3]);
    expect(hit?.lastLine).toBe(2);
  });

  /**
   * The other direction: where in the *line* does the located text stop.
   * That is how a tagged paragraph beginning with a heading is split at the
   * heading's end, in the paragraph's own spacing rather than the heading's.
   */
  it('turns a position in the match back into a position in the line', () => {
    const lines = ['■見出し 本文がここから始まります'];
    const aligner = alignLines(lines);
    const hit = aligner.locate('■見出し')!;

    expect(hit.startInLine).toBe(0);
    expect(hit.endInLine).toBe(4);
    const at = aligner.offsetInLine(0, hit.endInLine);
    // Whitespace at the seam stays on the near side; callers trim.
    expect(lines[0]!.slice(0, at)).toBe('■見出し ');
    expect(lines[0]!.slice(at)).toBe('本文がここから始まります');
    // Past the end is the end.
    expect(aligner.offsetInLine(0, 999)).toBe(lines[0]!.length);
  });

  it('maps offsets correctly through characters outside the BMP', () => {
    const text = '𠀋の話 続き';
    const hit = alignLines(['𠀋の話', '続き']).locate(text);
    expect(hit?.breaks).toHaveLength(1);
    expect(text.slice(hit!.breaks[0]!)).toBe('続き');
  });
});
