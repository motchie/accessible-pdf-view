// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, DocumentPage } from '../lib/pdf/document-model';
import { recoverEmptyPages, toParagraphs } from '../lib/pdf/pdfjs/recover-pages';

/**
 * The rule this guards is the mirror of the project's founding one.
 *
 * "Empty parser output means OCR is needed, never that analysis failed" was
 * always enforced. What was not: **"this page is empty" is a claim too, and it
 * can be just as false.** An untagged prospectus in the local corpus has two
 * pages pdf-inspector drops entirely — no Markdown, no page marker, not flagged for OCR — while PDF.js
 * reads about 900 characters of Japanese from each.
 */
function pageWith(overrides: Partial<DocumentPage> & { pageNumber: number }): DocumentPage {
  return { origin: 'pdf-inspector', status: 'empty', nodes: [], ...overrides };
}

function documentOf(pages: DocumentPage[]): AccessibleDocument {
  return {
    metadata: { sourceUrl: null, pageCount: pages.length, producedBy: ['pdf-inspector'] },
    pages,
  };
}

/** A PDF.js stand-in that yields the given text for the given pages. */
function fakePdf(text: Record<number, string>): PDFDocumentProxy {
  return {
    getPage: async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: (text[pageNumber] ?? '')
          .split('\n')
          .map((line) => ({ str: line, hasEOL: true })),
      }),
      cleanup: () => {},
    }),
  } as unknown as PDFDocumentProxy;
}

describe('recovering pages a producer dropped', () => {
  it('gives a dropped page its text back, and says where it came from', async () => {
    const document = documentOf([
      pageWith({ pageNumber: 1, status: 'available', nodes: [
        { type: 'paragraph', content: [{ type: 'text', text: '読めているページ' }] },
      ] }),
      pageWith({ pageNumber: 2 }),
    ]);

    const result = await recoverEmptyPages(
      document,
      fakePdf({ 2: 'このページには、解析器が落としただけの本文が入っています。' }),
    );

    const recovered = result.pages[1]!;
    expect(recovered.status).toBe('available');
    expect(recovered.origin).toBe('pdf-text');
    expect(recovered.nodes).toHaveLength(1);
    // Provenance travels with it, at the document level too.
    expect(result.metadata.producedBy).toContain('pdf-text');
    // The page that was already fine is untouched, origin included.
    expect(result.pages[0]!.origin).toBe('pdf-inspector');
  });

  /**
   * `requires-ocr` is an explanation. That page has been looked at and OCR is
   * the answer for it; quietly replacing the notice with a few characters of
   * furniture would take away a reader's only route to the content.
   */
  it('leaves a page that is waiting for OCR alone', async () => {
    const document = documentOf([pageWith({ pageNumber: 1, status: 'requires-ocr' })]);
    const result = await recoverEmptyPages(document, fakePdf({ 1: 'これは読み取れる長さのテキストです。' }));

    expect(result.pages[0]!.status).toBe('requires-ocr');
    expect(result.pages[0]!.origin).toBe('pdf-inspector');
    expect(result.metadata.producedBy).not.toContain('pdf-text');
  });

  it('leaves a genuinely empty page empty', async () => {
    const document = documentOf([pageWith({ pageNumber: 1 })]);
    const result = await recoverEmptyPages(document, fakePdf({}));

    expect(result.pages[0]!.status).toBe('empty');
    expect(result).toBe(document);
  });

  /**
   * A dropped page that carries only its folio is not content. Restoring "12"
   * as a paragraph replaces one false statement with a more confusing one.
   */
  it('does not mistake a page number for a page', async () => {
    const document = documentOf([pageWith({ pageNumber: 1 })]);
    const result = await recoverEmptyPages(document, fakePdf({ 1: '12' }));

    expect(result.pages[0]!.status).toBe('empty');
  });

  it('survives a page PDF.js cannot read either', async () => {
    const broken = {
      getPage: async () => {
        throw new Error('page is corrupt');
      },
    } as unknown as PDFDocumentProxy;
    const document = documentOf([pageWith({ pageNumber: 1 })]);

    await expect(recoverEmptyPages(document, broken)).resolves.toBe(document);
  });
});

describe('turning raw text into blocks', () => {
  it('splits on blank lines and joins wrapped lines', () => {
    const nodes = toParagraphs('一行目\n続きの行\n\n次の段落になる十分な長さの文章です。');

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '一行目 続きの行' }],
    });
  });

  it('produces nothing at all from too little text', () => {
    expect(toParagraphs('12')).toEqual([]);
    expect(toParagraphs('   \n\n  ')).toEqual([]);
  });
});
