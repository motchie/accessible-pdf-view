import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import type {
  ListItem,
  PhrasingContent,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from 'mdast';
import type {
  DocumentNode as ModelNode,
  InlineNode as ModelInline,
  ListItem as ModelListItem,
  TableCell as ModelTableCell,
  TableRow as ModelTableRow,
} from '../document-model';
import { sanitizeHref } from '../sanitize-url';

/**
 * Converts the Markdown that pdf-inspector produces into Document Model nodes.
 *
 * The Markdown is parsed to an mdast tree and lowered node by node. Raw HTML in
 * the Markdown is never forwarded: the only HTML node we interpret is the
 * `<!-- Page N -->` marker pdf-inspector emits when `includePageMarkers` is on,
 * and everything else is dropped. Nothing downstream of this file ever sees a
 * string that could be injected into the DOM as markup.
 */

/** A run of blocks that belongs to one PDF page. */
export interface MarkdownPageChunk {
  /** 1-indexed. Null when the Markdown carried no page markers. */
  pageNumber: number | null;
  nodes: ModelNode[];
}

export interface MarkdownConversionOptions {
  /**
   * Collapse spaces that pdf-inspector inserts between adjacent Japanese
   * characters. Text extraction positions glyphs individually, so CJK runs
   * frequently come back as "こ ん に ち は". Screen readers read those as
   * separate words. Defaults to true.
   */
  normalizeCjkSpacing?: boolean;
}

const PAGE_MARKER = /^<!--\s*Page\s+(\d+)\s*-->$/i;

/**
 * pdf-inspector writes image placeholders as `![Image: ...]`, where the alt
 * text describes the *slot*, not the picture. Treating that as a real
 * alternative text would announce "Image: 640 by 480" to a screen reader user
 * as if the author had written it.
 */
const PLACEHOLDER_ALT = /^\s*image\s*:/i;

export function markdownToPages(
  markdown: string,
  options: MarkdownConversionOptions = {},
): MarkdownPageChunk[] {
  const normalizeCjk = options.normalizeCjkSpacing ?? true;
  const tree = fromMarkdown(escapePipesInsideLinks(markdown), {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });

  const chunks: MarkdownPageChunk[] = [];
  let current: MarkdownPageChunk = { pageNumber: null, nodes: [] };

  for (const child of tree.children) {
    const marker = pageMarkerOf(child);
    if (marker !== null) {
      // Only start a new chunk once we have something to attribute to the
      // previous one; a marker at the very top of the document is just a label
      // for what follows.
      if (current.nodes.length > 0 || current.pageNumber !== null) {
        chunks.push(current);
      }
      current = { pageNumber: marker, nodes: [] };
      continue;
    }

    const node = convertBlock(child, normalizeCjk);
    if (node) current.nodes.push(...node);
  }
  chunks.push(current);

  return chunks;
}

/** Matches a complete inline link, `[text](destination)`, on one line. */
const INLINE_LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;

/**
 * Escapes `|` characters that sit inside a Markdown link.
 *
 * GFM splits a table row into cells *before* inline parsing, so an unescaped
 * pipe inside a link destination silently tears the link apart and leaves the
 * row with more cells than the table has columns. The fixture in this
 * repository does exactly this — pdf-inspector sweeps the cell's closing pipe
 * into the URL and emits
 *
 *     |開館時間|…（2027 年 3 月頃） [https://example.com/a/|](https://example.com/a/|)
 *
 * which GFM reads as four cells in a two-column table, with no link at all.
 * Escaping the pipes restores both the link and the row's shape; the stray
 * trailing pipe inside the URL is then removed by `sanitizeHref`.
 *
 * The substitution only applies within a `[...](...)` construct, so ordinary
 * table pipes are untouched.
 */
export function escapePipesInsideLinks(markdown: string): string {
  return markdown.replace(INLINE_LINK, (match, text: string, destination: string) => {
    if (!match.includes('|')) return match;
    return `[${escapePipes(text)}](${escapePipes(destination)})`;
  });
}

function escapePipes(value: string): string {
  return value.replace(/(?<!\\)\|/g, '\\|');
}

function pageMarkerOf(node: RootContent): number | null {
  if (node.type !== 'html') return null;
  const match = PAGE_MARKER.exec(node.value.trim());
  if (!match?.[1]) return null;
  const page = Number.parseInt(match[1], 10);
  return Number.isFinite(page) ? page : null;
}

function convertBlock(node: RootContent, normalizeCjk: boolean): ModelNode[] | null {
  switch (node.type) {
    case 'heading':
      return [
        {
          type: 'heading',
          level: clampLevel(node.depth),
          content: convertInline(node.children, normalizeCjk),
        },
      ];

    case 'paragraph': {
      // A paragraph whose only content is an image is a figure, not a
      // paragraph containing a picture.
      const images = node.children.filter((child) => child.type === 'image');
      const isFigureOnly =
        images.length > 0 &&
        node.children.every(
          (child) =>
            child.type === 'image' ||
            (child.type === 'text' && child.value.trim() === ''),
        );
      if (isFigureOnly) {
        return images.map((image) =>
          toFigure(image.alt ?? undefined, image.title ?? undefined),
        );
      }

      const content = convertInline(node.children, normalizeCjk);
      if (content.length === 0) return null;
      return [{ type: 'paragraph', content }];
    }

    case 'list':
      return [
        {
          type: 'list',
          ordered: Boolean(node.ordered),
          ...(node.ordered && node.start != null && node.start !== 1
            ? { start: node.start }
            : {}),
          items: node.children.map((item): ModelListItem => convertListItem(item, normalizeCjk)),
        },
      ];

    case 'table':
      return [convertTable(node, normalizeCjk)];

    case 'blockquote': {
      const blocks = node.children.flatMap(
        (child) => convertBlock(child, normalizeCjk) ?? [],
      );
      if (blocks.length === 0) return null;
      return [{ type: 'blockquote', blocks }];
    }

    case 'code':
      return [
        {
          type: 'code',
          text: node.value,
          ...(node.lang ? { language: node.lang } : {}),
        },
      ];

    case 'thematicBreak':
      return [{ type: 'thematic-break' }];

    case 'html':
      // Raw HTML is never rendered. Dropping it is safe here because
      // pdf-inspector only emits HTML for page markers and comments.
      return null;

    default:
      return null;
  }
}

function convertListItem(item: ListItem, normalizeCjk: boolean): ModelListItem {
  const blocks = item.children.flatMap(
    (child) => convertBlock(child, normalizeCjk) ?? [],
  );
  return { blocks };
}

function convertTable(
  node: Table,
  normalizeCjk: boolean,
): ModelNode {
  const rows = node.children.map((row) => convertRow(row, normalizeCjk, false));
  // GFM tables always have a header row; pdf-inspector's table detection uses
  // the first row for it. Only treat it as a header when it has content —
  // otherwise `<th>` would give screen readers empty column names.
  const [first, ...rest] = rows;
  const headerHasContent =
    first?.cells.some((cell) => cell.content.length > 0) ?? false;

  if (!first || !headerHasContent) {
    return { type: 'table', rows };
  }

  return {
    type: 'table',
    header: { cells: first.cells.map((cell) => ({ ...cell, header: true })) },
    rows: rest,
  };
}

function convertRow(
  row: TableRow,
  normalizeCjk: boolean,
  header: boolean,
): ModelTableRow {
  return {
    cells: row.children.map(
      (cell: TableCell): ModelTableCell => ({
        header,
        content: convertInline(cell.children, normalizeCjk),
      }),
    ),
  };
}

function toFigure(alt: string | undefined, title: string | undefined): ModelNode {
  const hasRealAlt = Boolean(alt && alt.trim() && !PLACEHOLDER_ALT.test(alt));

  return {
    type: 'figure',
    // Never fabricate a description. Only text the document itself supplied is
    // used as an alternative text.
    ...(hasRealAlt
      ? { alternativeText: alt!.trim(), alternativeTextSource: 'author' as const }
      : {}),
    ...(title?.trim() ? { caption: title.trim() } : {}),
    // The MVP cannot extract the image bytes, so there is no `source`. The
    // Reader renders an explicit placeholder for both statuses.
    status: hasRealAlt ? 'available' : 'missing-alt',
  };
}

function clampLevel(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = Math.min(6, Math.max(1, Math.round(depth)));
  return level as 1 | 2 | 3 | 4 | 5 | 6;
}

/* -------------------------------------------------------------------------
 * Inline conversion
 * ---------------------------------------------------------------------- */

function convertInline(
  nodes: PhrasingContent[],
  normalizeCjk: boolean,
  emphasis: Array<'strong' | 'em' | 'code'> = [],
): ModelInline[] {
  const out: ModelInline[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        pushText(out, node.value, emphasis, normalizeCjk);
        break;

      case 'inlineCode':
        pushText(out, node.value, [...emphasis, 'code'], false);
        break;

      case 'strong':
        out.push(...convertInline(node.children, normalizeCjk, [...emphasis, 'strong']));
        break;

      case 'emphasis':
        out.push(...convertInline(node.children, normalizeCjk, [...emphasis, 'em']));
        break;

      case 'delete':
        out.push(...convertInline(node.children, normalizeCjk, emphasis));
        break;

      case 'link': {
        const content = convertInline(node.children, normalizeCjk, emphasis);
        const href = sanitizeHref(node.url);
        if (!href) {
          // A link we refuse to render still keeps its text.
          out.push(...content);
          break;
        }
        const text = content
          .map((child) => (child.type === 'text' ? child.text : ''))
          .join('')
          .trim();

        // When the link text is just the URL again, show the sanitised href
        // rather than the raw text. Otherwise an artefact that `sanitizeHref`
        // cleaned out of the destination — a swept-up table pipe, say — would
        // still be read aloud as part of the link.
        const isBareUrl = text === node.url.trim();
        if (isBareUrl) {
          out.push({ type: 'link', href, content: [{ type: 'text', text: href }], isBareUrl });
          break;
        }

        out.push({
          type: 'link',
          href,
          content: content.length > 0 ? content : [{ type: 'text', text: href }],
        });
        break;
      }

      case 'image':
        // An image inside a run of text cannot become a `<figure>` without
        // breaking the paragraph. Keep any real alternative text as text so it
        // is not lost; drop machine placeholders.
        if (node.alt && !PLACEHOLDER_ALT.test(node.alt)) {
          pushText(out, node.alt, emphasis, normalizeCjk);
        }
        break;

      case 'break':
        out.push({ type: 'line-break' });
        break;

      case 'html':
        break;

      default:
        break;
    }
  }

  return mergeAdjacentText(out);
}

function pushText(
  out: ModelInline[],
  raw: string,
  emphasis: Array<'strong' | 'em' | 'code'>,
  normalizeCjk: boolean,
): void {
  const text = normalizeCjk ? normalizeCjkSpacing(raw) : raw;
  if (text === '') return;
  out.push({ type: 'text', text, ...(emphasis.length ? { emphasis: [...emphasis] } : {}) });
}

function mergeAdjacentText(nodes: ModelInline[]): ModelInline[] {
  const out: ModelInline[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      node.type === 'text' &&
      previous?.type === 'text' &&
      sameEmphasis(previous.emphasis, node.emphasis)
    ) {
      previous.text += node.text;
      continue;
    }
    out.push(node);
  }
  return out;
}

function sameEmphasis(a?: string[], b?: string[]): boolean {
  return (a ?? []).join('|') === (b ?? []).join('|');
}

/* -------------------------------------------------------------------------
 * Japanese spacing
 * ---------------------------------------------------------------------- */

// Ideographs, hiragana, katakana, CJK punctuation, and full-width forms. A
// space between two of these was almost certainly introduced by glyph-level
// text extraction rather than written by the author.
const CJK =
  '\\u3000-\\u303F\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF01-\\uFF60\\uFFE0-\\uFFE6';

const CJK_SPACE = new RegExp(`([${CJK}]) +(?=[${CJK}])`, 'g');

/**
 * A run of *single* digits separated by spaces, sitting next to CJK text —
 * "2 2 日". Requiring every element to be one digit is what makes this safe:
 * "在庫は 5 10 個" contains a two-digit token, so it is left alone rather than
 * silently rewritten to "510個".
 */
const SPLIT_DIGIT_RUN = new RegExp(`(?<!\\d)\\d(?: +\\d)+(?!\\d)(?= *[${CJK}])`, 'g');

const DIGIT_THEN_CJK = new RegExp(`(\\d) +(?=[${CJK}])`, 'g');
const CJK_THEN_DIGIT = new RegExp(`([${CJK}]) +(?=\\d)`, 'g');

/**
 * Undoes the spacing that glyph-level text extraction introduces into Japanese
 * text.
 *
 * PDF text extraction reports each glyph with its own position, and a parser
 * has to guess where the word breaks are. For a script that has no word breaks,
 * it guesses wrong constantly: a real news release yields
 * "株 式 会 社 サ ン プ ル" and "2026 年 7 月 2 2 日". A screen reader reads the
 * first as eight separate characters and the second as "two two".
 *
 * (The examples here and in the tests are neutral stand-ins with the same
 * shape as the documents they were taken from, which are not published with
 * this repository. Nothing is a quotation.)
 *
 * Three rules, each chosen so that removing the space cannot merge two real
 * words:
 *
 *   1. CJK ␣ CJK          — Japanese is written without spaces, so a space here
 *                            was never in the text.
 *   2. digit ␣ digit ␣ …   — only when every element is a single digit and the
 *      next to CJK           run sits against CJK text ("2 2 日" -> "22 日").
 *   3. digit ␣ CJK, and    — Japanese does not space numbers away from the
 *      CJK ␣ digit           counters and units that follow them
 *                            ("22 日" -> "22日", "約 4,000" -> "約4,000").
 *
 * Latin text keeps its spaces throughout: "SAMPLE グループ" and "詳細は HP にて"
 * are untouched, because a space between Latin and Japanese is ordinary
 * typography rather than an artefact, and "hello world" never matches at all.
 */
export function normalizeCjkSpacing(text: string): string {
  // The CJK rule is applied twice because the match consumes the character
  // before the space, so alternating runs like "あ い う" need a second pass.
  let result = text.replace(CJK_SPACE, '$1').replace(CJK_SPACE, '$1');
  result = result.replace(SPLIT_DIGIT_RUN, (run) => run.replace(/ +/g, ''));
  return result.replace(DIGIT_THEN_CJK, '$1').replace(CJK_THEN_DIGIT, '$1');
}
