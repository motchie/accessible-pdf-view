import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, DocumentNode, DocumentPage } from '../document-model';

/**
 * Rescuing pages a producer dropped.
 *
 * The rule this project started with was that empty parser output means "OCR is
 * needed", never "analysis failed". An untagged prospectus showed the other
 * half of that rule, which was missing: **claiming a page is genuinely empty is also
 * a statement, and it can also be false.**
 *
 * On that document pdf-inspector emits no Markdown at all for pages 4 and 5 —
 * not even their page markers — while reporting in the same result that both
 * pages contain tables. They are not flagged as needing OCR either, so nothing
 * downstream had any reason to doubt them, and the Reader told the reader those
 * pages were empty. PDF.js reads about 900 characters of ordinary Japanese from
 * each of them.
 *
 * So: before a page is allowed to be called empty, PDF.js is asked. The check
 * is decidable — there is text or there is not — and it costs a `getTextContent`
 * call on the handful of pages that produced nothing.
 *
 * What comes back is text without structure: no headings, no tables, no lists,
 * because the page's own producer is the thing that failed to supply them. Each
 * rescued page is marked `origin: 'pdf-text'` so the Reader can say exactly
 * that rather than presenting flat paragraphs as if they were the document's
 * real shape.
 */

/**
 * Below this, a page's text is page furniture rather than content — a page
 * number, a folio, a running head. Restoring "12" as a paragraph would replace
 * one false statement with a more confusing one.
 */
const MIN_RECOVERABLE_CHARS = 24;

export async function recoverEmptyPages(
  document: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { signal?: AbortSignal } = {},
): Promise<AccessibleDocument> {
  const candidates = document.pages.filter(isUnexplainedEmpty);
  if (candidates.length === 0) return document;

  const recovered = new Map<number, DocumentNode[]>();
  for (const page of candidates) {
    if (options.signal?.aborted) break;
    const nodes = await readPageText(pdf, page.pageNumber);
    if (nodes.length > 0) recovered.set(page.pageNumber, nodes);
  }
  if (recovered.size === 0) return document;

  return {
    ...document,
    metadata: {
      ...document.metadata,
      producedBy: document.metadata.producedBy.includes('pdf-text')
        ? document.metadata.producedBy
        : [...document.metadata.producedBy, 'pdf-text'],
    },
    pages: document.pages.map((page) => {
      const nodes = recovered.get(page.pageNumber);
      return nodes ? { ...page, nodes, status: 'available' as const, origin: 'pdf-text' as const } : page;
    }),
  };
}

/**
 * A page that claims to be empty without anything having explained why.
 *
 * `requires-ocr` is an explanation and is left alone: that page has been looked
 * at, and OCR is the answer for it. This is only about pages that fell through.
 */
function isUnexplainedEmpty(page: DocumentPage): boolean {
  return page.status === 'empty' && page.nodes.length === 0;
}

async function readPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<DocumentNode[]> {
  let raw: string;
  try {
    const page = await pdf.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      raw = joinTextItems(content.items as ReadonlyArray<unknown>);
    } finally {
      page.cleanup();
    }
  } catch {
    // A page PDF.js cannot read either stays as it was. Two producers failing
    // is not evidence of content.
    return [];
  }

  return toParagraphs(raw);
}

/**
 * Joins PDF.js text items into lines.
 *
 * `hasEOL` is the only line information PDF.js gives, and it is what separates
 * "one paragraph" from "a column of table cells" well enough to be readable.
 * Nothing here tries to infer structure — that is precisely what could not be
 * recovered.
 */
function joinTextItems(items: ReadonlyArray<unknown>): string {
  let out = '';
  for (const item of items) {
    const text = item as { str?: string; hasEOL?: boolean };
    if (typeof text.str !== 'string') continue;
    out += text.str;
    if (text.hasEOL) out += '\n';
  }
  return out;
}

export function toParagraphs(raw: string): DocumentNode[] {
  const blocks = raw
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, ' ').replace(/[ \t]{2,}/g, ' ').trim())
    .filter((block) => block.length > 0);

  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  if (total < MIN_RECOVERABLE_CHARS) return [];

  return blocks.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }));
}
