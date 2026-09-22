import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, BoundingBox } from '../document-model';
import { collectFigures, mapFigures } from '../document-model';
import { MIN_FIGURE_SIZE_PT, gap, union } from '../geometry';
import { findPageDrawing, type PageDrawing, type PageImageRegion } from './page-drawing';

/**
 * Deciding which part of a page each figure occupies.
 *
 * Two paths, and the difference between them is the difference between knowing
 * and guessing:
 *
 * **Tagged PDFs — exact.** The tag tree names the marked-content sections a
 * figure covers, and `findPageDrawing` attributes every painted operation to
 * the section it sits in. The figure's region is the union of its own sections.
 * No order matching, and it works for a figure drawn with vector paths, which
 * paints no image operator at all.
 *
 * **Untagged PDFs — heuristic.** There is no identifier to join on, so the Nth
 * image painted is matched to the Nth figure declared, with nearby images
 * merged when a page paints more than it declares.
 *
 * The exact path is what fixed two real misreadings: two photographs side by
 * side merged into one region and described as a single composite picture, and
 * a full-width masthead — tagged `Artifact`, i.e. page furniture the author
 * excluded from the structure — matched to a figure it had nothing to do with.
 */

/**
 * Merges the nearest pairs of regions until there are no more than `target`.
 *
 * A single figure is often painted as several image XObjects. One real document
 * lays a row of four images inside one table cell and tags them as a single
 * `Figure`; without this, the first image is cropped as the whole figure and
 * the other three are silently discarded.
 *
 * Only genuinely close neighbours are joined. Beyond `MAX_MERGE_GAP_PT` the
 * merging stops even if the counts still disagree — images that far apart are
 * more likely to be unrelated (an untagged logo, page furniture) than tiles,
 * and inventing a region spanning both would crop a meaningless area.
 */
const MAX_MERGE_GAP_PT = 24;

export function reconcileToCount(
  regions: PageImageRegion[],
  target: number,
): PageImageRegion[] {
  if (target <= 0 || regions.length <= target) return regions;

  const working = regions.map((region) => ({ ...region, bbox: { ...region.bbox } }));

  while (working.length > target) {
    let bestGap = Infinity;
    let bestPair: [number, number] | null = null;

    for (let i = 0; i < working.length; i++) {
      for (let j = i + 1; j < working.length; j++) {
        const distance = gap(working[i]!.bbox, working[j]!.bbox);
        if (distance < bestGap) {
          bestGap = distance;
          bestPair = [i, j];
        }
      }
    }

    if (!bestPair || bestGap > MAX_MERGE_GAP_PT) break;

    const [i, j] = bestPair;
    working[i]!.bbox = union(working[i]!.bbox, working[j]!.bbox);
    working.splice(j, 1);
  }

  return working;
}

/**
 * The extent of a figure's own marked content.
 *
 * Returns nothing when the tags name no content, or when nothing was painted
 * under it — an empty `Figure` element exists in real documents, and inventing
 * a region for one would crop a blank rectangle.
 */
function boundsFor(contentIds: string[] | undefined, drawing: PageDrawing): BoundingBox | null {
  if (!contentIds?.length) return null;

  let bounds: BoundingBox | null = null;
  for (const id of contentIds) {
    const bbox = drawing.byContentId.get(id);
    if (bbox) bounds = bounds ? union(bounds, bbox) : bbox;
  }

  if (!bounds) return null;
  // A hairline or a stray point is not a figure worth cropping.
  return bounds.width >= MIN_FIGURE_SIZE_PT && bounds.height >= MIN_FIGURE_SIZE_PT
    ? bounds
    : null;
}

/**
 * Attaches page regions to the figures already in the document.
 *
 * Where the counts disagree, the surplus on either side is left alone: a figure
 * without a region keeps its placeholder, and an unmatched region is dropped
 * rather than attached to a figure it may not belong to.
 */
export async function attachFigureRegions(
  document: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { signal?: AbortSignal } = {},
): Promise<AccessibleDocument> {
  const pages = await Promise.all(
    document.pages.map(async (page) => {
      if (options.signal?.aborted) return page;

      // Figures are not always top-level — the shared traversal reaches the
      // ones inside table cells and list items too.
      const figures = collectFigures(page.nodes);
      if (figures.length === 0) return page;

      let drawing: PageDrawing;
      try {
        const pdfPage = await pdf.getPage(page.pageNumber);
        drawing = await findPageDrawing(pdfPage);
        pdfPage.cleanup();
      } catch {
        return page;
      }

      // Figures whose tags name their marked content are placed exactly; only
      // the rest fall back to draw order, and only they consume image regions.
      const unresolved = figures.filter(
        ({ figure }) => !figure.region && !boundsFor(figure.contentIds, drawing),
      );
      const reconciled = reconcileToCount(drawing.images, unresolved.length);

      let cursor = 0;
      const nodes = mapFigures(page.nodes, (figure) => {
        if (figure.region) return figure;

        const exact = boundsFor(figure.contentIds, drawing);
        if (exact) {
          return { ...figure, region: { pageNumber: page.pageNumber, bbox: exact } };
        }

        const region = reconciled[cursor++];
        if (!region) return figure;
        return { ...figure, region: { pageNumber: region.pageNumber, bbox: region.bbox } };
      });

      return { ...page, nodes };
    }),
  );

  return { ...document, pages };
}
