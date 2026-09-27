import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { BoundingBox } from '../document-model';
import {
  IDENTITY,
  MIN_FIGURE_SIZE_PT,
  intersect,
  multiply,
  transformedBounds,
  touches,
  union,
  unitSquareBounds,
  type Matrix,
} from '../geometry';

/**
 * Walking a page's content stream to find out what it draws, and where.
 *
 * Neither producer gives us a figure's position: pdf-inspector emits a bare
 * `![Image: ...]` placeholder, and PDF.js's structure tree reports a `Figure`
 * element whose only children are marked-content references to *text* — a
 * picture contributes none, so there is nothing to derive a box from.
 *
 * The position is in the content stream instead. This module produces it and
 * stops there: attaching regions to figures is `figure-regions.ts`, and turning
 * a region into pixels is `region-raster.ts`.
 */

/** An image as the page paints it, in PDF user space (origin bottom-left). */
export interface PageImageRegion {
  pageNumber: number;
  bbox: BoundingBox;
}

/**
 * Everything a page draws, attributed two ways.
 *
 * `byContentId` is the exact answer when a PDF is tagged: the tag tree names
 * the marked-content sections a figure covers, so its region is the union of
 * what those sections painted — no matching of draw order against document
 * order, and it works for a figure drawn with vector paths, which paints no
 * image operator at all.
 *
 * `images` is the fallback for untagged documents, where draw order is the
 * only signal available.
 */
export interface PageDrawing {
  images: PageImageRegion[];
  byContentId: Map<string, BoundingBox>;
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
]);

export async function findPageDrawing(page: PDFPageProxy): Promise<PageDrawing> {
  const operators = await page.getOperatorList();
  // PDF.js names marked content `p<pageRefNum>R_mc<mcid>`, and the structure
  // tree refers to figures by exactly those strings.
  const pageRef = (page as unknown as { ref?: { num: number } }).ref;
  const prefix = pageRef ? `p${pageRef.num}R_mc` : null;

  const regions: PageImageRegion[] = [];
  const byContentId = new Map<string, BoundingBox>();
  const openContent: Array<string | null> = [];

  // The clip travels with the matrix: `q` saves both and `Q` restores both.
  // It starts as the page, which is also what keeps a region off the page from
  // becoming a figure — cropping one produces a blank image. `null` means the
  // clips so far share no area, so nothing drawn from here on is visible.
  //
  // The page is `view`, in the same user space as everything drawn: not the
  // viewport, whose width and height swap on a page with `/Rotate 90` and
  // which starts at zero whatever the crop box's origin. Built from the
  // viewport, a rotated portrait page cut every figure off above y = 595.
  const [x0, y0, x1, y1] = page.view;
  const pageClip: BoundingBox = {
    x: Math.min(x0!, x1!),
    y: Math.min(y0!, y1!),
    width: Math.abs(x1! - x0!),
    height: Math.abs(y1! - y0!),
  };
  const stack: Array<{ ctm: Matrix; clip: BoundingBox | null }> = [];
  let ctm: Matrix = [...IDENTITY] as Matrix;
  let clip: BoundingBox | null = pageClip;
  let clipPending = false;

  const save = () => stack.push({ ctm: [...ctm] as Matrix, clip });
  const restore = () => {
    const state = stack.pop();
    ctm = state?.ctm ?? ([...IDENTITY] as Matrix);
    clip = state ? state.clip : pageClip;
  };

  // Only the part inside the clip is drawn, so only that part counts.
  // InDesign routinely places a frame's content larger than the frame: the
  // NaviLens code in the iPDF flyer (issue #12) fills a 144pt square cut down
  // to 36pt, and counting the whole square put the figure's region 80pt below
  // the bottom of the page.
  const visible = (bbox: BoundingBox) => (clip ? intersect(bbox, clip) : null);

  const attribute = (bbox: BoundingBox) => {
    for (const id of openContent) {
      if (!id) continue;
      const existing = byContentId.get(id);
      byContentId.set(id, existing ? union(existing, bbox) : bbox);
    }
  };

  for (let index = 0; index < operators.fnArray.length; index++) {
    const fn = operators.fnArray[index]!;

    if (fn === OPS.beginMarkedContent || fn === OPS.beginMarkedContentProps) {
      const args = operators.argsArray[index] as [unknown, unknown] | undefined;
      const mcid = args?.[1];
      openContent.push(prefix !== null && typeof mcid === 'number' ? `${prefix}${mcid}` : null);
      continue;
    }
    if (fn === OPS.endMarkedContent) {
      openContent.pop();
      continue;
    }
    if (fn === OPS.save) {
      save();
      continue;
    }
    if (fn === OPS.restore) {
      restore();
      continue;
    }
    // PDF.js emits `clip` before the path it applies to, in content-stream
    // order (`W n`): the next path narrows the clip.
    if (fn === OPS.clip || fn === OPS.eoClip) {
      clipPending = true;
      continue;
    }
    if (fn === OPS.transform) {
      const args = operators.argsArray[index] as number[];
      ctm = multiply(args.slice(0, 6) as Matrix, ctm);
      continue;
    }
    if (fn === OPS.constructPath) {
      // PDF.js hands over the painting operator as the first argument. A path
      // ended with `n` paints nothing: usually a clip path (`W n`), which
      // bounds what follows and is routinely the whole page — counting it
      // would swallow the figure it was meant to constrain. PDF.js 6 emits the
      // `clip` *before* this operator; looking for one after it missed every
      // clip, and six of the fourteen figures in the iPDF flyer were cropped
      // as the whole page (GitHub issue #12).
      const args = operators.argsArray[index] as [unknown, unknown, ArrayLike<number>?];
      const isClip = clipPending;
      clipPending = false;

      // PDF.js precomputes the path's extent, so no geometry is re-derived
      // here. It is in path space, so the current matrix still applies.
      const extent = args?.[2];
      if (!extent || extent.length < 4) continue;
      const bbox = transformedBounds(ctm, extent[0]!, extent[1]!, extent[2]!, extent[3]!);

      // A path that clips also paints when it is ended with `f` or `S` rather
      // than `n`; the clip still applies only to what follows it.
      const painted = args?.[0] === OPS.endPath ? null : visible(bbox);
      if (isClip) clip = clip ? intersect(clip, bbox) : null;
      if (painted) attribute(painted);
      continue;
    }
    // A form XObject is a nested content stream with its own matrix. PDF.js
    // renders it as save + transform, so tracking it is not optional: skip it
    // and every image inside the form lands at the wrong place and size. One
    // real document scaled its forms by 0.09, which put figures roughly ten
    // times too large and far off the page.
    if (fn === OPS.paintFormXObjectBegin) {
      save();
      const args = operators.argsArray[index] as [number[] | undefined, unknown];
      const matrix = args?.[0];
      if (matrix && matrix.length >= 6) ctm = multiply(matrix.slice(0, 6) as Matrix, ctm);
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      restore();
      continue;
    }
    if (!IMAGE_OPS.has(fn)) continue;

    // A region off the page cannot be a visible figure, and the page is the
    // outermost clip, so this is also the backstop for any transform this
    // walker still does not model.
    const bbox = visible(unitSquareBounds(ctm));
    if (!bbox) continue;

    attribute(bbox);

    if (bbox.width < MIN_FIGURE_SIZE_PT || bbox.height < MIN_FIGURE_SIZE_PT) continue;
    regions.push({ pageNumber: page.pageNumber, bbox });
  }

  return { images: mergeAdjacent(regions), byContentId };
}

/**
 * Joins images that touch or overlap into one region.
 *
 * A single picture is often painted as several image XObjects — a chart split
 * into strips, a photograph tiled by the exporter. Treating each tile as its
 * own figure both outnumbers the figures the document declares and hands the
 * describer a meaningless sliver. Merging restores the picture the reader
 * actually sees.
 */
function mergeAdjacent(regions: PageImageRegion[]): PageImageRegion[] {
  const merged: PageImageRegion[] = [];

  for (const region of regions) {
    const neighbour = merged.find(
      (candidate) =>
        candidate.pageNumber === region.pageNumber && touches(candidate.bbox, region.bbox),
    );
    if (!neighbour) {
      merged.push({ ...region, bbox: { ...region.bbox } });
      continue;
    }
    neighbour.bbox = union(neighbour.bbox, region.bbox);
  }

  return merged;
}
