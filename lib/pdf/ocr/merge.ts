import type { AccessibleDocument, DocumentPage, FigureNode } from '../document-model';
import { collectFigures } from '../document-model';

/**
 * Folds OCR results into the document already on screen.
 *
 * OCR runs after the document has been parsed, rendered and possibly annotated
 * with figure descriptions, so it cannot replace the document — only the pages
 * it actually read. Everything else must survive untouched, including work the
 * user waited for.
 *
 * Four rules:
 *
 *   1. **A page that OCR could not read is left alone.** An empty result is not
 *      evidence the page is empty; it is evidence OCR failed on it. Overwriting
 *      a `requires-ocr` page with an `empty` one would turn "we could not read
 *      this" into "there is nothing here", which is exactly the false claim
 *      this project refuses to make.
 *   2. **A page that already had text is never overwritten.** OCR is only ever
 *      offered for pages that produced none; if one is passed in anyway, the
 *      extracted text wins, because it is the document's own.
 *   3. **A located figure survives the page it was on.** Replacing the page's
 *      nodes outright used to delete it — image, region and any description
 *      someone had just waited minutes for — so a page with a picture and no
 *      text lost the picture by being read. The figures the producer located
 *      are carried to the end of the page and counted in `carriedFigures`,
 *      because the end is a position OCR did not give them: recognised text
 *      carries no coordinates, so there is nowhere to put them back. The
 *      Reader says so on the page rather than letting the new order pass as
 *      the document's own.
 *   4. **`producedBy` gains `ocr`** so the Reader can say the document is now a
 *      mix, and the Markdown view inherits that too.
 */
export function mergeOcrPages(
  base: AccessibleDocument,
  ocr: AccessibleDocument,
): AccessibleDocument {
  const byNumber = new Map<number, DocumentPage>();
  for (const page of ocr.pages) {
    // Rule 1: nothing read, nothing to merge.
    if (page.nodes.length > 0) byNumber.set(page.pageNumber, page);
  }
  if (byNumber.size === 0) return base;

  const pages = base.pages.map((page) => {
    const replacement = byNumber.get(page.pageNumber);
    // Rule 2. It is also what keeps a progressive run from merging the same
    // page twice: the second time it arrives, the page is already `available`.
    if (!replacement || page.status === 'available') return page;

    // Rule 3.
    const carried = figuresWorthCarrying(page, replacement);
    return {
      ...page,
      origin: 'ocr' as const,
      status: 'available' as const,
      nodes: carried.length > 0 ? [...replacement.nodes, ...carried] : replacement.nodes,
      ...(carried.length > 0 ? { carriedFigures: carried.length } : {}),
    };
  });

  const producedBy = base.metadata.producedBy.includes('ocr')
    ? base.metadata.producedBy
    : [...base.metadata.producedBy, 'ocr' as const];

  return { ...base, metadata: { ...base.metadata, producedBy }, pages };
}

/**
 * The figures on a page that must outlive the OCR reading of it.
 *
 * A region is the test: it means the producer found this figure in the content
 * stream and can point at where it is, so it is a fact about the page. A
 * figure without one is a bare placeholder, and the engine's reading of the
 * page supersedes it.
 *
 * Nothing is carried when the engine reported figures of its own. Its account
 * of the page is then complete, and stacking a second account beside it would
 * tell the reader the page holds more pictures than it does. No bundled
 * provider does this — Chrome's model returns paragraphs only — so today this
 * is a boundary rather than a behaviour.
 */
function figuresWorthCarrying(page: DocumentPage, replacement: DocumentPage): FigureNode[] {
  if (collectFigures(replacement.nodes).length > 0) return [];
  return collectFigures(page.nodes)
    .map(({ figure }) => figure)
    .filter((figure) => figure.region !== undefined);
}

/** Pages the merge actually changed, so the UI can report what was read rather
 * than what was attempted. */
export function ocrPagesRead(ocr: AccessibleDocument): number[] {
  return ocr.pages.filter((page) => page.nodes.length > 0).map((page) => page.pageNumber);
}
