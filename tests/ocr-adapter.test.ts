import { describe, expect, it } from 'vitest';
import type {
  AccessibleDocument,
  DocumentNode,
  FigureNode,
} from '../lib/pdf/document-model';
import { inlineToPlainText } from '../lib/pdf/document-model';
import { mergeOcrPages } from '../lib/pdf/ocr/merge';
import { adaptInspectorResult } from '../lib/pdf/inspector/adapter';
import { adaptOcrResult } from '../lib/pdf/ocr/adapter';
import { MockOcrProvider } from '../lib/pdf/ocr/mock-provider';
import { requiresConsent } from '../lib/pdf/ocr/registry';
import type { OcrResult } from '../lib/pdf/ocr/provider';
import { inspectorResult } from './helpers/inspector-result';

/** §30.2 — OCR result -> Document Model. */
describe('OCR result -> Document Model', () => {
  const result: OcrResult = {
    providerId: 'test',
    pages: [
      {
        pageNumber: 3,
        confidence: 0.82,
        blocks: [
          { type: 'heading', level: 1, text: '表の見出し' },
          { type: 'paragraph', text: 'OCR が読んだ段落です。' },
          { type: 'list', ordered: true, items: ['一つ目', '二つ目'] },
          {
            type: 'table',
            hasHeader: true,
            rows: [
              ['項目', '内容'],
              ['電話', '03-0000-0000'],
            ],
          },
          { type: 'figure', caption: '写真の説明' },
          { type: 'unknown', text: '詳細は https://example.com/info を参照。' },
        ],
      },
    ],
  };

  it('maps every block type onto the shared model', () => {
    const document = adaptOcrResult(result, { sourceUrl: null, pageCount: 4 });
    const page = document.pages[0]!;

    expect(page.origin).toBe('ocr');
    expect(page.pageNumber).toBe(3);
    expect(page.nodes.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'table',
      'figure',
      'unknown',
    ]);
  });

  it('builds a header row when the provider says the table has one', () => {
    const table = adaptOcrResult(result).pages[0]!.nodes.find((node) => node.type === 'table');
    if (table?.type !== 'table') throw new Error('expected a table');

    expect(table.header?.cells.map((cell) => inlineToPlainText(cell.content))).toEqual([
      '項目',
      '内容',
    ]);
    expect(table.rows).toHaveLength(1);
  });

  it('recovers bare URLs from recognised text as real links', () => {
    const unknown = adaptOcrResult(result).pages[0]!.nodes.find(
      (node) => node.type === 'unknown',
    );
    if (unknown?.type !== 'unknown') throw new Error('expected an unknown node');

    const link = unknown.content.find((node) => node.type === 'link');
    expect(link).toMatchObject({ href: 'https://example.com/info', isBareUrl: true });
  });

  it('never invents an alternative text for a figure', () => {
    const figure = adaptOcrResult(result).pages[0]!.nodes.find(
      (node) => node.type === 'figure',
    );
    expect(figure).toMatchObject({ type: 'figure', status: 'missing-alt', caption: '写真の説明' });
    expect(figure).not.toHaveProperty('alternativeText');
  });

  it('marks a page the provider read nothing from as still requiring OCR', () => {
    const empty = adaptOcrResult({ providerId: 'test', pages: [{ pageNumber: 1, blocks: [] }] });
    expect(empty.pages[0]!.status).toBe('requires-ocr');
  });
});

/** §21 — mixed PDFs. The point of a shared model is that two producers can
 * contribute to one document. */
describe('mixed documents', () => {
  it('merges OCR pages into the inspector document without losing extracted text', () => {
    const { document: fromInspector } = adaptInspectorResult(
      inspectorResult({
        pageCount: 3,
        pagesNeedingOcr: [2],
        markdown: '<!-- Page 1 -->\n\nPage one text.\n\n<!-- Page 3 -->\n\nPage three text.\n',
      }),
      null,
    );

    const fromOcr = adaptOcrResult({
      providerId: 'test',
      pages: [{ pageNumber: 2, blocks: [{ type: 'paragraph', text: 'Recognised page two.' }] }],
    });

    const merged = mergeOcrPages(fromInspector, fromOcr);

    expect(merged.pages.map((page) => page.origin)).toEqual([
      'pdf-inspector',
      'ocr',
      'pdf-inspector',
    ]);
    expect(merged.pages.map((page) => page.status)).toEqual([
      'available',
      'available',
      'available',
    ]);
    expect(merged.metadata.producedBy).toEqual(['pdf-inspector', 'ocr']);
  });

  it('does not let an empty OCR page erase text the inspector already found', () => {
    const { document: fromInspector } = adaptInspectorResult(
      inspectorResult({ pageCount: 1, markdown: 'Real text.\n' }),
      null,
    );
    const fromOcr = adaptOcrResult({
      providerId: 'test',
      pages: [{ pageNumber: 1, blocks: [] }],
    });

    const merged = mergeOcrPages(fromInspector, fromOcr);
    expect(merged.pages[0]!.origin).toBe('pdf-inspector');
    expect(merged.pages[0]!.nodes).toHaveLength(1);
  });
});

describe('OCR providers', () => {
  it('produces structured blocks rather than a flat string', async () => {
    const provider = new MockOcrProvider();
    const result = await provider.analyze({
      pages: [{ pageNumber: 1, image: new ArrayBuffer(8) }],
    });

    expect(result.pages[0]!.blocks[0]).toMatchObject({ type: 'paragraph' });
  });

  it('reports that no bundled provider transmits data externally', () => {
    expect(requiresConsent(new MockOcrProvider())).toBe(false);
  });
});

/**
 * A page can hold a picture and no text at all — a scan with a photograph on
 * it, a slide that is one diagram. OCR reading such a page used to delete the
 * picture: the merge replaced the page's nodes outright, taking the figure's
 * region, its rendered image and any description generated for it.
 *
 * They are carried to the end of the page instead. The end is not where they
 * were, and nothing in the OCR result can say where they were — recognised
 * text carries no coordinates — so the count travels with the page and the
 * Reader says the order changed.
 */
describe('a figure on a page OCR reads', () => {
  const region = { pageNumber: 1, bbox: { x: 10, y: 20, width: 30, height: 40 } };

  function pageWith(nodes: DocumentNode[]): AccessibleDocument {
    return {
      metadata: { sourceUrl: null, pageCount: 1, producedBy: ['pdf-inspector'] },
      pages: [{ pageNumber: 1, origin: 'pdf-inspector', status: 'requires-ocr', nodes }],
    };
  }

  const readPage = adaptOcrResult({
    providerId: 'test',
    pages: [{ pageNumber: 1, blocks: [{ type: 'paragraph', text: '読み取った本文' }] }],
  });

  const described: FigureNode = {
    type: 'figure',
    status: 'available',
    region,
    alternativeText: '屋上菜園の写真',
    alternativeTextSource: 'generated',
  };

  it('survives, with its description, at the end of the page', () => {
    const merged = mergeOcrPages(pageWith([described]), readPage);
    const page = merged.pages[0]!;

    expect(page.nodes.map((node) => node.type)).toEqual(['paragraph', 'figure']);
    const figure = page.nodes[1]!;
    if (figure.type !== 'figure') throw new Error('expected a figure');
    expect(figure.alternativeText).toBe('屋上菜園の写真');
    expect(figure.region).toEqual(region);
  });

  it('is counted, so the page can say its order changed', () => {
    expect(mergeOcrPages(pageWith([described]), readPage).pages[0]!.carriedFigures).toBe(1);
  });

  it('says nothing about order when there was no figure to move', () => {
    const merged = mergeOcrPages(
      pageWith([{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]),
      readPage,
    );
    expect(merged.pages[0]!.carriedFigures).toBeUndefined();
  });

  it('leaves a placeholder with no region behind', () => {
    // Nothing located it, so there is nothing to carry — only a claim that a
    // picture is somewhere on a page the engine has now read.
    const merged = mergeOcrPages(pageWith([{ type: 'figure', status: 'missing-alt' }]), readPage);
    expect(merged.pages[0]!.nodes.map((node) => node.type)).toEqual(['paragraph']);
    expect(merged.pages[0]!.carriedFigures).toBeUndefined();
  });

  it('does not carry the same figure twice when a run merges cumulatively', () => {
    // A progressive run re-merges every page it has read so far. The page is
    // `available` by then, so rule 2 stops it — but this is the test that says
    // so, because a second pass would append the figure again.
    const once = mergeOcrPages(pageWith([described]), readPage);
    const twice = mergeOcrPages(once, readPage);

    expect(twice.pages[0]!.nodes.map((node) => node.type)).toEqual(['paragraph', 'figure']);
    expect(twice.pages[0]!.carriedFigures).toBe(1);
  });
});
