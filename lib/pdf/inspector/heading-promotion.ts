import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, DocumentNode } from '../document-model';
import { inlineToPlainText } from '../document-model';
import { splitInline } from '../inline-split';
import { readPageLines } from '../pdfjs/page-lines';
import type { PageLine } from '../pdfjs/page-lines';
import { alignLines } from '../text-alignment';
import { shouldDemote } from './headings';

/**
 * Giving back the headings pdf-inspector merged into the paragraph below them.
 *
 * The headings these documents actually have — 「１.」, 「■」 and 「◆」 lines —
 * are hand-formatted: same font, same size, no weight, no heading style for
 * anyone to tag. pdf-inspector, reasonably, sees body text, and then does the
 * one thing that makes the heading unrecoverable from its output: it joins the
 * line to the paragraph under it **with nothing at the seam**, so the heading's
 * last character and the paragraph's first arrive adjacent in one block.
 *
 * The line break is not gone, only elsewhere. PDF.js still has the page as
 * runs with positions, and `text-alignment.ts` can find the run boundary inside
 * the merged block. That is what makes this possible at all: the split point is
 * not guessed, it is where the document's own line ends.
 *
 * ## Why this is a promotion, when `headings.ts` only demotes
 *
 * `headings.ts` sets out why every rule there only takes headings away: a
 * wrongly invented heading is a claim about the document's structure put in
 * front of someone who cannot check it. That reasoning is not being dropped
 * here; it is being answered on two points.
 *
 * First, the claim being made is smaller than it looks. This reading is
 * already labelled as inferred from layout, and the words are the document's
 * own — the only thing promoted is a line that the author set apart *as* a
 * line: on its own, short of the margin, with the paragraph below it indented
 * away from it. That is what a sighted reader uses to see it as a heading, and
 * no more is claimed than that.
 *
 * Second, the cost of *not* promoting turned out to be real. With the
 * demotions in place, three of five fixtures had no headings the reader could
 * use at all, and the numbered sections were reachable only by reading the
 * whole page. A wrong heading is a misleading stop; no heading, on a document
 * that visibly has sections, is a navigation the reader was denied.
 *
 * ## The shape, and what it was measured against
 *
 * A block is split when its first PDF.js line, and only its first line:
 *
 *   1. **Starts with a section marker.** 「１.」/「1.」 (one or two digits, then a
 *      period, then not another digit) or 「■」/「◆」. Exactly the vocabulary the
 *      corpus's headings use, and no more — 「※」 is excluded because footnotes
 *      have every other property below, and 「①②③」 because in one document
 *      they are list items inside a paragraph.
 *   2. **Ends well short of the block's right edge.** A line that wraps runs to
 *      the margin: across the corpus, every wrapped line ends within 0.51 em
 *      of it. Every real heading ends at least 4.3 em short (the longest runs
 *      to 4.31). Two em separates them.
 *   3. **Has the next line indented past it.** On every heading in the corpus
 *      the body's first line begins exactly one em to the right — the
 *      paragraph indent — and continuation lines do not.
 *
 * Named counter-examples, each stopped by exactly one of those:
 *
 *   - The date and publisher block — 「2026年7月22日」 / 「各位」 / 「株式会社…」 —
 *     is short lines, one after another, with the next line far to the right.
 *     Only the marker rule keeps it out: four digits and no period.
 *   - A 「※1」 footnote with a hanging indent — the continuation begins two em
 *     in. It has the shape of a heading and its body. Only the marker rule
 *     keeps it out.
 *   - A wrapped 「■」 or numbered list item: the first line reaches the margin.
 *     The slack rule keeps it out.
 *
 * Not promoted, on purpose: a block that is a single line — an 「■」 line
 * followed by a table rather than by a paragraph. Without a following line
 * there is nothing to align against, so the split point is not verified, and a
 * standalone 「■」 line is also what a bullet list looks like, one paragraph per
 * item. That case needs its own measurement.
 *
 * Only top-level paragraphs are considered. A paragraph inside a list item or
 * a table cell is already inside a structure, and a heading there would
 * contradict it.
 */

/**
 * A section number or a mark, as the corpus writes them.
 *
 * The digit rule refuses a following digit so that a paragraph opening on a
 * decimal — 「1.5」 and whatever follows it — is never a candidate.
 */
const SECTION_MARKER = /^(?:[0-9０-９]{1,2}[.．](?![0-9０-９])|[■◆])/u;

/**
 * How far short of the block's right edge the heading line must end, in em.
 *
 * Wrapped lines end within 0.51 em of the margin (measured maximum, across the
 * corpus); the tightest real heading ends 4.31 em short. Two is between the
 * two, four times the wrapped maximum and half the tightest heading.
 *
 * Those numbers are where this came from, not something a test re-checks: a
 * test that asserted one document's longest heading still passes would be
 * pinning a measurement rather than a behaviour, and would fail the day the
 * corpus changed without anything being wrong.
 */
const MIN_SLACK_EM = 2;

/**
 * How far past the heading line the body's first line must begin, in em.
 *
 * Measured at 1.00 em on every heading in the corpus. Half of that is well
 * above positional jitter (a tenth of a point) and still requires a real
 * indent.
 */
const MIN_INDENT_EM = 0.5;

/**
 * The level a promoted heading is given.
 *
 * There is nothing in the document to read a level from — that is why these
 * headings needed recovering. Two is the level pdf-inspector's own `##`
 * headings arrive at and one below the `#` it gives a document's top line, so
 * a promoted section sits under the document's title where one exists and
 * claims nothing about nesting among sections.
 */
const PROMOTED_LEVEL = 2;

export async function promoteMergedHeadings(
  document: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { signal?: AbortSignal } = {},
): Promise<AccessibleDocument> {
  const pages = [...document.pages];
  let changed = false;

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    if (options.signal?.aborted) break;
    // Only the inferred reading has this problem; the others have no merged
    // lines to split, and a tagged page's structure is the author's to keep.
    if (page.origin !== 'pdf-inspector' || !page.nodes.some(isCandidate)) continue;

    let lines: PageLine[];
    try {
      const pdfPage = await pdf.getPage(page.pageNumber);
      try {
        lines = await readPageLines(pdfPage);
      } finally {
        pdfPage.cleanup();
      }
    } catch {
      // A page PDF.js cannot read gives nothing to align against, so the
      // block stays merged — which is at least what the producer said.
      continue;
    }

    const nodes = promoteInPage(page.nodes, lines);
    if (nodes !== page.nodes) {
      pages[index] = { ...page, nodes };
      changed = true;
    }
  }

  return changed ? { ...document, pages } : document;
}

/**
 * Splits every top-level paragraph that a PDF.js line boundary and the shape
 * test agree on. Returns the same array when nothing changes.
 */
export function promoteInPage(nodes: DocumentNode[], lines: readonly PageLine[]): DocumentNode[] {
  const aligner = alignLines(lines.map((line) => line.text));
  const out: DocumentNode[] = [];
  let changed = false;
  let from = 0;

  for (const node of nodes) {
    if (!isCandidate(node)) {
      out.push(node);
      continue;
    }

    const text = inlineToPlainText(node.content);
    // Forward from the previous block first, then anywhere: blocks arrive in
    // reading order, but the content stream's order is not always the page's.
    const hit = aligner.locate(text, { from }) ?? aligner.locate(text);
    if (!hit) {
      out.push(node);
      continue;
    }
    from = hit.end;

    // The heading must be a whole line, and there must be a body under it.
    if (hit.startsMidLine || hit.breaks.length === 0) {
      out.push(node);
      continue;
    }

    const block = lines.slice(hit.firstLine, hit.lastLine + 1);
    if (!isSectionHead(block)) {
      out.push(node);
      continue;
    }

    const split = splitInline(node.content, hit.breaks[0]!);
    // A promoted heading clears the same bar an inherited one has to.
    if (!split || shouldDemote(inlineToPlainText(split.head))) {
      out.push(node);
      continue;
    }

    out.push({ type: 'heading', level: PROMOTED_LEVEL, content: split.head });
    out.push({ type: 'paragraph', content: split.tail });
    changed = true;
  }

  return changed ? out : nodes;
}

function isCandidate(node: DocumentNode): node is Extract<DocumentNode, { type: 'paragraph' }> {
  return node.type === 'paragraph' && SECTION_MARKER.test(inlineToPlainText(node.content).trimStart());
}

/**
 * The shape test, on the lines a block occupies. The first line is the
 * candidate; the rest are the body.
 */
export function isSectionHead(block: readonly PageLine[]): boolean {
  const head = block[0];
  const body = block[1];
  if (!head || !body) return false;

  const em = head.height;
  if (!(em > 0)) return false;
  if (!SECTION_MARKER.test(head.text.trimStart())) return false;

  const right = Math.max(...block.map((line) => line.right));
  const slack = (right - head.right) / em;
  const indent = (body.left - head.left) / em;

  return slack >= MIN_SLACK_EM && indent >= MIN_INDENT_EM;
}
