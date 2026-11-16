import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  AccessibleDocument,
  DocumentNode,
  DocumentPage,
  InlineNode,
  ListItem,
  TextNode,
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
  nonWhitespaceLength,
  type BoundingBox,
  type PageTextIndex,
} from './page-text-index';
import { normalizeLanguage, type PdfDocumentInfo } from './metadata';

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
  /**
   * Non-whitespace characters of the text PDF.js finds on the pages with a
   * tree, tagged or not. See `coversPageText`.
   */
  pageTextLength: number;
}

export async function extractTaggedDocument(
  pdf: PDFDocumentProxy,
  options: { sourceUrl?: string | null; info?: PdfDocumentInfo; signal?: AbortSignal } = {},
): Promise<TaggedExtraction | null> {
  const pages: DocumentPage[] = [];
  const roles: Record<string, number> = {};
  let pageTextLength = 0;

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
    pageTextLength += index.textLength;
    const context: Context = {
      index,
      roles,
      ...(options.info?.language ? { documentLanguage: options.info.language } : {}),
    };
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
    pageTextLength,
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

/**
 * Whether a tagged extraction carries at least half of the page text,
 * counting its text only.
 *
 * `isUsable` is enough for a document that declares itself Tagged PDF: the
 * declaration is the author's statement that the tree is the document. A tree
 * without it makes no such statement, and some producers write one only for
 * what they must — link annotations, form fields — leaving the body untagged.
 * Preferred on `isUsable` alone, such a tree would replace a reading of the
 * whole document with a handful of fragments.
 *
 * Complete trees are nowhere near the line. On the fixtures this was measured
 * against, declared and undeclared alike, the tagged reading's text was 94% to
 * 100% of PDF.js's, so half leaves a wide margin and still refuses a tree that
 * tags a corner of the page.
 */
export function coversPageText(extraction: TaggedExtraction): boolean {
  if (extraction.pageTextLength === 0) return true;
  // Text only: a figure's alternative text is not page text, and counting it
  // would let a tree that tags one well-described image pass.
  const tagged = nonWhitespaceLength(
    extraction.document.pages.flatMap((page) => page.nodes.map(plainTextOf)).join(''),
  );
  return tagged >= extraction.pageTextLength / 2;
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
  /**
   * The language the structure tree declares for the element being read: its
   * own `/Lang`, else its nearest ancestor's. Undefined when no element above
   * it declares one, so the catalog's language applies.
   */
  language?: string;
  /** The catalog's `/Lang`: the language of anything nothing else declares. */
  documentLanguage?: string;
}

/**
 * The context for reading `node`: the same, with the language `node` declares
 * if it declares one.
 *
 * A structure element's `/Lang` covers everything inside it, so it is carried
 * down rather than looked up. A value that is not a language tag is ignored,
 * as the catalog's is, and the enclosing language stays in force.
 */
function enter(node: StructNode, context: Context): Context {
  const language = normalizeLanguage(node.lang);
  return language && language !== context.language ? { ...context, language } : context;
}

/* -------------------------------------------------------------------------
 * Block conversion
 * ---------------------------------------------------------------------- */

function blocksFrom(node: StructNode, outer: Context): DocumentNode[] {
  const context = enter(node, outer);
  const role = node.role;
  if (role) context.roles[role] = (context.roles[role] ?? 0) + 1;

  if (!role || CONTAINER_ROLES.has(role)) {
    return blocksFromContainer(node, context);
  }

  const headingMatch = HEADING_ROLE.exec(role);
  if (headingMatch) {
    const text = textBlockFrom(node, context);
    if (!text) return [];
    return [{ type: 'heading', level: Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6, ...text }];
  }

  switch (role) {
    case 'Title': {
      const text = textBlockFrom(node, context);
      return text ? [{ type: 'heading', level: 1, ...text }] : [];
    }

    // An untyped `H` has no level of its own; the renderer places it below the
    // page title, which is the most that can be claimed truthfully.
    case 'H': {
      const text = textBlockFrom(node, context);
      return text ? [{ type: 'heading', level: 1, ...text }] : [];
    }

    case 'P':
    case 'Caption': {
      const text = textBlockFrom(node, context);
      return text ? [{ type: 'paragraph', ...text }] : [];
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
      const text = textBlockFrom(node, context);
      return text ? [{ type: 'paragraph', ...text }] : [];
    }

    case 'TOC':
    case 'TOCI':
    case 'Index':
    case 'Private':
      return childElements(node).flatMap((child) => blocksFrom(child, context));

    default: {
      // An inline element appearing where a block was expected still has text.
      if (INLINE_ROLES.has(role)) {
        const text = textBlockFrom(node, context);
        return text ? [{ type: 'paragraph', ...text }] : [];
      }
      const text = textBlockFrom(node, context);
      return text ? [{ type: 'unknown', ...text }] : [];
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
    const text = settleLanguage(merge(loose), context);
    if (text) out.push({ type: 'paragraph', ...text });
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
    const itemContext = enter(child, context);

    for (const part of childElements(child)) {
      if (part.role === 'Lbl') {
        // The label is the bullet or number. `<ol>`/`<ul>` render their own, so
        // repeating it would double it up — but it tells us which list type to
        // use, and where an ordered list starts counting.
        label = parseListLabel(textOf(part, itemContext));
        if (label.ordered) ordered = true;
        if (label.number !== undefined && items.length === 0) start = label.number;
        continue;
      }
      blocks.push(...blocksFrom(part, itemContext));
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

  const visit = (candidate: StructNode, inHead: boolean, at: Context) => {
    for (const child of childElements(candidate)) {
      const inner = enter(child, at);
      if (child.role === 'THead') visit(child, true, inner);
      else if (child.role === 'TBody' || child.role === 'TFoot') visit(child, false, inner);
      else if (child.role === 'TR') (inHead ? headerRows : bodyRows).push(rowFrom(child, inner));
      else if (child.role === 'Caption') caption ??= textOf(child, inner) || undefined;
    }
  };
  visit(node, false, context);

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

    const cellContext = enter(child, context);
    const blocks = collectCellBlocks(child, cellContext);
    const text = settleLanguage(inlineFrom(child, cellContext), cellContext);
    cells.push({
      header: child.role === 'TH',
      content: text?.content ?? [],
      ...(text?.language ? { language: text.language } : {}),
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

  const walk = (node: StructNode, at: Context) => {
    for (const child of childElements(node)) {
      if (child.role && CELL_BLOCK_ROLES.has(child.role)) {
        blocks.push(...blocksFrom(child, at));
        continue;
      }
      walk(child, enter(child, at));
    }
  };
  walk(cell, context);

  return blocks;
}

function figureFrom(node: StructNode, context: Context): DocumentNode {
  // A `/Alt` is not proof that a person wrote it: Word and PowerPoint generate
  // alternative text and write it here verbatim, disclaimer included. Word also
  // emits `alt=" "` for decorative spacing, so whitespace-only values are not
  // descriptions at all.
  // An `/Alt` that is present but empty, or only whitespace, is no
  // alternative text. It was once read as the author's decorative verdict
  // (#14), but the exports measured do not mean that by it: Word and
  // PowerPoint for Microsoft 365 both turn a picture the author marked
  // Decorative into an artifact, outside the tag tree, and PowerPoint writes
  // `/Alt ()` for a shape the author gave no alternative text at all (#27).
  // Other producers, and Word's shapes, have not been measured. Reporting a
  // decision nobody is known to have made would be a false claim about who
  // said what.
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
    altTextFieldRead: true,
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

/**
 * A text block's content and language, or null when it has no text.
 *
 * `context` is the block element's own, so its language is the one the
 * element declares or inherits.
 */
function textBlockFrom(
  node: StructNode,
  context: Context,
): { content: InlineNode[]; language?: string } | null {
  return settleLanguage(inlineFrom(node, context), context);
}

/**
 * Decides which language a block of text is in, and which of its runs differ.
 *
 * Word declares languages on runs, not on paragraphs: a `P` with no `/Lang`
 * holding `Span`s that each say `en`. Taken literally, every paragraph would
 * be in the catalog's language with all of its text overridden run by run. So
 * when every run with text agrees, that language becomes the block's — which
 * is what the author's settings meant, and gives one `lang` on the `<p>`
 * rather than one per span. When the runs disagree, the block keeps the
 * language its element declares or inherits, and only the runs that differ
 * from it carry their own.
 *
 * A run with no letters — whitespace, digits, punctuation — has no language
 * worth stating, so it never decides the question and never keeps a `lang` of
 * its own.
 *
 * Returns null for a block with no content, so callers can drop it.
 */
function settleLanguage(
  content: InlineNode[],
  context: Context,
): { content: InlineNode[]; language?: string } | null {
  if (content.length === 0) return null;
  const enclosing = context.language;
  const base = enclosing ?? context.documentLanguage;

  // What each run is worth saying it is in, after the corrections in
  // `voicedLanguage`. Undefined means the run takes whatever surrounds it and
  // has no say in what that is.
  const voiced = (node: TextNode): string | undefined =>
    voicedLanguage(node.text, node.language, base);

  const declared = new Set<string | undefined>();
  const collect = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'text' && LETTER.test(node.text)) declared.add(voiced(node));
      else if (node.type === 'link') collect(node.content);
    }
  };
  collect(content);

  const language = declared.size === 1 ? ([...declared][0] ?? enclosing) : enclosing;
  const strip = (nodes: InlineNode[]): InlineNode[] =>
    merge(
      nodes.map((node): InlineNode => {
        if (node.type === 'link') return { ...node, content: strip(node.content) };
        if (node.type !== 'text' || node.language === undefined) return node;
        const own = voiced(node);
        if (own !== undefined && own !== (language ?? context.documentLanguage)) {
          return own === node.language ? node : { ...node, language: own };
        }
        const { language: _settled, ...rest } = node;
        return rest;
      }),
    );

  return { content: strip(content), ...(language ? { language } : {}) };
}

/** A letter of any script. Text without one has no language to speak in. */
const LETTER = /\p{L}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
/** Letters of the scripts Chinese, Japanese and Korean write in, and no others. */
const CJK_LETTERS_ONLY =
  /^(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\P{L})*$/u;
const CJK = new Set(['ja', 'zh', 'ko']);

/**
 * The language a run is worth marking as, given what the PDF declares for it
 * and the language around it (`base`). Undefined: the run takes its
 * surroundings'.
 *
 * Word declares a language on every run, and in a Japanese document the
 * declarations are not all ones an author made. Measured on this project's
 * Japanese Word fixtures: every run of half-width digits says `en`
 * (「2026」, 「31」, 「1,567」), and runs of plain Japanese say `zh` (「年」,
 * 「日時点）」, 「見本商事株式会社」). Marked as declared, a screen reader
 * that follows `lang` would read 「2026 年 5 月 31 日」 in three voices. Three
 * corrections, each limited to what the text itself shows:
 *
 *   - A run with no letters — digits, punctuation, symbols — is not marked.
 *     It is read the same in the language around it, and a change of voice for
 *     a number is the most common way these declarations go wrong.
 *   - Where the run and its surroundings are both declared Chinese, Japanese
 *     or Korean, and the run's text has nothing only the declared language
 *     writes — kana for Japanese, hangul for Korean, and for Chinese nothing at
 *     all, since its Han characters are Japanese and Korean too — the run takes
 *     the surrounding language. The declaration may be right, but the text
 *     cannot show it, and Word declares it where it is not.
 *   - A run written only in those scripts and declared any other language is
 *     not marked: 「営業」 cannot be English. A Japanese Word document whose
 *     default language was English declares `en` on its Japanese headings and
 *     table cells.
 *
 * Runs in another script keep their declaration: 「Accessible PDF View」
 * marked `en` in a Japanese document is the case the attribute exists for.
 */
function voicedLanguage(
  text: string,
  declared: string | undefined,
  base: string | undefined,
): string | undefined {
  if (!LETTER.test(text) || !declared) return undefined;
  const declaredPrimary = declared.split('-')[0]!;
  if (!CJK.has(declaredPrimary) && CJK_LETTERS_ONLY.test(text)) return undefined;
  if (!base || declared === base) return declared;
  const basePrimary = base.split('-')[0]!;
  if (declaredPrimary === basePrimary || !CJK.has(declaredPrimary) || !CJK.has(basePrimary)) {
    return declared;
  }
  const shown =
    (declaredPrimary === 'ja' && KANA.test(text)) || (declaredPrimary === 'ko' && HANGUL.test(text));
  return shown ? declared : undefined;
}

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
function appendInline(child: StructNode, outer: Context, out: InlineNode[]): void {
  if (child.type === 'content' && child.id) {
    const marked = outer.index.get(child.id);
    if (marked) pushText(out, marked.text, outer.language);
    return;
  }

  const context = enter(child, outer);

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

function pushText(out: InlineNode[], raw: string, language: string | undefined): void {
  if (raw === '') return;
  // Deliberately not normalised here. A tagged PDF puts each glyph run in its
  // own marked-content section, so this receives "2", "0", "2", "6", " 年" as
  // separate calls — there is no adjacent pair to inspect yet. Normalisation
  // happens in `merge`, once the fragments have been joined.
  // Every run records the language in force where it sits. Which of these
  // need saying in the output is settled per block, in `settleLanguage`.
  out.push({ type: 'text', text: raw, ...(language ? { language } : {}) });
}

function merge(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];

  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      node.type === 'text' &&
      previous?.type === 'text' &&
      (previous.emphasis ?? []).join('|') === (node.emphasis ?? []).join('|') &&
      previous.language === node.language
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
