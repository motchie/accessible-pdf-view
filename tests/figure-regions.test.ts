import { OPS } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import type { AccessibleDocument, FigureNode } from '../lib/pdf/document-model';
import { collectFigures } from '../lib/pdf/document-model';
import { attachFigureRegions } from '../lib/pdf/pdfjs/figure-regions';

/**
 * A tagged figure too small to crop says so — GitHub issue #14.
 *
 * The tags locate a 10pt icon exactly; that it is under the crop threshold is
 * an answer, not a failure to find it. The figure is marked, so the Reader can
 * say nothing is shown and why, instead of announcing an image.
 */
function fakePdf(ops: Array<[number, unknown]>) {
  const page = {
    ref: { num: 6 },
    pageNumber: 1,
    view: [0, 0, 595, 842],
    getOperatorList: async () => ({
      fnArray: ops.map(([fn]) => fn),
      argsArray: ops.map(([, args]) => args),
    }),
    cleanup: () => {},
  };
  return { getPage: async () => page } as never;
}

function documentWith(figures: FigureNode[]): AccessibleDocument {
  return {
    metadata: { sourceUrl: null, pageCount: 1, producedBy: ['tagged-pdf'] },
    pages: [{ pageNumber: 1, origin: 'tagged-pdf', status: 'available', nodes: figures }],
  };
}

function figure(mcid: number): FigureNode {
  return { type: 'figure', status: 'missing-alt', altTextFieldRead: true, contentIds: [`p6R_mc${mcid}`] };
}

describe('attachFigureRegions', () => {
  const pdf = fakePdf([
    // An icon, 10pt square.
    [OPS.beginMarkedContentProps, ['Figure', 1]],
    [OPS.constructPath, [OPS.fill, [null], [100, 100, 110, 110]]],
    [OPS.endMarkedContent, null],
    // A picture, 100pt square.
    [OPS.beginMarkedContentProps, ['Figure', 2]],
    [OPS.constructPath, [OPS.fill, [null], [200, 200, 300, 300]]],
    [OPS.endMarkedContent, null],
  ]);

  it('marks a figure its tags locate but is too small to crop', async () => {
    const result = await attachFigureRegions(documentWith([figure(1), figure(2)]), pdf);
    const [icon, picture] = collectFigures(result.pages[0]!.nodes).map((found) => found.figure);

    expect(icon).toMatchObject({ tooSmallToShow: true });
    expect(icon!.region).toBeUndefined();

    expect(picture!.tooSmallToShow).toBeUndefined();
    expect(picture!.region?.bbox).toEqual({ x: 200, y: 200, width: 100, height: 100 });
  });

  it('does not mark a figure whose tags locate nothing drawn', async () => {
    const result = await attachFigureRegions(documentWith([figure(9)]), pdf);
    const [missing] = collectFigures(result.pages[0]!.nodes).map((found) => found.figure);

    expect(missing!.tooSmallToShow).toBeUndefined();
  });
});
