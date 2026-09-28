// @vitest-environment node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
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
 * `alt: ''`. They mean different things: the author gave nothing, or the
 * author said the figure is decorative. Saying "the author gave no
 * alternative text" about the second would be false.
 */
async function figuresOf(figures: NonNullable<MinimalPdfOptions['figures']>) {
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const pdf = await (
    pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<PDFDocumentProxy> } }
  ).getDocument({
    data: buildMinimalPdf({ pages: [['Heading', 'Body text.']], tagged: 'declared', figures }),
  }).promise;
  const extraction = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
  return extraction!.document.pages.flatMap((page) => collectFigures(page.nodes)).map((f) => f.figure);
}

describe('tagged figures and their /Alt', () => {
  it('tells no /Alt, an empty /Alt and a written one apart', async () => {
    const [none, empty, written] = await figuresOf([{}, { alt: '' }, { alt: 'A chart' }]);

    expect(none).toMatchObject({ status: 'missing-alt', altTextFieldRead: true });
    expect(none!.alternativeText).toBeUndefined();
    expect(figurePlaceholderText(ja, none!)).toBe(
      '画像があります。作成者による代替テキストはありません。',
    );

    expect(empty).toMatchObject({
      status: 'available',
      alternativeText: '',
      alternativeTextSource: 'author',
    });
    expect(figurePlaceholderText(ja, empty!)).toBe('装飾的な画像です。内容はありません。');

    expect(written).toMatchObject({ alternativeText: 'A chart', alternativeTextSource: 'author' });
  });

  it('leaves a whitespace-only /Alt as no alternative text', async () => {
    const [blank] = await figuresOf([{ alt: ' ' }]);

    expect(blank).toMatchObject({ status: 'missing-alt' });
    expect(blank!.alternativeText).toBeUndefined();
  });
});
