import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, DocumentNode, DocumentPage, PdfFileInfo } from '../lib/pdf/document-model';
import {
  buildReadings,
  chooseReading,
  documentLanguage,
  pagesNeedingExplanation,
  prepareReading,
  readingHeadingCounts,
} from '../lib/reader/readings';

/**
 * The steps the Reader and the outline tests share, each on its own.
 *
 * The outline tests run them end to end on a few PDFs; these pin the decisions
 * inside them that those PDFs do not happen to exercise.
 */

const INFO: PdfFileInfo = { isTagged: false, hasStructureTree: false };

function paragraph(text: string): DocumentNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function heading(text: string): DocumentNode {
  return { type: 'heading', level: 1, content: [{ type: 'text', text }] };
}

function documentOf(pages: Array<Partial<DocumentPage>>, language?: string): AccessibleDocument {
  return {
    metadata: {
      sourceUrl: null,
      pageCount: pages.length,
      producedBy: ['pdf-inspector'],
      ...(language ? { language } : {}),
    },
    pages: pages.map((page, index) => ({
      pageNumber: index + 1,
      origin: 'pdf-inspector',
      status: 'available',
      nodes: [],
      ...page,
    })),
  };
}

/** A PDF.js document no step may touch: the tests below never need one. */
const untouchable = new Proxy({} as PDFDocumentProxy, {
  get(_, property) {
    throw new Error(`the PDF was used (${String(property)})`);
  },
});

describe('chooseReading', () => {
  it('honours the setting where the document offers it', () => {
    expect(chooseReading(['tagged-pdf', 'pdf-inspector'], 'pdf-inspector')).toBe('pdf-inspector');
  });

  it('falls back to the inferred reading when nothing else is offered', () => {
    expect(chooseReading([], 'tagged-pdf')).toBe('pdf-inspector');
  });
});

describe('documentLanguage', () => {
  const japanese = documentOf([{ nodes: [paragraph('これは日本語の文書です。')] }], 'en');

  it('takes the PDF’s own /Lang over everything', async () => {
    expect(await documentLanguage(japanese, { ...INFO, language: 'fr' })).toBe('fr');
  });

  it('takes the producer’s language over detection', async () => {
    expect(await documentLanguage(japanese, INFO)).toBe('en');
  });

  it('falls back to the script when nothing names a language', async () => {
    // No LanguageDetector under Node, so the script is what answers.
    const unnamed = documentOf([{ nodes: [paragraph('これは日本語の文書です。')] }]);
    expect(await documentLanguage(unnamed, INFO)).toBe('ja');
    const latin = documentOf([{ nodes: [paragraph('Plain text.')] }]);
    expect(await documentLanguage(latin, INFO)).toBeUndefined();
  });
});

describe('pagesNeedingExplanation', () => {
  it('lists only the text-less pages the producer gave no cause for', () => {
    const document = documentOf([
      { status: 'available', nodes: [paragraph('Text.')] },
      { status: 'requires-ocr' },
      { status: 'requires-ocr', ocrCauses: ['scanned'] },
      { status: 'requires-ocr', ocrCauses: [] },
    ]);
    expect(pagesNeedingExplanation(document)).toEqual([2, 4]);
  });
});

describe('readingHeadingCounts', () => {
  it('counts a prepared reading as prepared and the rest as they arrived', () => {
    const title = '題名';
    // The title heading is first on the raw reading, so it is not counted;
    // once a recovered page comes before it, it is.
    const raw = documentOf([{ nodes: [] }, { nodes: [heading(title)] }]);
    const prepared = documentOf([{ nodes: [paragraph('取り戻した本文。')] }, { nodes: [heading(title)] }]);
    const readings = new Map([
      ['tagged-pdf', raw],
      ['pdf-inspector', raw],
    ] as const);

    expect(readingHeadingCounts(readings, { 'pdf-inspector': prepared }, { ...INFO, title })).toEqual({
      'tagged-pdf': 0,
      'pdf-inspector': 1,
    });
  });
});

describe('prepareReading', () => {
  it('hands the located document to the rasterizer it is given', async () => {
    const document = documentOf([{ nodes: [paragraph('No figures, no empty pages.')] }]);
    const rasterize = vi.fn(async (positioned: AccessibleDocument) => ({
      document: positioned,
      revoke: () => {},
    }));

    const result = await prepareReading(document, untouchable, { rasterize });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(result.document).toEqual(document);
  });

  it('throws once aborted, and frees the images it made', async () => {
    const controller = new AbortController();
    const revoke = vi.fn();
    const document = documentOf([{ nodes: [paragraph('Text.')] }]);

    const preparing = prepareReading(document, untouchable, {
      signal: controller.signal,
      rasterize: async (positioned) => {
        controller.abort();
        return { document: positioned, revoke };
      },
    });
    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(revoke).toHaveBeenCalledOnce();
  });
});

describe('buildReadings', () => {
  it('throws rather than return a partial reading once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildReadings(documentOf([{ nodes: [paragraph('Text.')] }]), untouchable, {
        sourceUrl: null,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
