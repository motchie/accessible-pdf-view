/**
 * Finding one producer's line breaks inside another producer's text.
 *
 * Two readers of the same page disagree about where the lines are. pdf-inspector
 * hands back paragraphs with the line breaks already gone — a 「１.」 heading
 * and the paragraph under it arrive as one block, with nothing at the seam
 * where the line ended. PDF.js hands back the opposite: text
 * runs with a position each and no paragraphs at all. Neither alone says where
 * the heading ends. Together they do, once the PDF.js line boundary can be
 * found inside the merged string — and that is the whole of what this module
 * does.
 *
 * It is a primitive, not a heading rule. The same question — *where does this
 * text sit among those lines?* — is what comparing the tagged and inferred
 * readings of a document needs: a block that cannot
 * be located is content one reading has and the other lacks, and a block that
 * can is the same content, which is what makes any disagreement about its
 * structure reportable.
 *
 * ## How much fuzziness, and why exactly that much
 *
 * The two texts are not identical, so a plain substring search will not do. But
 * measured across every fixture in the corpus, the only thing they differ in is
 * **whitespace**. Glyph-level extraction spaces Japanese text at will, and each
 * producer spaces it differently: PDF.js reads 「サ ン プ ル 工 業 株 式 会 社」
 * where pdf-inspector reads 「サ ン プ ル 工 業 株式会社」; pdf-inspector writes
 * 「（ ※1）」 where PDF.js writes 「（※1）」, and that one survives even the
 * Reader's own spacing repair, because 「※」 is not a CJK character. Every
 * comparison here is therefore made with all whitespace removed, and offsets
 * are mapped back into the original text afterwards.
 *
 * Nothing looser is offered, deliberately. Across three of the measured
 * documents every paragraph and heading aligns under this rule — 36 of 36. The
 * one block in a fourth that does not is one where pdf-inspector *dropped* a
 * parenthetical from a table caption: the page reads
 * 「対象文書（評価対象）社内資料2件」 and the block reads 「対象文書社内資料2件」.
 * An edit-distance match would have papered
 * over that, and it is precisely the kind of divergence items 15 and 16 exist to
 * report. Where the search fails, it fails: `locate` returns null and the
 * caller keeps what it had.
 *
 * ## What "the lines" are
 *
 * Callers supply the lines as strings in reading order and get line indices
 * back, so whatever else they know about a line — its position on the page,
 * its font size — stays with them. The search is in the lines' own order; the
 * lines are not sorted, because the caller's order is the content-stream order
 * and any other one is a claim about reading order that this module cannot
 * check.
 */

export interface TextAlignment {
  /** The line on which the text begins. */
  firstLine: number;
  /** The line on which the text ends, inclusive. */
  lastLine: number;
  /** The text begins partway through `firstLine` — something else precedes it
   * on that line. */
  startsMidLine: boolean;
  /** The text ends partway through `lastLine`. */
  endsMidLine: boolean;
  /**
   * Where each line after the first begins, as offsets into the text that was
   * located: the part of the text on line `firstLine + i` is
   * `text.slice(breaks[i - 1] ?? 0, breaks[i] ?? text.length)`.
   *
   * Whitespace that sits at a boundary in the located text has no counterpart
   * in the lines, so it may land on either side. Trim.
   */
  breaks: number[];
  /**
   * Where the match sits among all the lines' text, whitespace removed. Only
   * meaningful for passing back as `from`, to keep successive searches moving
   * forward through the page.
   */
  start: number;
  end: number;
  /**
   * How far into `firstLine` the match begins, and how far into `lastLine` it
   * ends, counted in that line's whitespace-free characters. `offsetInLine`
   * turns either into a position in the line's own text — which is how a
   * caller splits the *line* where the located text stops, rather than the
   * text where the line stops.
   */
  startInLine: number;
  endInLine: number;
}

export interface LineAligner {
  /**
   * Finds `text` among the lines, or returns null when it is not there.
   *
   * `from` restricts the search to matches at or after that position, in the
   * coordinates a previous result's `end` is given in. Blocks arrive in reading
   * order, and a short one — a closing 「以上」, a repeated label — can occur
   * more than once on a page; searching onward from the previous match is what
   * keeps the second occurrence from being mistaken for the first.
   */
  locate(text: string, options?: { from?: number }): TextAlignment | null;
  /**
   * The position in line `line`'s original text of its `tightOffset`-th
   * whitespace-free character; the line's length when `tightOffset` is past
   * the end. Whitespace before that character is left on the near side.
   */
  offsetInLine(line: number, tightOffset: number): number;
}

export function alignLines(lines: readonly string[]): LineAligner {
  const tightLines = lines.map(tighten);
  const lineStart: number[] = [];
  let joined = '';
  for (const line of tightLines) {
    lineStart.push(joined.length);
    joined += line;
  }

  /** The line whose span covers a position in `joined`. */
  const lineAt = (position: number): number => {
    let low = 0;
    let high = lineStart.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStart[mid]! <= position) low = mid;
      else high = mid - 1;
    }
    // Empty lines share their start with the line after them, and the search
    // lands on the last of them — which is the one that actually holds the
    // position, since an empty line holds nothing.
    return low;
  };

  return {
    locate(text, options = {}) {
      const { tight, offsets } = tightenWithOffsets(text);
      if (tight.length === 0) return null;

      const start = joined.indexOf(tight, options.from ?? 0);
      if (start < 0) return null;
      const end = start + tight.length;

      const firstLine = lineAt(start);
      const lastLine = lineAt(end - 1);

      const breaks: number[] = [];
      for (let line = firstLine + 1; line <= lastLine; line++) {
        // An empty line between two others is not a boundary in the text.
        if (tightLines[line]!.length === 0) continue;
        breaks.push(offsets[lineStart[line]! - start]!);
      }

      return {
        firstLine,
        lastLine,
        startsMidLine: start !== lineStart[firstLine],
        endsMidLine: end !== lineStart[lastLine]! + tightLines[lastLine]!.length,
        breaks,
        start,
        end,
        startInLine: start - lineStart[firstLine]!,
        endInLine: end - lineStart[lastLine]!,
      };
    },

    offsetInLine(line, tightOffset) {
      const text = lines[line] ?? '';
      const { offsets } = tightenWithOffsets(text);
      return offsets[Math.min(tightOffset, offsets.length - 1)] ?? text.length;
    },
  };
}

/** Every Unicode white space, including the ideographic space U+3000. */
const WHITESPACE = /\s/u;

function tighten(text: string): string {
  return text.replace(/\s+/gu, '');
}

/**
 * Removes whitespace and remembers where each surviving code unit came from,
 * so a position in the tightened text can be turned back into one in the
 * original. `offsets[k]` is the original index of tightened index `k`; one
 * extra entry at the end maps the tightened length to the original length.
 */
function tightenWithOffsets(text: string): { tight: string; offsets: number[] } {
  let tight = '';
  const offsets: number[] = [];
  let index = 0;
  for (const character of text) {
    if (!WHITESPACE.test(character)) {
      for (let unit = 0; unit < character.length; unit++) offsets.push(index + unit);
      tight += character;
    }
    index += character.length;
  }
  offsets.push(text.length);
  return { tight, offsets };
}
