import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { BoundingBox } from '../document-model';
import {
  IDENTITY,
  MIN_FIGURE_SIZE_PT,
  intersectsPage,
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
  const pageBox = page.getViewport({ scale: 1 });
  // PDF.js names marked content `p<pageRefNum>R_mc<mcid>`, and the structure
  // tree refers to figures by exactly those strings.
  const pageRef = (page as unknown as { ref?: { num: number } }).ref;
  const prefix = pageRef ? `p${pageRef.num}R_mc` : null;

  const regions: PageImageRegion[] = [];
  const byContentId = new Map<string, BoundingBox>();
  const stack: Matrix[] = [];
  const openContent: Array<string | null> = [];
  let ctm: Matrix = [...IDENTITY] as Matrix;

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
      stack.push([...ctm] as Matrix);
      continue;
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? ([...IDENTITY] as Matrix);
      continue;
    }
    if (fn === OPS.transform) {
      const args = operators.argsArray[index] as number[];
      ctm = multiply(args.slice(0, 6) as Matrix, ctm);
      continue;
    }
    if (fn === OPS.constructPath) {
      // A clip path bounds what follows rather than drawing anything, and is
      // routinely the whole page — counting it would swallow the figure it was
      // meant to constrain.
      const next = operators.fnArray[index + 1];
      if (next === OPS.clip || next === OPS.eoClip) continue;

      // PDF.js precomputes the path's extent, so no geometry is re-derived
      // here. It is in path space, so the current matrix still applies.
      const args = operators.argsArray[index] as [unknown, unknown, ArrayLike<number>?];
      const extent = args?.[2];
      if (!extent || extent.length < 4) continue;

      const bbox = transformedBounds(ctm, extent[0]!, extent[1]!, extent[2]!, extent[3]!);
      if (intersectsPage(bbox, pageBox.width, pageBox.height)) attribute(bbox);
      continue;
    }
    // A form XObject is a nested content stream with its own matrix. PDF.js
    // renders it as save + transform, so tracking it is not optional: skip it
    // and every image inside the form lands at the wrong place and size. One
    // real document scaled its forms by 0.09, which put figures roughly ten
    // times too large and far off the page.
    if (fn === OPS.paintFormXObjectBegin) {
      stack.push([...ctm] as Matrix);
      const args = operators.argsArray[index] as [number[] | undefined, unknown];
      const matrix = args?.[0];
      if (matrix && matrix.length >= 6) ctm = multiply(matrix.slice(0, 6) as Matrix, ctm);
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ([...IDENTITY] as Matrix);
      continue;
    }
    if (!IMAGE_OPS.has(fn)) continue;

    const bbox = unitSquareBounds(ctm);

    // A region off the page cannot be a visible figure. Cropping one produces
    // a blank image, so this is also the backstop for any transform this
    // walker still does not model.
    if (!intersectsPage(bbox, pageBox.width, pageBox.height)) continue;

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
