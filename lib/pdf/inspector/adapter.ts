import type {
  AccessibleDocument,
  DocumentNode,
  DocumentPage,
  PageOcrCause,
  PdfCapabilities,
} from '../document-model';
import { refineHeadings } from './headings';
import { markdownToPages } from './markdown-to-document';
import type { InspectorAdaptation, InspectorRawResult } from './protocol';

/**
 * Lowers a pdf-inspector result into the Document Model.
 *
 * This is the only file that knows pdf-inspector's result shape. Everything
 * downstream — the Reader, the tests, the OCR merge — works on the Document
 * Model alone.
 *
 * It runs **inside the worker**. Markdown parsing is the expensive half of it,
 * and the Reader's thread has a live region to keep answering.
 */

export function adaptInspectorResult(
  result: InspectorRawResult,
  sourceUrl: string | null,
): InspectorAdaptation {
  const capabilities = deriveCapabilities(result);
  const markdown = result.markdown?.trim() ? result.markdown : null;

  const pages = buildPages(result, markdown);

  const document: AccessibleDocument = {
    metadata: {
      ...(result.title?.trim() ? { title: result.title.trim() } : {}),
      sourceUrl,
      pageCount: result.pageCount,
      producedBy: pages.some((page) => page.nodes.length > 0) ? ['pdf-inspector'] : [],
    },
    pages,
  };

  return { document, capabilities, markdown };
}

/**
 * Derives what we know about the PDF from the classification.
 *
 * The critical rule: an empty Markdown result is *not* a parse failure. A
 * scanned document legitimately yields nothing, and the Reader must say "this
 * needs OCR", never "analysis failed".
 */
export function deriveCapabilities(result: InspectorRawResult): PdfCapabilities {
  const ocrPages = [...new Set(result.pagesNeedingOcr)].sort((a, b) => a - b);
  const hasMarkdown = Boolean(result.markdown?.trim());

  const isScanned = result.pdfType === 'Scanned';
  const isImageBased = result.pdfType === 'ImageBased';
  const isMixed = result.pdfType === 'Mixed';

  return {
    // "Text based" with empty Markdown still counts as having no usable text —
    // trust the output over the label.
    hasExtractableText: hasMarkdown,
    requiresOcr: ocrPages.length > 0 || isScanned || isImageBased || !hasMarkdown,
    ocrPages,
    isScanned,
    isImageBased,
    isMixed,
    confidence: result.confidence,
    hasEncodingIssues: result.hasEncodingIssues,
  };
}

function buildPages(
  result: InspectorRawResult,
  markdown: string | null,
): DocumentPage[] {
  const pageCount = Math.max(result.pageCount, 0);
  const ocrPages = new Set(result.pagesNeedingOcr);
  const causes = new Map<number, PageOcrCause[]>();
  for (const entry of result.ocrReasonsByPage ?? []) {
    const known = entry.reasons.map(toCause).filter((cause): cause is PageOcrCause => cause !== null);
    if (known.length > 0) causes.set(entry.page, known);
  }

  const nodesByPage = new Map<number, DocumentNode[]>();
  let unattributed: DocumentNode[] = [];

  if (markdown) {
    for (const chunk of markdownToPages(markdown)) {
      if (chunk.nodes.length === 0) continue;
      if (chunk.pageNumber === null) {
        unattributed.push(...chunk.nodes);
      } else {
        const existing = nodesByPage.get(chunk.pageNumber) ?? [];
        existing.push(...chunk.nodes);
        nodesByPage.set(chunk.pageNumber, existing);
      }
    }
  }

  // Content before the first page marker belongs to page 1.
  if (unattributed.length > 0) {
    const first = nodesByPage.get(1) ?? [];
    nodesByPage.set(1, [...unattributed, ...first]);
    unattributed = [];
  }

  // Some documents produce no markers at all. Rather than losing the page
  // structure, everything lands on page 1 and the remaining pages are reported
  // by their classification.
  const highestSeen = Math.max(0, ...nodesByPage.keys());
  const total = Math.max(pageCount, highestSeen);

  const pages: DocumentPage[] = [];
  for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
    const nodes = refineHeadings(nodesByPage.get(pageNumber) ?? []);
    pages.push({
      pageNumber,
      origin: 'pdf-inspector',
      // The parser's own OCR verdict wins over "did anything at all come out".
      //
      // It used to be the other way round, and on a scanned deck that produced
      // a page number per page — one stray digit — every page counted as
      // `available`. The document then contradicted itself: the notice listed
      // 27 pages as unreadable while the OCR panel, which reads page status,
      // offered 5. pdf-inspector looked at the page and said its text is not
      // extractable; a leaked glyph does not refute that. Whatever did come
      // through is still kept and rendered.
      status: ocrPages.has(pageNumber)
        ? 'requires-ocr'
        : nodes.length > 0
          ? 'available'
          : 'empty',
      nodes,
      ...(causes.has(pageNumber) ? { ocrCauses: causes.get(pageNumber)! } : {}),
    });
  }

  return pages;
}

/**
 * pdf-inspector's own vocabulary, from `src/detector.rs`: undecodable fonts and
 * vector-outlined text are reported first because they persist even when a text
 * layer is present; otherwise a page with no extractable text is `scanned` when
 * an image backs it and `no_text` when nothing does.
 *
 * Anything else returns null. A code this build does not know is not a licence
 * to guess — the page falls back to being looked at directly.
 */
function toCause(reason: string): PageOcrCause | null {
  switch (reason) {
    case 'scanned':
      return 'scanned';
    case 'no_text':
      return 'no-text';
    case 'vector_text':
      return 'vector-text';
    case 'suspected_garbled_text':
      return 'garbled-text';
    default:
      return null;
  }
}
