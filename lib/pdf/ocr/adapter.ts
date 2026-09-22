import type {
  AccessibleDocument,
  DocumentNode,
  DocumentPage,
  InlineNode,
  TableRow,
} from '../document-model';
import { normalizeCjkSpacing } from '../inspector/markdown-to-document';
import { sanitizeHref } from '../sanitize-url';
import type { OcrBlock, OcrPageResult, OcrResult } from './provider';

/**
 * Lowers an OCR result into the Document Model.
 *
 * The second producer, and the reason the Document Model exists: the Reader
 * cannot tell whether a page came from pdf-inspector or from OCR, and does not
 * need to.
 */
export function adaptOcrResult(
  result: OcrResult,
  options: { sourceUrl?: string | null; pageCount?: number } = {},
): AccessibleDocument {
  const pages = result.pages
    .map(adaptPage)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  return {
    metadata: {
      sourceUrl: options.sourceUrl ?? null,
      pageCount: options.pageCount ?? pages.length,
      producedBy: pages.length > 0 ? ['ocr'] : [],
    },
    pages,
  };
}

function adaptPage(page: OcrPageResult): DocumentPage {
  const nodes = page.blocks.flatMap(adaptBlock);
  return {
    pageNumber: page.pageNumber,
    origin: 'ocr',
    status: nodes.length > 0 ? 'available' : 'requires-ocr',
    nodes,
  };
}

function adaptBlock(block: OcrBlock): DocumentNode[] {
  switch (block.type) {
    case 'heading': {
      const content = textToInline(block.text);
      if (content.length === 0) return [];
      return [{ type: 'heading', level: clampLevel(block.level), content }];
    }

    case 'paragraph': {
      const content = textToInline(block.text);
      if (content.length === 0) return [];
      return [{ type: 'paragraph', content }];
    }

    case 'list': {
      const items = block.items
        .map((item) => textToInline(item))
        .filter((content) => content.length > 0)
        .map((content) => ({ blocks: [{ type: 'paragraph' as const, content }] }));
      if (items.length === 0) return [];
      return [{ type: 'list', ordered: block.ordered, items }];
    }

    case 'table': {
      const rows: TableRow[] = block.rows.map((cells) => ({
        cells: cells.map((cell) => ({ header: false, content: textToInline(cell) })),
      }));
      if (rows.length === 0) return [];
      const [first, ...rest] = rows;
      if (block.hasHeader && first) {
        return [
          {
            type: 'table',
            header: { cells: first.cells.map((cell) => ({ ...cell, header: true })) },
            rows: rest,
          },
        ];
      }
      return [{ type: 'table', rows }];
    }

    case 'figure':
      return [
        {
          type: 'figure',
          ...(block.caption?.trim() ? { caption: block.caption.trim() } : {}),
          // OCR reads text off the page; it does not describe pictures, and
          // this project never synthesises a description.
          status: 'missing-alt',
        },
      ];

    case 'unknown': {
      const content = textToInline(block.text);
      if (content.length === 0) return [];
      return [{ type: 'unknown', content }];
    }
  }
}

function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(1, Math.round(level))) as 1 | 2 | 3 | 4 | 5 | 6;
}

// Bare URLs are the one piece of inline structure worth recovering from OCR
// text: a recognised URL is genuinely useful as a link, and getting it wrong
// costs nothing because the text is preserved either way.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/g;

function textToInline(raw: string): InlineNode[] {
  const text = normalizeCjkSpacing(raw).trim();
  if (text === '') return [];

  const out: InlineNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = match[0];
    const href = sanitizeHref(url);
    if (href === null) continue;

    if (start > cursor) out.push({ type: 'text', text: text.slice(cursor, start) });
    out.push({ type: 'link', href, content: [{ type: 'text', text: url }], isBareUrl: true });
    cursor = start + url.length;
  }

  if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
  return out;
}
