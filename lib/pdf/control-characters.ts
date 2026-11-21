import type {
  AccessibleDocument,
  DocumentNode,
  DocumentPage,
  InlineNode,
  TableCell,
  TableRow,
} from './document-model';

/**
 * Control characters, which text read from a PDF can carry but which are not
 * text: C0 except tab, line feed and carriage return, and DEL.
 *
 * Vertical tab and form feed become spaces, because they separate words: Word
 * writes U+000B for a manual line break. A space, not a line break, because
 * the same text can be a single line — an `/Alt`, a Markdown heading — where a
 * break would change what it is. Neither character was found in any reading,
 * or in pdf-inspector's raw Markdown, of the 17 PDFs measured (2026-11-21).
 *
 * The rest are removed. A 91-page export from Word for Microsoft 365 ends both
 * of its logos' `/Alt` strings with a NUL byte, in the file itself, not added
 * in decoding. Left in, it reached the Markdown, and a paste through the
 * Windows clipboard, which takes NUL as the end of the text, stopped there:
 * inside line 5 of 2,180.
 *
 * C1 (U+0080 to U+009F) is left alone. Nothing there is known to cut a paste,
 * and it can be text that was decoded wrongly rather than no text: a font read
 * as Latin-1 that is really Windows-1252 gives U+0085 for an ellipsis,
 * U+0093 and U+0094 for quotation marks, U+0096 and U+0097 for dashes. Of the
 * 17 PDFs measured, one has C1: a Japanese letter whose list bullets are a
 * symbol-font glyph that pdf-inspector reads as U+0097 (pdftotext reads
 * U+F097, and the tagged reading has a list item there).
 */
const WORD_SEPARATORS = /[\u000B\u000C]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F]/g;
/** Either of the above, to find out cheaply whether there is anything to do. */
const ANY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function withoutControlCharacters(text: string): string {
  if (!ANY.test(text)) return text;
  return text.replace(WORD_SEPARATORS, ' ').replace(CONTROL_CHARACTERS, '');
}

/**
 * The document with `withoutControlCharacters` applied to every piece of text
 * it shows: the document title, inline text, code, captions and alternative
 * text (#52). Whatever produced it — pdf-inspector, the tag tree, a recovered
 * page, OCR, a generated description — so that every view, and every copy made
 * from one, gets the same text.
 *
 * Only strings change. A figure keeps its status and its source even when its
 * alternative text is left empty, because what an empty description means
 * depends on who wrote it (for a describer it is a decorative verdict); the
 * producers that can be handed a description of control characters alone check
 * it themselves (`classifyAlternativeText`, and pdf-inspector's `toFigure`).
 * Links keep their `href`, which `sanitizeHref` has already dealt with.
 *
 * Whatever has nothing to clean is returned as it was, so a second pass costs
 * a walk and copies nothing.
 */
export function documentWithoutControlCharacters(document: AccessibleDocument): AccessibleDocument {
  const title = cleanOptional(document.metadata.title);
  const pages = sameOrMapped(document.pages, cleanPage);
  if (title === document.metadata.title && pages === document.pages) return document;
  return {
    ...document,
    metadata: title === document.metadata.title ? document.metadata : { ...document.metadata, title },
    pages,
  };
}

function cleanPage(page: DocumentPage): DocumentPage {
  const nodes = sameOrMapped(page.nodes, cleanNode);
  return nodes === page.nodes ? page : { ...page, nodes };
}

function cleanNode(node: DocumentNode): DocumentNode {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'unknown': {
      const content = sameOrMapped(node.content, cleanInline);
      return content === node.content ? node : { ...node, content };
    }
    case 'list': {
      const items = sameOrMapped(node.items, (item) => {
        const blocks = sameOrMapped(item.blocks, cleanNode);
        return blocks === item.blocks ? item : { ...item, blocks };
      });
      return items === node.items ? node : { ...node, items };
    }
    case 'blockquote': {
      const blocks = sameOrMapped(node.blocks, cleanNode);
      return blocks === node.blocks ? node : { ...node, blocks };
    }
    case 'table': {
      const caption = cleanOptional(node.caption);
      const header = node.header && cleanRow(node.header);
      const rows = sameOrMapped(node.rows, cleanRow);
      if (caption === node.caption && header === node.header && rows === node.rows) return node;
      return {
        ...node,
        ...(caption === undefined ? {} : { caption }),
        ...(header === undefined ? {} : { header }),
        rows,
      };
    }
    case 'figure': {
      const alternativeText = cleanOptional(node.alternativeText);
      const caption = cleanOptional(node.caption);
      if (alternativeText === node.alternativeText && caption === node.caption) return node;
      return {
        ...node,
        ...(alternativeText === undefined ? {} : { alternativeText }),
        ...(caption === undefined ? {} : { caption }),
      };
    }
    case 'code': {
      const text = withoutControlCharacters(node.text);
      return text === node.text ? node : { ...node, text };
    }
    case 'thematic-break':
      return node;
  }
}

function cleanRow(row: TableRow): TableRow {
  const cells = sameOrMapped(row.cells, cleanCell);
  return cells === row.cells ? row : { ...row, cells };
}

function cleanCell(cell: TableCell): TableCell {
  const content = sameOrMapped(cell.content, cleanInline);
  const blocks = cell.blocks && sameOrMapped(cell.blocks, cleanNode);
  if (content === cell.content && blocks === cell.blocks) return cell;
  return { ...cell, content, ...(blocks === undefined ? {} : { blocks }) };
}

function cleanInline(node: InlineNode): InlineNode {
  switch (node.type) {
    case 'text': {
      const text = withoutControlCharacters(node.text);
      return text === node.text ? node : { ...node, text };
    }
    case 'link': {
      const content = sameOrMapped(node.content, cleanInline);
      return content === node.content ? node : { ...node, content };
    }
    case 'line-break':
      return node;
  }
}

function cleanOptional(text: string | undefined): string | undefined {
  return text === undefined ? undefined : withoutControlCharacters(text);
}

/** `items` itself when `clean` changes none of them. */
function sameOrMapped<T>(items: T[], clean: (item: T) => T): T[] {
  let result: T[] | undefined;
  items.forEach((item, index) => {
    const cleaned = clean(item);
    if (cleaned !== item) (result ??= items.slice())[index] = cleaned;
  });
  return result ?? items;
}
