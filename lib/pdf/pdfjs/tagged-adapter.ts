import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  AccessibleDocument,
  DocumentNode,
  DocumentPage,
  InlineNode,
  ListItem,
  TableCell,
  TableRow,
} from '../document-model';
import { inlineToPlainText } from '../document-model';
import { normalizeCjkSpacing } from '../inspector/markdown-to-document';
import { sanitizeHref } from '../sanitize-url';
import { classifyAlternativeText } from './generated-alt';
import {
  buildPageTextIndex,
  findLinkFor,
  type BoundingBox,
  type PageTextIndex,
} from './page-text-index';
import type { PdfDocumentInfo } from './metadata';

/**
 * Tagged PDF structure -> Document Model.
 *
 * When an author tagged their document, they already answered the questions
 * that layout inference has to guess at. On the news-release fixture in this
 * repository the difference is not subtle: the numbered sections are a real
 * `L`/`LI` list, and the facility table has `THead` with `TH` column headers
 * *and* `TH` row headers down its first column — structure that no amount of
 * looking at glyph positions would have recovered correctly.
 *
 * So when a PDF is tagged, this is the preferred producer, and pdf-inspector
 * becomes the fallback for untagged documents.
 *
 * What this does not do: invent anything. If the tags are a flat run of `P`
 * elements — which is common, because word processors emit that — the result is
 * a flat run of paragraphs, and `isUsable()` lets the caller decide whether
 * that beats the inferred structure.
 */

/** PDF.js's structure tree node shape. */
interface StructNode {
  role?: string;
  lang?: string;
  alt?: string;
  type?: string;
  id?: string;
  children?: StructNode[];
}

export interface TaggedExtraction {
  document: AccessibleDocument;
  /** Roles seen, for diagnostics and the future Structure view. */
  roles: Record<string, number>;
}

export async function extractTaggedDocument(
  pdf: PDFDocumentProxy,
  options: { sourceUrl?: string | null; info?: PdfDocumentInfo; signal?: AbortSignal } = {},
): Promise<TaggedExtraction | null> {
  const pages: DocumentPage[] = [];
  const roles: Record<string, number> = {};

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    if (options.signal?.aborted) return null;

    const page = await pdf.getPage(pageNumber);
    let tree: StructNode | null;
    try {
      tree = (await page.getStructTree()) as StructNode | null;
    } catch {
      tree = null;
    }

    if (!tree) {
      pages.push({ pageNumber, origin: 'tagged-pdf', status: 'empty', nodes: [] });
      continue;
    }

    const index = await buildPageTextIndex(page);
    const context: Context = { index, roles };
    const nodes = blocksFrom(tree, context);

    pages.push({
      pageNumber,
      origin: 'tagged-pdf',
      status: nodes.length > 0 ? 'available' : 'empty',
      nodes,
    });
    page.cleanup();
  }

  if (pages.length === 0) return null;

  return {
    roles,
    document: {
      metadata: {
        ...(options.info?.title ? { title: options.info.title } : {}),
        sourceUrl: options.sourceUrl ?? null,
        pageCount: pdf.numPages,
        producedBy: ['tagged-pdf'],
        ...(options.info?.language ? { language: options.info.language } : {}),
      },
      pages,
    },
  };
}

/**
 * Whether a tagged extraction is worth preferring.
 *
 * A document can be marked as tagged and still carry a structure tree that says
 * nothing — no text, or a single undifferentiated blob. In that case the
 * inferred structure is genuinely better and this returns false.
 */
export function isUsable(extraction: TaggedExtraction | null): boolean {
  if (!extraction) return false;

  const nodes = extraction.document.pages.flatMap((page) => page.nodes);
  if (nodes.length === 0) return false;

  const text = nodes.map(plainTextOf).join('');
  return text.trim().length > 0;
}

function plainTextOf(node: DocumentNode): string {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'unknown':
      return inlineToPlainText(node.content);
    case 'list':
      return node.items.flatMap((item) => item.blocks.map(plainTextOf)).join('');
    case 'table':
      return [...(node.header ? [node.header] : []), ...node.rows]
        .flatMap((row) => row.cells.map((cell) => inlineToPlainText(cell.content)))
        .join('');
    case 'blockquote':
      return node.blocks.map(plainTextOf).join('');
    default:
      return '';
  }
}

/* -------------------------------------------------------------------------
 * Role tables
 * ---------------------------------------------------------------------- */

/** Grouping elements that carry no meaning of their own; recurse through them. */
const CONTAINER_ROLES = new Set([
  'Root',
  'Document',
  'DocumentFragment',
  'Part',
  'Art',
  'Sect',
  'Div',
  'NonStruct',
  'Aside',
  'LBody',
  'THead',
  'TBody',
  'TFoot',
]);

/** Elements that live inside a line of text. */
const INLINE_ROLES = new Set([
  'Span',
  'Link',
  'Quote',
  'Reference',
  'Note',
  'Annot',
  'Ruby',
  'RB',
  'RT',
  'RP',
  'Warichu',
  'WT',
  'WP',
  'Em',
  'Strong',
  'Code',
]);

const HEADING_ROLE = /^H([1-6])$/;

interface Context {
  index: PageTextIndex;
  roles: Record<string, number>;
}

/* -------------------------------------------------------------------------
 * Block conversion
 * ---------------------------------------------------------------------- */

function blocksFrom(node: StructNode, context: Context): DocumentNode[] {
  const role = node.role;
  if (role) context.roles[role] = (context.roles[role] ?? 0) + 1;

  if (!role || CONTAINER_ROLES.has(role)) {
    return blocksFromContainer(node, context);
  }

  const headingMatch = HEADING_ROLE.exec(role);
  if (headingMatch) {
    const content = inlineFrom(node, context);
    if (content.length === 0) return [];
    return [{ type: 'heading', level: Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6, content }];
  }

  switch (role) {
    case 'Title': {
      const content = inlineFrom(node, context);
      return content.length === 0 ? [] : [{ type: 'heading', level: 1, content }];
    }

    // An untyped `H` has no level of its own; the renderer places it below the
    // page title, which is the most that can be claimed truthfully.
    case 'H': {
      const content = inlineFrom(node, context);
      return content.length === 0 ? [] : [{ type: 'heading', level: 1, content }];
    }

    case 'P':
    case 'Caption': {
      const content = inlineFrom(node, context);
      return content.length === 0 ? [] : [{ type: 'paragraph', content }];
    }

    case 'L':
      return [listFrom(node, context)];

    case 'Table':
      return [tableFrom(node, context)];

    case 'Figure':
      return [figureFrom(node, context)];

    case 'BlockQuote': {
      const blocks = childElements(node).flatMap((child) => blocksFrom(child, context));
      return blocks.length === 0 ? [] : [{ type: 'blockquote', blocks }];
    }

    case 'Formula': {
      // Rendered as text rather than dropped. A formula's tagged text is
      // whatever the author supplied, which is better than silence.
      const content = inlineFrom(node, context);
      return content.length === 0 ? [] : [{ type: 'paragraph', content }];
    }

    case 'TOC':
    case 'TOCI':
    case 'Index':
    case 'Private':
      return childElements(node).flatMap((child) => blocksFrom(child, context));

    default: {
      // An inline element appearing where a block was expected still has text.
      if (INLINE_ROLES.has(role)) {
        const content = inlineFrom(node, context);
        return content.length === 0 ? [] : [{ type: 'paragraph', content }];
      }
      const content = inlineFrom(node, context);
      return content.length === 0 ? [] : [{ type: 'unknown', content }];
    }
  }
}

/**
 * Recurses through a grouping element.
 *
 * Producers sometimes attach content directly to a `Div` or `Sect` rather than
 * wrapping it in a `P`. Runs of such content become paragraphs so the text is
 * not lost between the child elements around it.
 */
function blocksFromContainer(node: StructNode, context: Context): DocumentNode[] {
  const out: DocumentNode[] = [];
  let loose: InlineNode[] = [];

  const flush = () => {
    const content = merge(loose);
    if (content.length > 0) out.push({ type: 'paragraph', content });
    loose = [];
  };

  for (const child of node.children ?? []) {
    // Inline children continue the current run rather than ending it.
    // Otherwise a `Span` sitting between two pieces of text — which is how
    // word processors mark a font change mid-sentence — would split one
    // sentence into three paragraphs.
    if ((child.type === 'content' && child.id) || (child.role && INLINE_ROLES.has(child.role))) {
      appendInline(child, context, loose);
      continue;
    }
    flush();
    out.push(...blocksFrom(child, context));
  }
  flush();

  return out;
}

function listFrom(node: StructNode, context: Context): DocumentNode {
  const items: ListItem[] = [];
  let ordered = false;
  let start: number | undefined;

  for (const child of childElements(node)) {
    if (child.role !== 'LI') {
      // Some producers put content directly under L.
      const blocks = blocksFrom(child, context);
      if (blocks.length > 0) items.push({ blocks });
      continue;
    }

    const blocks: DocumentNode[] = [];
    let label: ListLabel | null = null;

    for (const part of childElements(child)) {
      if (part.role === 'Lbl') {
        // The label is the bullet or number. `<ol>`/`<ul>` render their own, so
        // repeating it would double it up — but it tells us which list type to
        // use, and where an ordered list starts counting.
        label = parseListLabel(textOf(part, context));
        if (label.ordered) ordered = true;
        if (label.number !== undefined && items.length === 0) start = label.number;
        continue;
      }
      blocks.push(...blocksFrom(part, context));
    }

    if (label?.ordered) stripLeadingDelimiter(blocks);
    if (blocks.length > 0) items.push({ blocks });
  }

  return {
    type: 'list',
    ordered,
    // Word tags each numbered paragraph as its own single-item list, so
    // without carrying the label's number across, "１." "２." "３." would all
    // render as "1.".
    ...(ordered && start !== undefined && start !== 1 ? { start } : {}),
    items,
  };
}

interface ListLabel {
  ordered: boolean;
  number?: number;
}

const FULL_WIDTH_DIGITS = /[０-９]/g;

export function parseListLabel(label: string): ListLabel {
  const normalized = label
    .replace(FULL_WIDTH_DIGITS, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30),
    )
    .replace(/^[\s(（[【]+/, '')
    .replace(/[\s.)．）、。\]】]+$/, '');

  if (/^\d+$/.test(normalized)) {
    return { ordered: true, number: Number.parseInt(normalized, 10) };
  }
  // A roman numeral or a single letter is ordered, but its position is not
  // something `<ol start>` can express, so no number is claimed.
  if (/^[ivxlcdm]+$/i.test(normalized) || /^[a-z]$/i.test(normalized)) {
    return { ordered: true };
  }
  return { ordered: false };
}

/**
 * Removes the delimiter left behind when a producer splits a numbered item
 * into a `Lbl` of "１" and an `LBody` that still starts with the ". " that
 * followed it.
 */
function stripLeadingDelimiter(blocks: DocumentNode[]): void {
  const first = blocks[0];
  if (first?.type !== 'paragraph' && first?.type !== 'unknown') return;

  const text = first.content[0];
  if (text?.type !== 'text') return;

  text.text = text.text.replace(/^\s*[.)．）、]\s*/, '');
  if (text.text === '') first.content.shift();
}

function tableFrom(node: StructNode, context: Context): DocumentNode {
  const headerRows: TableRow[] = [];
  const bodyRows: TableRow[] = [];
  let caption: string | undefined;

  const visit = (candidate: StructNode, inHead: boolean) => {
    for (const child of childElements(candidate)) {
      if (child.role === 'THead') visit(child, true);
      else if (child.role === 'TBody' || child.role === 'TFoot') visit(child, false);
      else if (child.role === 'TR') (inHead ? headerRows : bodyRows).push(rowFrom(child, context));
      else if (child.role === 'Caption') caption ??= textOf(child, context) || undefined;
    }
  };
  visit(node, false);

  // Without an explicit THead, an all-header first row is still a header row.
  if (headerRows.length === 0 && bodyRows.length > 0) {
    const [first] = bodyRows;
    if (first && first.cells.length > 0 && first.cells.every((cell) => cell.header)) {
      headerRows.push(bodyRows.shift()!);
    }
  }

  return {
    type: 'table',
    ...(caption ? { caption } : {}),
    // The model carries a single header row; extra header rows fall through to
    // the body, where their cells are still `<th>`.
    ...(headerRows[0] ? { header: headerRows[0] } : {}),
    rows: [...headerRows.slice(1), ...bodyRows],
  };
}

function rowFrom(node: StructNode, context: Context): TableRow {
  const cells: TableCell[] = [];

  for (const child of childElements(node)) {
    if (child.role !== 'TH' && child.role !== 'TD') continue;

    const blocks = collectCellBlocks(child, context);
    cells.push({
      header: child.role === 'TH',
      content: inlineFrom(child, context),
      ...(blocks.length > 0 ? { blocks } : {}),
    });
  }

  return { cells };
}

/**
 * Roles inside a cell that cannot be flattened into inline content.
 *
 * A `Figure` is the reason this exists: it carries no text at all, so running
 * it through `inlineFrom` yields nothing and the figure disappears. One news
 * release declares four figures, every one of them inside a table cell — the
 * Reader showed none of them until cells could hold blocks.
 */
const CELL_BLOCK_ROLES = new Set(['Figure', 'Table', 'L']);

function collectCellBlocks(cell: StructNode, context: Context): DocumentNode[] {
  const blocks: DocumentNode[] = [];

  const walk = (node: StructNode) => {
    for (const child of childElements(node)) {
      if (child.role && CELL_BLOCK_ROLES.has(child.role)) {
        blocks.push(...blocksFrom(child, context));
        continue;
      }
      walk(child);
    }
  };
  walk(cell);

  return blocks;
}

function figureFrom(node: StructNode, context: Context): DocumentNode {
  // A `/Alt` is not proof that a person wrote it: Word and PowerPoint generate
  // alternative text and write it here verbatim, disclaimer included. Word also
  // emits `alt=" "` for decorative spacing, so whitespace-only values are not
  // descriptions at all.
  const { text: alt, machineWritten } = classifyAlternativeText(node.alt);
  // The tag tree names the drawing operations that make up this figure. Kept
  // so the region can be derived from them exactly, rather than by matching
  // draw order against document order.
  const contentIds = collectContentIds(node);
  const caption = childElements(node)
    .filter((child) => child.role === 'Caption')
    .map((child) => textOf(child, context))
    .join(' ')
    .trim();

  return {
    type: 'figure',
    ...(alt
      ? {
          alternativeText: alt,
          alternativeTextSource: machineWritten
            ? ('document-ai' as const)
            : ('author' as const),
        }
      : {}),
    ...(caption ? { caption } : {}),
    ...(contentIds.length > 0 ? { contentIds } : {}),
    status: alt ? 'available' : 'missing-alt',
  };
}

/** Every marked-content reference under a node, in document order. */
function collectContentIds(node: StructNode): string[] {
  const ids: string[] = [];
  const walk = (candidate: StructNode) => {
    for (const child of candidate.children ?? []) {
      if (child.type === 'content' && child.id) ids.push(child.id);
      else walk(child);
    }
  };
  walk(node);
  return ids;
}

/* -------------------------------------------------------------------------
 * Inline conversion
 * ---------------------------------------------------------------------- */

function inlineFrom(node: StructNode, context: Context): InlineNode[] {
  const out: InlineNode[] = [];
  collectInline(node, context, out);
  return merge(out);
}

function collectInline(node: StructNode, context: Context, out: InlineNode[]): void {
  for (const child of node.children ?? []) {
    appendInline(child, context, out);
  }
}

/** Appends one structure child to a run of inline content. */
function appendInline(child: StructNode, context: Context, out: InlineNode[]): void {
  if (child.type === 'content' && child.id) {
    const marked = context.index.get(child.id);
    if (marked) pushText(out, marked.text);
    return;
  }

  if (child.role === 'Link') {
    const link = linkFrom(child, context);
    if (link) out.push(link);
    else collectInline(child, context, out);
    return;
  }

  if (child.role === 'Strong' || child.role === 'Em' || child.role === 'Code') {
    const inner = inlineFrom(child, context);
    const emphasis = child.role === 'Strong' ? 'strong' : child.role === 'Em' ? 'em' : 'code';
    for (const item of inner) {
      out.push(
        item.type === 'text'
          ? { ...item, emphasis: [...(item.emphasis ?? []), emphasis] }
          : item,
      );
    }
    return;
  }

  // Everything else — Span, P inside a cell, nested containers — contributes
  // its text in document order.
  collectInline(child, context, out);
}

function linkFrom(node: StructNode, context: Context): InlineNode | null {
  const content = inlineFrom(node, context);
  const text = inlineToPlainText(content).trim();

  // A `Link` structure element carries no destination; the URL lives in the
  // page's link annotation. Matching by position is what joins them.
  const fromAnnotation = findLinkFor(context.index, boxFor(node, context));
  const href = sanitizeHref(fromAnnotation ?? text);
  if (!href) return null;

  const isBareUrl = text !== '' && sanitizeHref(text) === href;
  return {
    type: 'link',
    href,
    content: content.length > 0 ? content : [{ type: 'text', text: href }],
    ...(isBareUrl ? { isBareUrl: true } : {}),
  };
}

function boxFor(node: StructNode, context: Context): BoundingBox | null {
  let box: BoundingBox | null = null;

  const walk = (candidate: StructNode) => {
    for (const child of candidate.children ?? []) {
      if (child.type === 'content' && child.id) {
        const marked = context.index.get(child.id);
        if (marked?.bbox) {
          box = box
            ? {
                left: Math.min(box.left, marked.bbox.left),
                bottom: Math.min(box.bottom, marked.bbox.bottom),
                right: Math.max(box.right, marked.bbox.right),
                top: Math.max(box.top, marked.bbox.top),
              }
            : marked.bbox;
        }
      } else {
        walk(child);
      }
    }
  };
  walk(node);

  return box;
}

function textOf(node: StructNode, context: Context): string {
  return inlineToPlainText(inlineFrom(node, context)).trim();
}

function pushText(out: InlineNode[], raw: string): void {
  if (raw === '') return;
  // Deliberately not normalised here. A tagged PDF puts each glyph run in its
  // own marked-content section, so this receives "2", "0", "2", "6", " 年" as
  // separate calls — there is no adjacent pair to inspect yet. Normalisation
  // happens in `merge`, once the fragments have been joined.
  out.push({ type: 'text', text: raw });
}

function merge(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];

  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      node.type === 'text' &&
      previous?.type === 'text' &&
      (previous.emphasis ?? []).join('|') === (node.emphasis ?? []).join('|')
    ) {
      previous.text += node.text;
      continue;
    }
    out.push(node);
  }

  // Collapse the whitespace runs that appear where marked-content sections
  // meet, then repair the glyph-level spacing, then trim the ends. Interior
  // single spaces are kept even when a whole node is just a space: word
  // processors emit space-only spans between words, and dropping those would
  // run the words together.
  const collapsed = out.map((node) =>
    node.type === 'text'
      ? { ...node, text: normalizeCjkSpacing(node.text.replace(/\s+/g, ' ')) }
      : node,
  );

  const first = collapsed[0];
  if (first?.type === 'text') first.text = first.text.replace(/^ /, '');
  const last = collapsed[collapsed.length - 1];
  if (last?.type === 'text') last.text = last.text.replace(/ $/, '');

  return collapsed.filter((node) => node.type !== 'text' || node.text !== '');
}

function childElements(node: StructNode): StructNode[] {
  return (node.children ?? []).filter((child) => child.type !== 'content');
}
