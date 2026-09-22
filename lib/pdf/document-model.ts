/**
 * The Document Model.
 *
 * Everything the Reader renders goes through this model. No pdf-inspector
 * type, no PDF.js type and no OCR provider type is allowed to reach the UI:
 * each producer has an adapter that lowers its own output into these shapes.
 *
 *   pdf-inspector  -> InspectorAdapter  -\
 *   OCR provider   -> OcrAdapter        --> AccessibleDocument -> Reader HTML
 *   PDF.js tags    -> TaggedPdfAdapter  -/   (future)
 *
 * The model is deliberately close to HTML's own document semantics, because
 * the whole point of the project is to end up with native semantic HTML that a
 * screen reader can navigate. Where HTML has a native element, the model has a
 * node; it does not invent structure HTML cannot express.
 */

/**
 * Which producer a page's content came from. Tracked per page so that a mixed
 * PDF (some text pages, some scanned pages) can be assembled from more than one
 * producer into a single document.
 *
 * `pdf-text` is the last resort: PDF.js's raw text for a page the chosen
 * producer dropped entirely. It carries no structure, and saying so is the
 * whole reason it is a separate origin rather than being folded into the
 * producer that failed to read the page.
 */
export type DocumentOrigin = 'pdf-inspector' | 'ocr' | 'tagged-pdf' | 'pdf-text' | 'combined';

/**
 * `combined` is a *reading*, never a producer: a document assembled from the
 * tagged reading with headings the inferred reading verified against the
 * page. It names the whole document — the picker's third option — and nothing
 * below it: every page in it is `tagged-pdf`, and every node that came from
 * elsewhere says so on itself (`origin` on the node). A page or node marked
 * `combined` would be a claim with no producer behind it, and none is ever
 * made. See `lib/pdf/combined-reading.ts`.
 */

/**
 * Where a node came from, when that is not where its page came from.
 *
 * Absent on nearly every node: a node's origin is its page's unless it says
 * otherwise. Set only by code that puts one producer's node into another
 * producer's page — the combined reading's headings today — so that the Reader
 * can still say, per node, whose claim it is showing. **A merge whose
 * provenance cannot be stated is not one this project ships**, and this field
 * is what makes stating it possible.
 */
export interface NodeProvenance {
  origin?: DocumentOrigin;
}

/**
 * What a page draws, for pages that yielded no text.
 *
 * Declared here rather than beside the PDF.js code that computes it, for the
 * same reason as `PdfFileInfo`: the model must not depend on a producer.
 *
 *   `image`   Raster images are painted — a scan or a picture-only page.
 *   `vector`  Only paths. Usually text converted to outlines, which is why a
 *             page can need OCR while containing no image at all.
 *   `blank`   Neither. The page really is empty.
 */
export type PageContentKind = 'image' | 'vector' | 'blank';

/**
 * Why a producer could not read a page, when it said so itself.
 *
 * pdf-inspector reports this per page and this project used to ignore it, then
 * work the same answer out again by walking the page's content stream with
 * PDF.js — seconds on a long document, for something already in the result.
 *
 * Three of these say what `PageContentKind` says, from the producer that
 * actually failed to read the page. The fourth does not, and is why they are
 * kept separately: `garbled-text` is a page whose text is *present* and
 * undecodable — a font with no usable ToUnicode map. Looking at what such a
 * page draws answers the wrong question, and answers it misleadingly: the page
 * is neither a picture nor outlines, and telling a reader it is either one
 * sends them looking for something that is not there.
 *
 * Names are this project's own, deliberately. The producer's wire strings
 * (`scanned`, `no_text`, `vector_text`, `suspected_garbled_text`) stop at the
 * adapter, and one it does not recognise is dropped rather than guessed at —
 * the vocabulary may grow, and a new code must degrade to "we do not know"
 * rather than to a confident wrong sentence.
 */
export type PageOcrCause = 'scanned' | 'no-text' | 'vector-text' | 'garbled-text';

export type PageStatus =
  /** Content was extracted and is present in `nodes`. */
  | 'available'
  /** The page carries no extractable text; OCR would be required. This is a
   * normal outcome, not a parse failure. */
  | 'requires-ocr'
  /** The page was parsed successfully and genuinely has no content. */
  | 'empty';

export interface DocumentMetadata {
  title?: string;
  /** The URL the PDF was loaded from, when known. */
  sourceUrl: string | null;
  pageCount: number;
  /** Every producer that contributed at least one page. */
  producedBy: DocumentOrigin[];
  /** BCP-47 tag, when a producer can tell us. Used for `lang` on the article. */
  language?: string;
  /** The document's own description of itself. */
  info?: PdfFileInfo;
}

/**
 * Document information read from the PDF's own dictionaries.
 *
 * Declared here rather than beside the PDF.js code that produces it, so the
 * Document Model does not depend on a specific producer. `language` is the
 * field that matters most: without it the Reader cannot set `lang`, and a
 * screen reader may read a Japanese document with an English voice.
 */
export interface PdfFileInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  /** ISO 8601, converted from the PDF's own date syntax. */
  createdAt?: string;
  modifiedAt?: string;
  /** BCP-47 tag from the document catalog's `/Lang`. */
  language?: string;
  pdfVersion?: string;
  /** The document declares logical structure (`/MarkInfo /Marked true`). */
  isTagged: boolean;
  isLinearized?: boolean;
  hasAcroForm?: boolean;
  /** Raw XMP packet, kept for a future Structure view. */
  xmp?: string;
}

export interface AccessibleDocument {
  metadata: DocumentMetadata;
  pages: DocumentPage[];
}

export interface DocumentPage {
  /** 1-indexed, matching how PDF readers and pdf-inspector number pages. */
  pageNumber: number;
  origin: DocumentOrigin;
  status: PageStatus;
  nodes: DocumentNode[];
  /**
   * What the page draws, when it produced no text.
   *
   * Present only for `requires-ocr` pages, and only to word the notice
   * honestly: "this page is an image" and "this page is text drawn as outlines"
   * are different situations, and the second one is why a page can need OCR
   * while carrying no image the figure detector could find.
   */
  contentKind?: PageContentKind;
  /**
   * What the producer said about why it could not read this page.
   *
   * Ordered as the producer ordered them, most specific first: it reports
   * `garbled-text` and `vector-text` ahead of the rest because those persist
   * even when a text layer is present.
   */
  ocrCauses?: PageOcrCause[];
  /**
   * How many figures were moved to the end of this page when OCR read it.
   *
   * OCR replaces a page's nodes with what it read, and what it read carries no
   * positions — so a figure the producer had located, with its image and
   * possibly a description someone waited minutes for, has nowhere to go but
   * the end. That is a change to the reading order, and the Reader says so at
   * the point of reading. Stored rather than recomputed, because the count is
   * a fact about the merge that produced this page: nothing looking at the
   * finished page can tell which figures were moved and which the engine
   * reported where they are.
   */
  carriedFigures?: number;
}

/* -------------------------------------------------------------------------
 * Block-level nodes
 * ---------------------------------------------------------------------- */

export type DocumentNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | TableNode
  | FigureNode
  | BlockquoteNode
  | CodeNode
  | ThematicBreakNode
  | UnknownNode;

/** Heading levels are clamped to 2..6 by the renderer, which owns `<h1>` for
 * the document title, so that the rendered heading hierarchy stays logical. */
export interface HeadingNode extends NodeProvenance {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: InlineNode[];
}

export interface ParagraphNode extends NodeProvenance {
  type: 'paragraph';
  content: InlineNode[];
}

export interface ListNode extends NodeProvenance {
  type: 'list';
  ordered: boolean;
  /** First number of an ordered list, when it does not start at 1. */
  start?: number;
  items: ListItem[];
}

export interface ListItem {
  /** List items hold blocks, so nested lists and multi-paragraph items work. */
  blocks: DocumentNode[];
}

export interface TableNode extends NodeProvenance {
  type: 'table';
  caption?: string;
  /** Rendered as `<thead>` with `<th scope="col">` when present. */
  header?: TableRow;
  rows: TableRow[];
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  header: boolean;
  content: InlineNode[];
  /**
   * Block content inside the cell.
   *
   * `<td>` can hold a figure, a nested list or a nested table, and real
   * documents do. Without this the tagged adapter had nowhere to put a
   * `Figure` that lives in a table cell, so it was dropped — one news release
   * declared four figures, all of them inside cells, and the Reader showed
   * none of them.
   */
  blocks?: DocumentNode[];
  colSpan?: number;
  rowSpan?: number;
}

/**
 * A figure detected in the document.
 *
 * The MVP cannot extract the image bytes themselves, so `source` is usually
 * absent and the Reader renders an explicit placeholder. It never invents a
 * description: `alternativeText` is only ever populated from something the PDF
 * itself supplied.
 */
export interface FigureNode extends NodeProvenance {
  type: 'figure';
  alternativeText?: string;
  /**
   * Who wrote `alternativeText`.
   *
   * This is the field that makes machine-generated descriptions safe to offer
   * at all. A description cannot be checked against the picture by looking,
   * so the one thing the Reader must never do is let a guess pass for the
   * author's own words. Everything downstream —
   * the announced prefix, the notice in the UI — keys off this.
   */
  alternativeTextSource?: AlternativeTextSource;
  caption?: string;
  /** What the Reader displays. */
  source?: ImageSource;
  /**
   * Where the figure sits in the PDF.
   *
   * Kept separate from `source` on purpose. `source` is display state and gets
   * replaced once the image is rasterised to a blob URL; the region is the
   * durable fact about the document, and anything that needs to go back to the
   * pixels — re-rendering at another size, describing the image — depends on it
   * still being there afterwards.
   */
  region?: PdfPageRegion;
  /**
   * Marked-content identifiers this figure covers, when a tagged PDF supplied
   * them.
   *
   * This is what makes locating a figure exact rather than a guess: the tag
   * tree says which drawing operations belong to it, so the region can be
   * computed from those alone. It is also the only way to find a figure drawn
   * with vector paths, which paints no image operator to look for.
   */
  contentIds?: string[];
  /**
   * Set when a describer ran on this figure and produced nothing.
   *
   * Distinct from never having tried. Without it a failed run leaves the
   * figure looking exactly as it did before, so a reader is told "no
   * alternative text was obtained" and cannot tell whether the tool declined,
   * failed, or was never asked.
   */
  descriptionAttempted?: boolean;
  status: FigureStatus;
}

/** A rectangle on a page, in PDF user space (origin bottom-left). */
export interface PdfPageRegion {
  pageNumber: number;
  bbox: BoundingBox;
}

export type AlternativeTextSource =
  /** The document supplied it — a Tagged PDF `/Alt`, or a real Markdown alt. */
  | 'author'
  /** Text an OCR engine read *off* the image. */
  | 'ocr'
  /** A description a model produced from the pixels. Never presented as the
   * author's text. */
  | 'generated'
  /**
   * The document carried it, but a machine wrote it.
   *
   * Word and PowerPoint offer to generate alternative text, and what they
   * generate is written into the PDF's `/Alt` verbatim — including their own
   * disclaimer, "AI-generated content may be incorrect." A `/Alt` is therefore
   * not proof that a person described the image. `generated-alt.ts` matches
   * that boilerplate in both the languages this project can check.
   *
   * Kept distinct from `'author'` because announcing it as the author's words
   * is false, and distinct from `'generated'` because this tool did not write
   * it and cannot vouch for it either. It is also the one kind of existing
   * alternative text worth offering to describe again: it is usually a bare
   * shape inventory — "Image containing timeline" — rather than a description
   * of what the image says.
   */
  | 'document-ai';

export type FigureStatus =
  /** Image and a usable alternative text are both available. */
  | 'available'
  /** The image exists but the PDF supplied no alternative text. */
  | 'missing-alt'
  /** We know a figure is here but cannot show it. */
  | 'unavailable';

/** A URL the Reader can put in `<img src>` — usually a blob: URL owned by the
 * Reader document, produced by rendering the figure's `region`. */
export type ImageSource = { kind: 'url'; url: string; width?: number; height?: number };

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockquoteNode extends NodeProvenance {
  type: 'blockquote';
  blocks: DocumentNode[];
}

export interface CodeNode extends NodeProvenance {
  type: 'code';
  text: string;
  language?: string;
}

export interface ThematicBreakNode extends NodeProvenance {
  type: 'thematic-break';
}

/** Content we could not classify. Rendered as a paragraph rather than dropped,
 * so no text is ever silently lost. */
export interface UnknownNode extends NodeProvenance {
  type: 'unknown';
  content: InlineNode[];
}

/* -------------------------------------------------------------------------
 * Inline nodes
 * ---------------------------------------------------------------------- */

/**
 * Links are inline, not block-level: an `<a>` lives inside a paragraph, a
 * heading or a table cell. (The original brief lists `LinkNode` in the block
 * union — see README, *Kept outside this repository*; it
 * is modelled inline here because a block-level link cannot be rendered as
 * valid, navigable HTML. See ARCHITECTURE.md.)
 */
export type InlineNode = TextNode | LinkNode | LineBreakNode;

export interface TextNode {
  type: 'text';
  text: string;
  /** Native emphasis only — `<strong>`, `<em>`, `<code>`. */
  emphasis?: Array<'strong' | 'em' | 'code'>;
}

export interface LinkNode {
  type: 'link';
  href: string;
  content: InlineNode[];
  /** Set when the link text is identical to the href, so the renderer can
   * avoid producing an unhelpful "https://..." accessible name. */
  isBareUrl?: boolean;
}

export interface LineBreakNode {
  type: 'line-break';
}

/* -------------------------------------------------------------------------
 * Capabilities
 * ---------------------------------------------------------------------- */

/**
 * What we learned about the PDF itself, independent of the content extracted.
 * Drives the "this document needs OCR" messaging, which must never be worded
 * as an analysis failure.
 */
export interface PdfCapabilities {
  hasExtractableText: boolean;
  requiresOcr: boolean;
  /** 1-indexed page numbers needing OCR. */
  ocrPages: number[];
  isScanned: boolean;
  isImageBased: boolean;
  isMixed: boolean;
  /** Producer-reported confidence in the classification, 0..1 when known. */
  confidence?: number;
  /** Producer-reported text encoding problems; a hint that extracted text may
   * be garbled even though it is technically present. */
  hasEncodingIssues?: boolean;
}

/* -------------------------------------------------------------------------
 * Figure traversal
 * ---------------------------------------------------------------------- */

/**
 * A figure and the text around it.
 *
 * Figures are not always top-level: they sit in table cells, list items and
 * blockquotes. Everything that works on figures — attaching page regions,
 * counting what can be described, writing descriptions back — has to reach all
 * of them, and has to agree on their order. These two functions are that
 * shared traversal, so a nested figure can never be visible to one pass and
 * invisible to another.
 */
export interface FigureRef {
  figure: FigureNode;
  /**
   * Nearby text that says what the figure is: a short paragraph just before
   * it, or the text of the cell it sits in. Used as context for a describer,
   * never as the figure's own caption.
   */
  context?: string;
}

/** Longer than this is body text, not a label. */
const CONTEXT_MAX_LENGTH = 60;

/**
 * How many headings a reading of the document offers.
 *
 * Worth counting, because zero is a real and common answer, and nothing else
 * here would surface it. Measured across this project's tagged fixtures — five
 * business documents, all produced by Microsoft Word — **every one has a
 * structure tree with no heading tags at all**: paragraphs, tables, lists and
 * figures only. The authors formatted their headings by hand rather than with
 * heading styles, so Word had nothing to tag.
 *
 * The consequence is invisible and severe: pressing `H` in such a document
 * finds nothing, and nothing on screen explains why. Counting is what lets the
 * Reader say so.
 *
 * Headings nested inside lists and blockquotes count. Table cells hold inline
 * content only, so there is nothing to recurse into there.
 */
export function countHeadings(document: AccessibleDocument): number {
  let total = 0;
  for (const page of document.pages) total += countHeadingsIn(page.nodes);
  return total;
}

function countHeadingsIn(nodes: DocumentNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.type === 'heading') total += 1;
    else if (node.type === 'list') {
      for (const item of node.items) total += countHeadingsIn(item.blocks);
    } else if (node.type === 'blockquote') total += countHeadingsIn(node.blocks);
  }
  return total;
}

/** The producer a node's claim belongs to: its own, when it says, else its page's. */
export function nodeOrigin(node: DocumentNode, page: DocumentPage): DocumentOrigin {
  return node.origin ?? page.origin;
}

export function collectFigures(nodes: DocumentNode[]): FigureRef[] {
  const found: FigureRef[] = [];
  walkFigures(nodes, undefined, (figure, context) => {
    found.push({ figure, ...(context ? { context } : {}) });
    return figure;
  });
  return found;
}

/** Rebuilds the tree with each figure replaced, visiting them in the same
 * order `collectFigures` reports. */
export function mapFigures(
  nodes: DocumentNode[],
  replace: (figure: FigureNode, index: number) => FigureNode,
): DocumentNode[] {
  let index = 0;
  return walkFigures(nodes, undefined, (figure) => replace(figure, index++));
}

function walkFigures(
  nodes: DocumentNode[],
  inheritedContext: string | undefined,
  visit: (figure: FigureNode, context: string | undefined) => FigureNode,
): DocumentNode[] {
  let previousText: string | undefined;

  return nodes.map((node): DocumentNode => {
    switch (node.type) {
      case 'figure': {
        const context = node.caption ?? previousText ?? inheritedContext;
        previousText = undefined;
        return visit(node, context);
      }

      case 'paragraph': {
        const text = inlineToPlainText(node.content).trim();
        previousText = text !== '' && text.length <= CONTEXT_MAX_LENGTH ? text : undefined;
        return node;
      }

      case 'list':
        previousText = undefined;
        return {
          ...node,
          items: node.items.map((item) => ({
            blocks: walkFigures(item.blocks, inheritedContext, visit),
          })),
        };

      case 'table': {
        previousText = undefined;
        const mapRow = (row: TableRow): TableRow => ({
          cells: row.cells.map((cell) =>
            cell.blocks
              ? {
                  ...cell,
                  // The cell's own text is the best available label for a
                  // figure inside it.
                  blocks: walkFigures(
                    cell.blocks,
                    inlineToPlainText(cell.content).trim() || inheritedContext,
                    visit,
                  ),
                }
              : cell,
          ),
        });
        return {
          ...node,
          ...(node.header ? { header: mapRow(node.header) } : {}),
          rows: node.rows.map(mapRow),
        };
      }

      case 'blockquote':
        previousText = undefined;
        return { ...node, blocks: walkFigures(node.blocks, inheritedContext, visit) };

      default:
        previousText = undefined;
        return node;
    }
  });
}

/** Flattens a node tree back to plain text. Used for table captions, figure
 * captions and tests. */
export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text;
        case 'link':
          return inlineToPlainText(node.content);
        case 'line-break':
          return '\n';
      }
    })
    .join('');
}

export function nodeToPlainText(node: DocumentNode): string {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'unknown':
      return inlineToPlainText(node.content);
    case 'list':
      return node.items
        .map((item) => item.blocks.map(nodeToPlainText).join(' '))
        .join('\n');
    case 'table':
      return [...(node.header ? [node.header] : []), ...node.rows]
        .map((row) =>
          row.cells
            .map((cell) =>
              [
                inlineToPlainText(cell.content),
                ...(cell.blocks ?? []).map(nodeToPlainText),
              ]
                .filter((part) => part !== '')
                .join(' '),
            )
            .join('\t'),
        )
        .join('\n');
    case 'blockquote':
      return node.blocks.map(nodeToPlainText).join('\n');
    case 'code':
      return node.text;
    case 'figure':
      return node.caption ?? node.alternativeText ?? '';
    case 'thematic-break':
      return '';
  }
}

export function documentToPlainText(document: AccessibleDocument): string {
  return document.pages
    .map((page) => page.nodes.map(nodeToPlainText).join('\n'))
    .join('\n');
}

/*
 * Merging two producers' pages into one document lives in
 * `lib/pdf/ocr/merge.ts`.
 *
 * There used to be a second, more permissive `mergeDocuments` here as well. Two
 * functions merging documents by different rules is exactly the shape of defect
 * this project keeps finding — one of them is always the one that is wired up,
 * and the other quietly encodes a different answer to the same question. Only
 * the stricter one survives, and it is the one the Reader actually calls.
 */
