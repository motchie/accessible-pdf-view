import { describe, expect, it } from 'vitest';
import { adaptInspectorResult, deriveCapabilities } from '../lib/pdf/inspector/adapter';
import { markdownToPages, normalizeCjkSpacing } from '../lib/pdf/inspector/markdown-to-document';
import { documentToPlainText, inlineToPlainText } from '../lib/pdf/document-model';
import { inspectorResult } from './helpers/inspector-result';

/** §30.1 — pdf-inspector result -> Document Model. */
describe('pdf-inspector result -> Document Model', () => {
  it('splits Markdown into pages using the page markers', () => {
    const { document } = adaptInspectorResult(
      inspectorResult({
        pageCount: 2,
        markdown:
          '<!-- Page 1 -->\n\n# Title\n\nFirst page body.\n\n<!-- Page 2 -->\n\nSecond page body.\n',
      }),
      'https://example.com/doc.pdf',
    );

    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]!.pageNumber).toBe(1);
    expect(document.pages[0]!.nodes[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(documentToPlainText(document)).toContain('Second page body.');
    expect(document.metadata.sourceUrl).toBe('https://example.com/doc.pdf');
    expect(document.metadata.producedBy).toEqual(['pdf-inspector']);
  });

  it('attributes content appearing before the first marker to page 1', () => {
    const { document } = adaptInspectorResult(
      inspectorResult({ pageCount: 1, markdown: 'Loose text.\n' }),
      null,
    );

    expect(document.pages[0]!.nodes).toHaveLength(1);
    expect(document.pages[0]!.status).toBe('available');
  });

  it('keeps the document title out of the body when it is repeated as a heading', () => {
    const { document } = adaptInspectorResult(
      inspectorResult({
        title: 'Quarterly Report',
        markdown: '<!-- Page 1 -->\n\n# Quarterly Report\n\nBody.\n',
      }),
      null,
    );

    // The adapter keeps it; the renderer drops it. Assert the model is faithful.
    expect(document.metadata.title).toBe('Quarterly Report');
    expect(document.pages[0]!.nodes[0]).toMatchObject({ type: 'heading' });
  });
});

/** §30.4 — headings. */
describe('headings', () => {
  it('preserves heading levels and clamps out-of-range ones', () => {
    const [page] = markdownToPages('# A\n\n## B\n\n###### F\n');
    expect(page!.nodes.map((node) => (node.type === 'heading' ? node.level : null))).toEqual([
      1, 2, 6,
    ]);
  });
});

/** §30.5 — lists. */
describe('lists', () => {
  it('converts unordered and ordered lists, including nesting', () => {
    const [page] = markdownToPages('- one\n- two\n  - nested\n\n1. first\n2. second\n');
    const [unordered, ordered] = page!.nodes;

    expect(unordered).toMatchObject({ type: 'list', ordered: false });
    expect(ordered).toMatchObject({ type: 'list', ordered: true });

    const nested = (unordered as Extract<typeof unordered, { type: 'list' }>).items[1]!.blocks;
    expect(nested.some((block) => block.type === 'list')).toBe(true);
  });

  it('records a start offset only when the list does not start at 1', () => {
    const [normal] = markdownToPages('1. a\n2. b\n');
    expect(normal!.nodes[0]).not.toHaveProperty('start');

    const [offset] = markdownToPages('3. a\n4. b\n');
    expect(offset!.nodes[0]).toMatchObject({ start: 3 });
  });
});

/** §30.6 — tables. */
describe('tables', () => {
  it('promotes the first row to a header row', () => {
    const [page] = markdownToPages('| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n');
    const table = page!.nodes[0];

    expect(table).toMatchObject({ type: 'table' });
    if (table?.type !== 'table') throw new Error('expected a table');

    expect(table.header?.cells.map((cell) => inlineToPlainText(cell.content))).toEqual([
      'Name',
      'Value',
    ]);
    expect(table.header?.cells.every((cell) => cell.header)).toBe(true);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells[0]!.header).toBe(false);
  });

  it('does not create a header row when the first row is blank', () => {
    const [page] = markdownToPages('|  |  |\n| --- | --- |\n| A | 1 |\n');
    const table = page!.nodes[0];
    if (table?.type !== 'table') throw new Error('expected a table');

    expect(table.header).toBeUndefined();
    expect(table.rows).toHaveLength(2);
  });
});

/** §30.7 — links. */
describe('links', () => {
  it('converts Markdown links and marks bare URLs', () => {
    const [page] = markdownToPages(
      'See [the site](https://example.com/a) and [https://example.com/b](https://example.com/b).\n',
    );
    const paragraph = page!.nodes[0];
    if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');

    const links = paragraph.content.filter((node) => node.type === 'link');
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ href: 'https://example.com/a' });
    expect(links[0]).not.toHaveProperty('isBareUrl');
    expect(links[1]).toMatchObject({ isBareUrl: true });
  });

  it('drops a dangerous scheme but keeps its text', () => {
    const [page] = markdownToPages('[click me](javascript:alert(1))\n');
    const paragraph = page!.nodes[0];
    if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');

    expect(paragraph.content.some((node) => node.type === 'link')).toBe(false);
    expect(inlineToPlainText(paragraph.content)).toBe('click me');
  });
});

/** §30.8 — figure placeholder. */
describe('figures', () => {
  it('treats an image-only paragraph as a figure with no fabricated alt text', () => {
    const [page] = markdownToPages('![Image: 640x480](image1.png)\n');
    const figure = page!.nodes[0];

    expect(figure).toMatchObject({ type: 'figure', status: 'missing-alt' });
    // "Image: 640x480" describes the slot, not the picture, so it must not
    // become an alternative text.
    expect(figure).not.toHaveProperty('alternativeText');
  });

  it('keeps a genuine alternative text supplied by the document', () => {
    const [page] = markdownToPages('![Company logo](logo.png)\n');
    expect(page!.nodes[0]).toMatchObject({
      type: 'figure',
      status: 'available',
      alternativeText: 'Company logo',
    });
  });
});

/** §30.9 — OCR-required detection. This is the behaviour the brief calls out
 * as most important: empty output is a document state, not a failure. */
describe('OCR-required detection', () => {
  it('reports an empty text-based result as requiring OCR, not as an error', () => {
    const capabilities = deriveCapabilities(
      inspectorResult({ pdfType: 'TextBased', markdown: '', pagesNeedingOcr: [1] }),
    );

    expect(capabilities.hasExtractableText).toBe(false);
    expect(capabilities.requiresOcr).toBe(true);
    expect(capabilities.ocrPages).toEqual([1]);
  });

  it('flags scanned and image-based documents', () => {
    expect(deriveCapabilities(inspectorResult({ pdfType: 'Scanned' }))).toMatchObject({
      isScanned: true,
      requiresOcr: true,
    });
    expect(deriveCapabilities(inspectorResult({ pdfType: 'ImageBased' }))).toMatchObject({
      isImageBased: true,
      requiresOcr: true,
    });
  });

  it('does not require OCR for a document that produced text on every page', () => {
    const capabilities = deriveCapabilities(
      inspectorResult({ markdown: '# Title\n\nBody.\n', pagesNeedingOcr: [] }),
    );
    expect(capabilities.requiresOcr).toBe(false);
    expect(capabilities.hasExtractableText).toBe(true);
  });

  it('marks pages with no content but an OCR flag as requires-ocr', () => {
    const { document } = adaptInspectorResult(
      inspectorResult({
        pageCount: 3,
        pagesNeedingOcr: [2],
        markdown: '<!-- Page 1 -->\n\nText.\n\n<!-- Page 3 -->\n\nMore text.\n',
      }),
      null,
    );

    expect(document.pages.map((page) => page.status)).toEqual([
      'available',
      'requires-ocr',
      'available',
    ]);
  });

  /**
   * A scanned deck often leaks one glyph per page — a page number burnt into
   * the artwork, or a stray digit. That used to flip the page to `available`,
   * so the OCR notice listed 27 unreadable pages while the OCR panel, which
   * reads page status, offered buttons for 5. Same document, two answers.
   *
   * pdf-inspector examined the page and said its text is not extractable. One
   * escaped character does not refute that — and the character is still kept.
   */
  it('keeps a page needing OCR flagged even when a stray glyph came through', () => {
    const { document, capabilities } = adaptInspectorResult(
      inspectorResult({
        pageCount: 2,
        pagesNeedingOcr: [1, 2],
        markdown: '<!-- Page 1 -->\n\n5\n\n<!-- Page 2 -->\n\n6\n',
      }),
      null,
    );

    expect(document.pages.map((page) => page.status)).toEqual([
      'requires-ocr',
      'requires-ocr',
    ]);
    // What the two lists are computed from must agree.
    expect(
      document.pages.filter((page) => page.status === 'requires-ocr').map((p) => p.pageNumber),
    ).toEqual(capabilities.ocrPages);
    // The fragment is not thrown away.
    expect(document.pages[0]!.nodes).toHaveLength(1);
  });
});

/** A Japanese-specific extraction artefact called out in the brief. */
describe('Japanese spacing', () => {
  it('collapses spaces inserted between adjacent CJK characters', () => {
    expect(normalizeCjkSpacing('こ ん に ち は')).toBe('こんにちは');
    expect(normalizeCjkSpacing('日 本 語 の 文 章')).toBe('日本語の文章');
  });

  it('keeps spaces that separate scripts, where they carry meaning', () => {
    expect(normalizeCjkSpacing('日本語 text')).toBe('日本語 text');
    expect(normalizeCjkSpacing('text 日本語')).toBe('text 日本語');
    expect(normalizeCjkSpacing('hello world')).toBe('hello world');
    // Latin abbreviations next to Japanese are ordinary typography.
    expect(normalizeCjkSpacing('SAMPLE グループは')).toBe('SAMPLE グループは');
    expect(normalizeCjkSpacing('詳細は HP にて')).toBe('詳細は HP にて');
  });

  it('rejoins digits that were split apart next to Japanese text', () => {
    // The shape glyph-level extraction produces on a real page.
    expect(normalizeCjkSpacing('2026 年 7 月 2 2 日')).toBe('2026年7月22日');
    expect(normalizeCjkSpacing('延べ 6,500 人以上')).toBe('延べ6,500人以上');
    expect(normalizeCjkSpacing('約 4,000 冊')).toBe('約4,000冊');
    expect(normalizeCjkSpacing('40 を超える')).toBe('40を超える');
  });

  it('leaves digit sequences alone when they are not glyph-split', () => {
    // A multi-digit token means these are real, separate numbers.
    expect(normalizeCjkSpacing('在庫は 5 10 個です')).toBe('在庫は5 10個です');
    // No CJK anywhere: nothing to do.
    expect(normalizeCjkSpacing('Chapter 3 was good')).toBe('Chapter 3 was good');
    expect(normalizeCjkSpacing('items: 1 2 3')).toBe('items: 1 2 3');
  });
});

describe('the producer’s OCR reasons', () => {
  /**
   * Carried onto the page rather than dropped. Three of the four codes say what
   * a content-stream walk would say, so the walk is skipped for them; the
   * fourth, `suspected_garbled_text`, says something the walk cannot express.
   */
  it('translates the codes it knows onto the pages they belong to', () => {
    const { document } = adaptInspectorResult(
      inspectorResult({
        pdfType: 'Mixed',
        pageCount: 4,
        pagesNeedingOcr: [1, 2, 3],
        ocrReasonsByPage: [
          { page: 1, reasons: ['suspected_garbled_text'] },
          { page: 2, reasons: ['vector_text'] },
          { page: 3, reasons: ['scanned', 'no_text'] },
        ],
        hasEncodingIssues: true,
      }),
      null,
    );

    expect(document.pages[0]!.ocrCauses).toEqual(['garbled-text']);
    expect(document.pages[1]!.ocrCauses).toEqual(['vector-text']);
    // Order is the producer's, most specific first.
    expect(document.pages[2]!.ocrCauses).toEqual(['scanned', 'no-text']);
    // A page it said nothing about carries nothing.
    expect(document.pages[3]!.ocrCauses).toBeUndefined();
  });

  /**
   * The vocabulary is the producer's and may grow. An unknown code must reach
   * the reader as "we do not know", never as a confident wrong sentence — the
   * page falls back to being looked at directly.
   */
  it('drops a code this build does not know', () => {
    const { document } = adaptInspectorResult(
      inspectorResult({
        pdfType: 'Scanned',
        pagesNeedingOcr: [1],
        ocrReasonsByPage: [{ page: 1, reasons: ['some_future_reason'] }],
      }),
      null,
    );

    expect(document.pages[0]!.ocrCauses).toBeUndefined();
    expect(document.pages[0]!.status).toBe('requires-ocr');
  });
});
