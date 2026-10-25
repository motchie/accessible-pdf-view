// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { collectFigures } from '../lib/pdf/document-model';
import { ja } from '../lib/i18n/ja';
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
  return collectFigures(page.nodes).map(({ figure }) => figure);
}

describe('PowerPoint figures', () => {
  it('reads a shape with no alternative text as having none, not as decorative (#27)', async () => {
    const figures = await slide3();
    // The four dots of the loose route, each `/Alt ()` in the PDF.
    const dots = figures.slice(0, 4);
    for (const dot of dots) {
      expect(dot.alternativeText).toBeUndefined();
      expect(figurePlaceholderText(ja, dot)).not.toContain('装飾');
    }
  });

  it("shows a group's alternative text as the author wrote it (#28)", async () => {
    const figures = await slide3();
    const group = figures.find((figure) => figure.alternativeText?.startsWith('道順の図'));
    expect(group).toMatchObject({
      alternativeText: '道順の図：駅から 4 つ目の角を右へ',
      alternativeTextSource: 'author',
    });
  });
});
