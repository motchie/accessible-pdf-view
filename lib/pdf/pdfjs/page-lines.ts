import type { PDFPageProxy } from 'pdfjs-dist';

/**
 * A page's text as lines, with where each one sits.
 *
 * `getTextContent()` yields runs of glyphs, each with its own position, and one
 * flag, `hasEOL`, that is supposed to mark the end of a line. Measured on real
 * documents it does not: on one release it is set on an empty run *before* some
 * lines, on the last run *of* others, twice in a row here and not at all
 * there. The baseline is reliable where the flag is not — every run on a line
 * shares one `transform[5]` — so lines are rebuilt from geometry and the flag
 * is ignored.
 *
 * ## The one tolerance, and the measurement behind it
 *
 * Runs on the same line do not always share a baseline exactly. A footnote
 * marker is raised: on one page 「※1」 sits at y = 337.0 and the rest of its
 * line at 332.4 — 4.6pt apart, 0.42 of the 11pt font. The same document's page
 * 2 does it seven more times, and an untagged prospectus raises a 「（注）」 the
 * same way. Read strictly, each of those is two lines, and the marker alone
 * becomes a line of its own.
 *
 * So a run joins the current line when its baseline is within half the font
 * height of it. Half sits well clear of both measured populations: the largest
 * raised-marker offset is 0.42 em, and the tightest line pitch in the corpus is
 * 15pt on 11pt text, 1.36 em.
 */
export interface PageLine {
  /** The runs' text, concatenated in content-stream order. */
  text: string;
  /** Leftmost run start, in PDF user space. */
  left: number;
  /** Rightmost run end. */
  right: number;
  /** The baseline the line was started on. */
  baseline: number;
  /** The tallest run's height — the font size, for horizontal text. */
  height: number;
}

const SAME_LINE_SHARE = 0.5;

/** The text-item shape PDF.js yields; its own types are loose here. */
interface TextItem {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
}

export function groupTextLines(items: ReadonlyArray<unknown>): PageLine[] {
  const lines: PageLine[] = [];
  let current: PageLine | null = null;

  for (const raw of items as TextItem[]) {
    // Marked-content markers have no `str`; the end-of-line markers PDF.js
    // emits are empty runs with a position and nothing to show for it.
    if (typeof raw.str !== 'string' || raw.str === '') continue;
    const transform = raw.transform;
    if (!transform || transform.length < 6) continue;

    const left = transform[4]!;
    const baseline = transform[5]!;
    const height = raw.height ?? 0;
    const right = left + (raw.width ?? 0);

    if (
      current &&
      Math.abs(baseline - current.baseline) <= SAME_LINE_SHARE * Math.max(height, current.height)
    ) {
      current.text += raw.str;
      current.left = Math.min(current.left, left);
      current.right = Math.max(current.right, right);
      current.height = Math.max(current.height, height);
      continue;
    }

    current = { text: raw.str, left, right, baseline, height };
    lines.push(current);
  }

  return lines;
}

export async function readPageLines(page: PDFPageProxy): Promise<PageLine[]> {
  const content = await page.getTextContent();
  return groupTextLines(content.items as ReadonlyArray<unknown>);
}
