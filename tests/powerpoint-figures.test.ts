// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { collectFigures } from '../lib/pdf/document-model';
import { ja } from '../lib/i18n/ja';
import { attachFigureRegions } from '../lib/pdf/pdfjs/figure-regions';
import { readPdfDocumentInfo } from '../lib/pdf/pdfjs/metadata';
import { extractTaggedDocument } from '../lib/pdf/pdfjs/tagged-adapter';
import { figurePlaceholderText } from '../lib/reader/renderer';

/**
 * What PowerPoint for Microsoft 365 writes into the tags, as exported from
 * `tests/fixtures/powerpoint/pptx-small-figures.pptx`, and what the Reader
 * makes of it.
 *
 * Slide 3 has the two cases #27 and #28 are about: small shapes with no
 * alternative text, which PowerPoint exports as `Figure /Alt ()`, and a group
 * with alternative text, which it exports with 「 (グループ化されたオブジェクト)」
 * appended.
 */
async function slide3() {
  const root = resolve(import.meta.dirname, '../node_modules/pdfjs-dist');
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    pathToFileURL(resolve(root, 'build/pdf.worker.mjs')).href;
  const data = new Uint8Array(
    await readFile(resolve(import.meta.dirname, 'fixtures/powerpoint/pptx-small-figures.pdf')),
  );
  const pdf = await (
    pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<PDFDocumentProxy> } }
  ).getDocument({ data, cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/` })
    .promise;
  const extraction = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
  const page = extraction!.document.pages.find((candidate) => candidate.pageNumber === 3)!;
  const located = (await attachFigureRegions(extraction!.document, pdf)).pages.find(
    (candidate) => candidate.pageNumber === 3,
  )!;

  // What the PDF itself says, so the tests below check the case they are
  // about: a re-export that stopped writing `/Alt ()` must fail here, not pass
  // for the wrong reason.
  const tagged: Array<string | undefined> = [];
  const visit = (node: { role?: string; alt?: string; children?: unknown[] }) => {
    if (node.role === 'Figure') tagged.push(node.alt);
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  visit((await (await pdf.getPage(3)).getStructTree()) as unknown as Parameters<typeof visit>[0]);

  return {
    figures: collectFigures(page.nodes).map(({ figure }) => figure),
    located: collectFigures(located.nodes).map(({ figure }) => figure),
    tagged,
  };
}

describe('PowerPoint figures', () => {
  it('reads a shape with no alternative text as having none, not as decorative (#27)', async () => {
    const { figures, tagged } = await slide3();
    // The four dots of the loose route: `/Alt ()` in the PDF.
    expect(tagged.slice(0, 4)).toEqual(['', '', '', '']);
    for (const dot of figures.slice(0, 4)) {
      expect(dot).toMatchObject({ status: 'missing-alt', altTextFieldRead: true });
      expect(dot.alternativeText).toBeUndefined();
      // Before regions are attached; with them, the too-small wording of the
      // same sentence.
      expect(figurePlaceholderText(ja, dot)).toBe('画像があります。作成者による代替テキストはありません。');
    }
  });

  it("shows a group's alternative text as the author wrote it (#28)", async () => {
    const { figures, tagged } = await slide3();
    expect(tagged).toContain('道順の図：駅から 4 つ目の角を右へ (グループ化されたオブジェクト)');
    const group = figures.find((figure) => figure.alternativeText?.startsWith('道順の図'));
    expect(group).toMatchObject({
      alternativeText: '道順の図：駅から 4 つ目の角を右へ',
      alternativeTextSource: 'author',
    });
  });

  it('shows the described group however thin it is, and not the loose dots (#15)', async () => {
    const { located } = await slide3();
    const group = located.find((figure) => figure.alternativeText?.startsWith('道順の図'))!;
    // 224 x 4pt: under 24pt on one side, shown because the author described it.
    expect(group.region?.bbox.height).toBeLessThan(24);
    expect(group.tooSmallToShow).toBeUndefined();
    for (const dot of located.slice(0, 4)) {
      expect(dot.region).toBeUndefined();
      expect(dot.tooSmallToShow).toBe(true);
    }
  });
});
