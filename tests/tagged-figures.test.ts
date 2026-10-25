// @vitest-environment node
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
