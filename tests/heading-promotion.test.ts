// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, DocumentNode, DocumentPage, InlineNode } from '../lib/pdf/document-model';
import { nodeToPlainText } from '../lib/pdf/document-model';
import {
  isSectionHead,
  promoteInPage,
  promoteMergedHeadings,
} from '../lib/pdf/inspector/heading-promotion';
import { splitInline } from '../lib/pdf/inline-split';
import type { PageLine } from '../lib/pdf/pdfjs/page-lines';

/**
 * Geometry throughout is what PDF.js measured on real pages — an 11pt body with
 * the left margin at x = 56.6, the paragraph indent at 67.7 and the right margin
 * near 539. Those numbers are the point of these tests, and they are unchanged.
 *
 * The texts are **neutral stand-ins**, not quotations: the documents measured
 * are third-party and are not published with this repository, so the strings
 * were rewritten to keep what the code reacts to — where the scripts change,
 * where the two producers space the same line differently, how long a line runs
 * — and to name nobody. Replacing them with the originals would put a company's
 * press release back into a public repository for no gain.
 */
function line(text: string, left: number, right: number, baseline: number, height = 11): PageLine {
  return { text, left, right, baseline, height };
}

/**
 * A 「１.」 heading and the two lines under it.
 *
 * The words say what they are and nothing more. Nothing here reads them: the
 * rule looks at the marker, at how far short of the right margin the first
 * line stops, and at whether the next line is indented past it. A sentence
 * from a real page would make this look like a document worth reproducing,
 * which it is not — the geometry is the fixture.
 */
const SECTION_LINES: PageLine[] = [
  line('１. 見出し', 56.6, 152.6, 488.2),
  line('本文 の 一行目 がここから 右端まで 続きます', 67.7, 538.8, 469.1),
  line('二行目はここで終わります。', 56.6, 300.0, 450.2),
];
// The seam is what matters: PDF.js spaces the body as above, pdf-inspector
// returns it joined up. Both forms are kept, because the alignment has to
// survive the difference.
const SECTION_MERGED = '１. 見出し 本文の一行目がここから右端まで続きます二行目はここで終わります。';

function paragraph(text: string): DocumentNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

describe('splitting a merged heading off its paragraph', () => {
  it('splits the measured case at the PDF.js line break', () => {
    const [heading, body, ...rest] = promoteInPage([paragraph(SECTION_MERGED)], SECTION_LINES);

    expect(rest).toHaveLength(0);
    expect(heading).toEqual({
      type: 'heading',
      level: 2,
      content: [{ type: 'text', text: '１. 見出し' }],
    });
    expect(body?.type).toBe('paragraph');
    expect(body && nodeToPlainText(body)).toBe('本文の一行目がここから右端まで続きます二行目はここで終わります。');
  });

  it('returns the same array when nothing qualifies', () => {
    const nodes = [paragraph('本文だけの段落です。')];
    expect(promoteInPage(nodes, SECTION_LINES)).toBe(nodes);
  });





  /** A bullet heading that stands alone, followed by a table. */
  it('does not promote a block that is a single line', () => {
    const lines = [line('■各部門の概要', 62.2, 128.4, 300), line('部門名', 70, 110, 280)];
    const nodes = [paragraph('■各部門の概要')];
    expect(promoteInPage(nodes, lines)).toBe(nodes);
  });

  it('does not promote a paragraph that opens on a decimal', () => {
    const lines = [line('1.5 倍に', 56.6, 100, 488.2), line('増加しました。', 67.7, 300, 469.1)];
    const nodes = [paragraph('1.5 倍に増加しました。')];
    expect(promoteInPage(nodes, lines)).toBe(nodes);
  });

  it('leaves a block PDF.js reads differently alone', () => {
    const nodes = [paragraph('１. 見出し まったく別の本文です。')];
    expect(promoteInPage(nodes, SECTION_LINES)).toBe(nodes);
  });

  it('does not split inside a link', () => {
    const content: InlineNode[] = [
      { type: 'text', text: '１. 見' },
      { type: 'link', href: 'https://example.com/', content: [{ type: 'text', text: '出し 本' }] },
      { type: 'text', text: '文の一行目がここから右端まで続きます二行目はここで終わります。' },
    ];
    const nodes: DocumentNode[] = [{ type: 'paragraph', content }];
    expect(promoteInPage(nodes, SECTION_LINES)).toBe(nodes);
  });

  it('keeps emphasis on both sides of the split', () => {
    const content: InlineNode[] = [{ type: 'text', text: SECTION_MERGED, emphasis: ['strong'] }];
    const [heading, body] = promoteInPage([{ type: 'paragraph', content }], SECTION_LINES);
    expect(heading?.type === 'heading' && heading.content[0]).toMatchObject({ emphasis: ['strong'] });
    expect(body?.type === 'paragraph' && body.content[0]).toMatchObject({ emphasis: ['strong'] });
  });
});


describe('splitting inline content', () => {
  it('trims the seam', () => {
    const split = splitInline([{ type: 'text', text: '見出し 本文' }], 4);
    expect(split).toEqual({
      head: [{ type: 'text', text: '見出し' }],
      tail: [{ type: 'text', text: '本文' }],
    });
  });

  it('refuses a split that leaves either side empty', () => {
    expect(splitInline([{ type: 'text', text: '見出し' }], 3)).toBeNull();
    expect(splitInline([{ type: 'text', text: '見出し' }], 0)).toBeNull();
  });

  it('splits at a node boundary without touching either node', () => {
    const link: InlineNode = { type: 'link', href: 'https://example.com/', content: [{ type: 'text', text: '本文' }] };
    expect(splitInline([{ type: 'text', text: '見出し' }, link], 3)).toEqual({
      head: [{ type: 'text', text: '見出し' }],
      tail: [link],
    });
  });
});

describe('promoting across a document', () => {
  function pageWith(overrides: Partial<DocumentPage> & { pageNumber: number }): DocumentPage {
    return { origin: 'pdf-inspector', status: 'available', nodes: [], ...overrides };
  }

  function documentOf(pages: DocumentPage[]): AccessibleDocument {
    return { metadata: { sourceUrl: null, pageCount: pages.length, producedBy: ['pdf-inspector'] }, pages };
  }

  /** A PDF.js stand-in that yields the given lines as positioned runs. */
  function fakePdf(pages: Record<number, PageLine[]>): PDFDocumentProxy {
    return {
      getPage: async (pageNumber: number) => {
        const lines = pages[pageNumber];
        if (!lines) throw new Error('no such page');
        return {
          getTextContent: async () => ({
            items: lines.map((entry) => ({
              str: entry.text,
              width: entry.right - entry.left,
              height: entry.height,
              transform: [entry.height, 0, 0, entry.height, entry.left, entry.baseline],
            })),
          }),
          cleanup: () => {},
        };
      },
    } as unknown as PDFDocumentProxy;
  }

  it('splits on the page that needs it and leaves the rest untouched', async () => {
    const other = pageWith({ pageNumber: 2, nodes: [paragraph('ふつうの段落です。')] });
    const document = documentOf([
      pageWith({ pageNumber: 1, nodes: [paragraph('前置き。'), paragraph(SECTION_MERGED)] }),
      other,
    ]);

    const result = await promoteMergedHeadings(document, fakePdf({ 1: SECTION_LINES }));

    expect(result.pages[0]!.nodes.map((node) => node.type)).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(result.pages[1]).toBe(other);
    expect(result.metadata).toBe(document.metadata);
  });

  it('returns the same document when nothing changes', async () => {
    const document = documentOf([pageWith({ pageNumber: 1, nodes: [paragraph('本文。')] })]);
    await expect(promoteMergedHeadings(document, fakePdf({}))).resolves.toBe(document);
  });

  /** A tagged page's structure is the author's. */
  it('never touches a page from another producer', async () => {
    const document = documentOf([
      pageWith({ pageNumber: 1, origin: 'tagged-pdf', nodes: [paragraph(SECTION_MERGED)] }),
    ]);
    await expect(promoteMergedHeadings(document, fakePdf({ 1: SECTION_LINES }))).resolves.toBe(document);
  });

  it('survives a page PDF.js cannot read', async () => {
    const document = documentOf([pageWith({ pageNumber: 1, nodes: [paragraph(SECTION_MERGED)] })]);
    await expect(promoteMergedHeadings(document, fakePdf({}))).resolves.toBe(document);
  });

  it('stops when cancelled', async () => {
    const document = documentOf([pageWith({ pageNumber: 1, nodes: [paragraph(SECTION_MERGED)] })]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      promoteMergedHeadings(document, fakePdf({ 1: SECTION_LINES }), { signal: controller.signal }),
    ).resolves.toBe(document);
  });
});
