// @vitest-environment node
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
import { buildMinimalPdf, type MinimalPdfOptions } from './helpers/minimal-pdf';

/**
 * What a tagged figure's `/Alt` says, and what the Reader says about it —
 * GitHub issue #14.
 *
 * PDF.js reports a missing `/Alt` as no `alt` at all and an empty one as
 * `alt: ''`. Both are read as no alternative text. An empty one was once taken
 * for the author's decorative verdict, but neither Office export writes it for
 * that: an author's Decorative becomes an artifact, and PowerPoint writes
 * `/Alt ()` for a shape given no alternative text (#27).
 */
async function figuresOf(figures: NonNullable<MinimalPdfOptions['figures']>) {
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
  const pdf = await (
    pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<PDFDocumentProxy> } }
  ).getDocument({
    data: buildMinimalPdf({ pages: [['Heading', 'Body text.']], tagged: 'declared', figures }),
  }).promise;
  const extraction = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
  return extraction!.document.pages.flatMap((page) => collectFigures(page.nodes)).map((f) => f.figure);
}

describe('tagged figures and their /Alt', () => {
  it('reads no /Alt and an empty /Alt alike, and a written one as the author\'s', async () => {
    const [none, empty, written] = await figuresOf([{}, { alt: '' }, { alt: 'A chart' }]);

    expect(none).toMatchObject({ status: 'missing-alt', altTextFieldRead: true });
    expect(none!.alternativeText).toBeUndefined();
    expect(figurePlaceholderText(ja, none!)).toBe(
      '画像があります。作成者による代替テキストはありません。',
    );

    expect(empty).toMatchObject({ status: 'missing-alt', altTextFieldRead: true });
    expect(empty!.alternativeText).toBeUndefined();
    expect(figurePlaceholderText(ja, empty!)).toBe(
      '画像があります。作成者による代替テキストはありません。',
    );

    expect(written).toMatchObject({ alternativeText: 'A chart', alternativeTextSource: 'author' });
  });

  it('leaves a whitespace-only /Alt as no alternative text', async () => {
    const [blank] = await figuresOf([{ alt: ' ' }]);

    expect(blank).toMatchObject({ status: 'missing-alt' });
    expect(blank!.alternativeText).toBeUndefined();
  });
});

/**
 * Which small figures are shown (#15): the author's own description is what
 * lifts the 24pt floor, and even that does not make a hairline worth showing.
 */
describe('small tagged figures', () => {
  async function located(figures: NonNullable<MinimalPdfOptions['figures']>) {
    (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
      pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
    const pdf = await (
      pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<PDFDocumentProxy> } }
    ).getDocument({
      data: buildMinimalPdf({ pages: [['Heading', 'Body text.']], tagged: 'declared', figures }),
    }).promise;
    const extraction = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
    const document = await attachFigureRegions(extraction!.document, pdf);
    return document.pages.flatMap((page) => collectFigures(page.nodes)).map((f) => f.figure);
  }

  it('shows a described 10pt icon, and not an undescribed one or a described hairline', async () => {
    const [described, undescribed, hairline] = await located([
      { alt: 'A search icon', width: 10, height: 10 },
      { width: 10, height: 10 },
      { alt: 'A dividing rule', width: 200, height: 1 },
    ]);

    expect(described!.region?.bbox).toMatchObject({ width: 10, height: 10 });
    expect(described!.tooSmallToShow).toBeUndefined();

    expect(undescribed!.region).toBeUndefined();
    expect(undescribed!.tooSmallToShow).toBe(true);

    // Kept as a notice, which shows the author's words.
    expect(hairline!.region).toBeUndefined();
    expect(hairline!.tooSmallToShow).toBe(true);
    expect(figurePlaceholderText(ja, hairline!)).toBe('画像: A dividing rule');
  });
});
