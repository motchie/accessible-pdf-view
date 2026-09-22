import type {
  AccessibleDocument,
  FigureNode,
  PdfPageRegion,
} from '../document-model';
import { collectFigures, mapFigures } from '../document-model';

/**
 * Folds generated descriptions into the document already on screen.
 *
 * The counterpart of `ocr/merge.ts`, and it exists for the same reason. A
 * describe run takes minutes, and `describeFigures` works from the document it
 * was handed at the start: every figure it publishes carries that whole
 * snapshot with it. Adopting the snapshot was fine while nothing else could
 * change the document, and stopped being fine when OCR started landing pages
 * one at a time — the two panels sit side by side and neither disables the
 * other, so a page read by OCR during a describe run was silently rolled back
 * to its unread state by the next figure that resolved. Only the figures the
 * run actually worked on travel now.
 *
 * Three rules, each guarding a false claim:
 *
 *   1. **Only a figure the run reached moves.** A description, a decorative
 *      verdict, or a recorded failed attempt — anything else in the run's
 *      document is its stale copy of what was already there.
 *   2. **A figure takes a result only if it is demonstrably the same figure.**
 *      Same page, same position in that page's figure order, *and* the same
 *      region. Position alone is not identity: a page whose nodes were replaced
 *      meanwhile has different figures at the same indices, and attaching a
 *      description to the wrong picture is the exact failure this project
 *      cannot allow, because the mismatch cannot be caught by looking.
 *   3. **The author's own alternative text is never overwritten.** Their words
 *      win, as everywhere else. Text a *word processor* generated is not
 *      theirs and is fair game — that is the whole point of `document-ai`.
 */
export function mergeDescriptions(
  base: AccessibleDocument,
  described: AccessibleDocument,
): AccessibleDocument {
  const byNumber = new Map(described.pages.map((page) => [page.pageNumber, page]));
  let changed = false;

  const pages = base.pages.map((page) => {
    const source = byNumber.get(page.pageNumber);
    if (!source) return page;

    const results = collectFigures(source.nodes).map(({ figure }) => figure);
    if (results.length === 0) return page;

    let touched = false;
    const nodes = mapFigures(page.nodes, (figure, index) => {
      const result = results[index];
      if (!result || !carriesResult(result)) return figure;
      // Rule 2.
      if (!sameFigure(figure, result)) return figure;
      // Rule 3.
      if (figure.alternativeTextSource === 'author') return figure;

      touched = true;
      return { ...figure, ...resultFields(result) };
    });

    if (!touched) return page;
    changed = true;
    return { ...page, nodes };
  });

  return changed ? { ...base, pages } : base;
}

/**
 * Did the run do something to this figure?
 *
 * A generated description and a decorative verdict both arrive as
 * `alternativeTextSource: 'generated'` — a decorative figure's description is
 * the empty string, which is a verdict, not an absence. A figure the run tried
 * and failed on carries `descriptionAttempted` and nothing else.
 */
function carriesResult(figure: FigureNode): boolean {
  return figure.alternativeTextSource === 'generated' || figure.descriptionAttempted === true;
}

/** What a run is allowed to write. Everything else about the figure — its
 * image, caption, region, content ids — belongs to the document on screen. */
function resultFields(result: FigureNode): Partial<FigureNode> {
  const fields: Partial<FigureNode> = {};

  if (result.alternativeTextSource === 'generated') {
    // The two always travel together; see `run-describe.ts`.
    fields.alternativeText = result.alternativeText ?? '';
    fields.alternativeTextSource = 'generated';
    fields.status = result.status;
  }
  if (result.descriptionAttempted) fields.descriptionAttempted = true;

  return fields;
}

function sameFigure(figure: FigureNode, result: FigureNode): boolean {
  return sameRegion(figure.region, result.region);
}

/**
 * Exact equality, deliberately.
 *
 * Both regions are computed by the same pass over the same PDF, so for a figure
 * that did not change they are the same numbers — usually the same object. Any
 * difference at all means something replaced this figure, which is precisely
 * when a description must not be applied.
 */
function sameRegion(a: PdfPageRegion | undefined, b: PdfPageRegion | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.pageNumber === b.pageNumber &&
    a.bbox.x === b.bbox.x &&
    a.bbox.y === b.bbox.y &&
    a.bbox.width === b.bbox.width &&
    a.bbox.height === b.bbox.height
  );
}
