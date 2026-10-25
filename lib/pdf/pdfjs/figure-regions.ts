import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, BoundingBox, FigureNode } from '../document-model';
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
 * What a figure's own marked content drew, and whether it can be cropped.
 *
 * `none` when the tags name no content or nothing was painted under it — an
 * empty `Figure` element exists in real documents, and some producers tag only
 * a caption's text, so draw order is still worth trying. `too-small` when the
 * tags did locate the drawing but it is a hairline or an icon: that is an
 * answer, and falling back to draw order would hand the figure someone else's
 * picture. In the iPDF flyer (issue #12) two "i" icons, 11 x 11pt and 4 x 8pt,
 * were shown as the Nippon Lighthouse and iPDF logos.
 */
function boundsFor(
  contentIds: string[] | undefined,
  drawing: PageDrawing,
  authorDescribed = false,
): BoundingBox | 'none' | 'too-small' {
  if (!contentIds?.length) return 'none';

  let bounds: BoundingBox | null = null;
  for (const id of contentIds) {
    const bbox = drawing.byContentId.get(id);
    if (bbox) bounds = bounds ? union(bounds, bbox) : bbox;
  }

  if (!bounds) return 'none';
  // The size floor is for telling a figure from a hairline or a bullet. An
  // author who described the figure in their own words has already said it is
  // one, so its size is no reason to hide it (#15): in the iPDF flyer that is
  // six icons, 4 to 42pt, each with the author's alternative text. Without
  // that, size is all there is to go on, and it does not separate a small
  // icon from a fragment of a larger drawing — a PowerPoint notice has both.
  //
  // Even described, a drawing too thin to show anything — a rule, or one
  // clipped to nothing — stays a notice: as an image it would be a strip of
  // a pixel or two, and the author's words, which the notice shows, would be
  // out of sight in `alt`.
  if (authorDescribed) {
    return Math.min(bounds.width, bounds.height) >= MIN_DESCRIBED_FIGURE_PT ? bounds : 'too-small';
  }
  return bounds.width >= MIN_FIGURE_SIZE_PT && bounds.height >= MIN_FIGURE_SIZE_PT
    ? bounds
    : 'too-small';
}

/**
 * The thinnest side a described figure is shown with, in points (#15). The
 * smallest described icon measured, in the iPDF flyer, is 4 x 8pt.
 */
const MIN_DESCRIBED_FIGURE_PT = 2;

/**
 * Whether the figure's alternative text is the author's own words. Text the
 * document's word processor generated does not count: nobody vouched for it.
 */
function describedByAuthor(figure: FigureNode): boolean {
  return figure.alternativeTextSource === 'author' && Boolean(figure.alternativeText);
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

      // Figures whose tags locate their drawing are placed exactly; only the
      // rest fall back to draw order, and only they consume image regions.
      // Worked out once, in the traversal order `mapFigures` uses below.
      const exacts = figures.map(({ figure }) =>
        figure.region ? null : boundsFor(figure.contentIds, drawing, describedByAuthor(figure)),
      );
      const unresolved = exacts.filter((exact) => exact === 'none').length;
      const reconciled = reconcileToCount(drawing.images, unresolved);

      let cursor = 0;
      const nodes = mapFigures(page.nodes, (figure, index) => {
        if (figure.region) return figure;

        const exact = exacts[index]!;
        if (exact === 'too-small') return { ...figure, tooSmallToShow: true };
        if (exact !== 'none') {
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
