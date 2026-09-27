// @vitest-environment node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { OPS } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { findPageDrawing } from '../lib/pdf/pdfjs/page-drawing';
import { buildMinimalPdf, type MinimalPdfOptions } from './helpers/minimal-pdf';

/**
 * A clip path draws nothing — GitHub issue #12.
 *
 * InDesign wraps each figure's marked content in a `W n` clip the size of the
 * page. PDF.js 6 emits that as `clip` followed by `constructPath` whose
 * painting operator is `endPath`; the walker only looked for a `clip` *after*
 * the path, so it counted the clip as drawn and six figures in the iPDF flyer
 * were cropped as the whole page. The operator order below is the one PDF.js
 * produced for that document.
 *
 * Clips also bound what is drawn after them: the same flyer's NaviLens code
 * fills a square far larger than the frame that cuts it, and counting the
 * whole square put the figure's region 80pt below the page.
 */
const PAGE_WIDTH = 595.275;
const PAGE_HEIGHT = 841.89;

function fakePage(ops: Array<[number, unknown]>) {
  return {
    ref: { num: 6 },
    pageNumber: 1,
    view: [0, 0, PAGE_WIDTH, PAGE_HEIGHT],
    getOperatorList: async () => ({
      fnArray: ops.map(([fn]) => fn),
      argsArray: ops.map(([, args]) => args),
    }),
  } as never;
}

const wholePage = [0, 0, PAGE_WIDTH, PAGE_HEIGHT];

describe('findPageDrawing', () => {
  it('does not count a clip path as something the figure drew', async () => {
    const drawing = await findPageDrawing(
      fakePage([
        [OPS.beginMarkedContentProps, ['Figure', 1]],
        [OPS.save, null],
        [OPS.clip, null],
        [OPS.constructPath, [OPS.endPath, [null], wholePage]],
        [OPS.constructPath, [OPS.fill, [null], [500, 440, 560, 520]]],
        [OPS.restore, null],
        [OPS.endMarkedContent, null],
      ]),
    );

    expect(drawing.byContentId.get('p6R_mc1')).toEqual({ x: 500, y: 440, width: 60, height: 80 });
  });

  it('still counts a path that is painted', async () => {
    const drawing = await findPageDrawing(
      fakePage([
        [OPS.beginMarkedContentProps, ['Figure', 2]],
        [OPS.constructPath, [OPS.fill, [null], wholePage]],
        [OPS.endMarkedContent, null],
      ]),
    );

    expect(drawing.byContentId.get('p6R_mc2')).toEqual({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
  });

  it('counts only the part of a fill inside the clip', async () => {
    // The NaviLens code in the iPDF flyer: a 144pt square cut down to 36pt.
    const drawing = await findPageDrawing(
      fakePage([
        [OPS.beginMarkedContentProps, ['Figure', 29]],
        [OPS.save, null],
        [OPS.clip, null],
        [OPS.constructPath, [OPS.endPath, [null], [518, 28, 554, 64]]],
        [OPS.constructPath, [OPS.fill, [null], [518, -80, 662, 64]]],
        [OPS.restore, null],
        [OPS.endMarkedContent, null],
      ]),
    );

    expect(drawing.byContentId.get('p6R_mc29')).toEqual({ x: 518, y: 28, width: 36, height: 36 });
  });

  it('lifts the clip at the matching restore', async () => {
    const drawing = await findPageDrawing(
      fakePage([
        [OPS.beginMarkedContentProps, ['Figure', 3]],
        [OPS.save, null],
        [OPS.clip, null],
        [OPS.constructPath, [OPS.endPath, [null], [0, 0, 10, 10]]],
        [OPS.restore, null],
        [OPS.constructPath, [OPS.fill, [null], [100, 100, 200, 200]]],
        [OPS.endMarkedContent, null],
      ]),
    );

    expect(drawing.byContentId.get('p6R_mc3')).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it('crops an image to the page, and drops one wholly outside it', async () => {
    const drawing = await findPageDrawing(
      fakePage([
        [OPS.save, null],
        [OPS.transform, [100, 0, 0, 100, 550, -40]],
        [OPS.paintImageXObject, ['img1', 1, 1]],
        [OPS.restore, null],
        [OPS.save, null],
        [OPS.transform, [100, 0, 0, 100, 700, 0]],
        [OPS.paintImageXObject, ['img2', 1, 1]],
        [OPS.restore, null],
      ]),
    );

    expect(drawing.images).toHaveLength(1);
    expect(drawing.images[0]!.bbox.x).toBe(550);
    expect(drawing.images[0]!.bbox.y).toBe(0);
    expect(drawing.images[0]!.bbox.width).toBeCloseTo(PAGE_WIDTH - 550);
    expect(drawing.images[0]!.bbox.height).toBe(60);
  });
});

/**
 * The page clip is the page in user space, where everything drawn is measured.
 * Built from the viewport instead, it was wrong on two kinds of real page: one
 * turned with `/Rotate 90`, whose viewport swaps width and height, and one
 * whose crop box does not start at the origin.
 */
describe('findPageDrawing, on a real page', () => {
  async function drawingOf(options: Omit<MinimalPdfOptions, 'pages'>) {
    (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
      pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
    const pdf = await (
      pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<PDFDocumentProxy> } }
    ).getDocument({ data: buildMinimalPdf({ pages: [[]], tagged: 'declared', ...options }) }).promise;
    return findPageDrawing(await pdf.getPage(1));
  }

  // A 100pt square high on a 612 x 792 page, marked as MCID 0.
  const square = '/Figure << /MCID 0 >> BDC 0 0 1 rg 400 600 100 100 re f EMC';

  it('keeps a figure above y = 612 on a page turned with /Rotate 90', async () => {
    const drawing = await drawingOf({ drawing: square, rotate: 90 });
    expect([...drawing.byContentId.values()]).toEqual([
      { x: 400, y: 600, width: 100, height: 100 },
    ]);
  });

  it('crops to a crop box that does not start at the origin', async () => {
    const drawing = await drawingOf({ drawing: square, cropBox: [50, 50, 450, 750] });
    expect([...drawing.byContentId.values()]).toEqual([
      { x: 400, y: 600, width: 50, height: 100 },
    ]);
  });
});
