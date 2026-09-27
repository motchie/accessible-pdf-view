// @vitest-environment node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { nodeToPlainText } from '../lib/pdf/document-model';
import { readPdfDocumentInfo } from '../lib/pdf/pdfjs/metadata';
import {
  coversPageText,
  extractTaggedDocument,
  isUsable,
  type TaggedExtraction,
} from '../lib/pdf/pdfjs/tagged-adapter';
import { buildMinimalPdf, type MinimalPdfOptions } from './helpers/minimal-pdf';

/**
 * A structure tree is found whether or not the document declares it.
 *
 * Tagged PDF requires `/MarkInfo << /Marked true >>` beside the tree, and some
 * producers write the tree alone. Such a document is not conforming, but its
 * tags are still the author's reading order and headings — reported against a
 * real flyer whose eleven headings and reading order were all in the tree, and
 * all ignored until the declaration was added by hand.
 */

async function open(options: MinimalPdfOptions): Promise<PDFDocumentProxy> {
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  return (
    pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<PDFDocumentProxy> } }
  ).getDocument({ data: buildMinimalPdf(options) }).promise;
}

const LINES = ['Heading', 'First paragraph.', 'Second paragraph.'];

describe('readPdfDocumentInfo, on structure', () => {
  it('reports a declared tree as tagged', async () => {
    const info = await readPdfDocumentInfo(await open({ pages: [LINES], tagged: 'declared' }));
    expect(info.isTagged).toBe(true);
    expect(info.hasStructureTree).toBe(true);
  });

  it('finds a tree the document does not declare, without calling it tagged', async () => {
    const info = await readPdfDocumentInfo(await open({ pages: [LINES], tagged: 'undeclared' }));
    expect(info.isTagged).toBe(false);
    expect(info.hasStructureTree).toBe(true);
  });

  it('reports neither for an untagged document', async () => {
    const info = await readPdfDocumentInfo(await open({ pages: [LINES] }));
    expect(info.isTagged).toBe(false);
    expect(info.hasStructureTree).toBe(false);
  });
});

describe('extractTaggedDocument, on an undeclared tree', () => {
  it('reads the tags the same as if they were declared', async () => {
    const readTags = async (tagged: MinimalPdfOptions['tagged']) => {
      const pdf = await open({ pages: [LINES], tagged });
      const extraction = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
      expect(isUsable(extraction)).toBe(true);
      return extraction!.document.pages.flatMap((page) => page.nodes).map(nodeToPlainText);
    };

    const undeclared = await readTags('undeclared');
    expect(undeclared).toEqual(LINES);
    expect(undeclared).toEqual(await readTags('declared'));
  });
});

describe('coversPageText', () => {
  const extract = async (options: MinimalPdfOptions) => {
    const pdf = await open(options);
    const extraction = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
    expect(isUsable(extraction)).toBe(true);
    return extraction!;
  };

  it('accepts a tree that tags the whole page', async () => {
    const extraction = await extract({ pages: [LINES], tagged: 'undeclared' });
    expect(extraction.pageTextLength).toBe(LINES.join('').replace(/\s/g, '').length);
    expect(coversPageText(extraction)).toBe(true);
  });

  it('refuses a tree that tags a corner of it', async () => {
    // A usable tree — it has text — that holds a line of five.
    const extraction = await extract({
      pages: [['Link', 'The body of the document, which no tag reaches.', 'More of it.', 'And more.', 'The end.']],
      tagged: 'undeclared',
      taggedLines: 1,
    });
    expect(coversPageText(extraction)).toBe(false);
  });

  it('does not count alternative text as page text', () => {
    // One well-described image tagged on a page of 100 characters: the
    // description is longer than half the page, but none of it is the page.
    const extraction: TaggedExtraction = {
      roles: {},
      pageTextLength: 100,
      document: {
        metadata: { sourceUrl: null, pageCount: 1, producedBy: ['tagged-pdf'] },
        pages: [
          {
            pageNumber: 1,
            origin: 'tagged-pdf',
            status: 'available',
            nodes: [
              {
                type: 'figure',
                status: 'available',
                alternativeText: 'x'.repeat(80),
                alternativeTextSource: 'author',
              },
              { type: 'paragraph', content: [{ type: 'text', text: 'Ten chars.' }] },
            ],
          },
        ],
      },
    };
    expect(coversPageText(extraction)).toBe(false);
  });
});
